import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ExperienceResult, Transport } from "../lib/contracts";
import type { Experience } from "../lib/experience/types";
import { runExperience } from "../lib/experience/runner";
import { createTransportExperience } from "../lib/experience/transportExperience";
import { createSnapshotExperience } from "../experiences/snapshot/snapshotExperience";
import { createE2EExperience } from "../experiences/e2e/e2eExperience";
import { createDeterminismCostExperience } from "../lib/experience/determinismCost";
import { parseSession, type SessionInfo } from "../lib/session/session";
import { WebSocketTransport } from "../lib/transport/ws";
import {
  COMPANION_RUN_TIMEOUT_MS,
  mergeGuestResult,
  requestCompanionRunWithTimeout,
  startCompanion,
} from "../lib/session/companion";

/**
 * Persisted so `/summary` renders the verdict above the fold on a fresh
 * page load with zero interaction (008.7 spec item 5 / F18 DoD) — results
 * otherwise live only in React state and vanish on reload.
 */
const RESULTS_STORAGE_KEY = "netcode-feasibility:results:v1";

function loadStoredResults(): Record<string, ExperienceResult> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(RESULTS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, ExperienceResult>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {}; // corrupt/old-shape storage — start clean rather than throw on load.
  }
}

function persistResults(results: Record<string, ExperienceResult>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RESULTS_STORAGE_KEY, JSON.stringify(results));
  } catch {
    // best-effort only (e.g. storage quota/private-browsing) — never blocks a run.
  }
}

/** The ONE run-state vocabulary — sidebar dots, Summary scoreboard, and every
 * page's result block must derive from this, never re-compute their own. */
export type RunState = "idle" | "running" | "completed" | "failed";

export interface RunStoreValue {
  experiences: Experience[];
  results: Record<string, ExperienceResult>;
  running: Record<string, boolean>;
  runAllInProgress: boolean;
  session: SessionInfo;
  /** True once the companion control channel has a live peer (contracts.md §6). */
  companionConnected: boolean;
  /** Single source of truth for an experiment's run state. */
  runState: (id: string) => RunState;
  runOne: (id: string) => Promise<void>;
  runAllExperiences: () => Promise<void>;
  abortAll: () => void;
  clearResults: () => void;
}

const RunStoreContext = createContext<RunStoreValue | null>(null);

export function useRunStore(): RunStoreValue {
  const ctx = useContext(RunStoreContext);
  if (!ctx) throw new Error("useRunStore must be used within RunStoreProvider");
  return ctx;
}

export function RunStoreProvider({ children }: { children: ReactNode }) {
  const session = useMemo(() => parseSession(), []);
  const experiences = useMemo(
    () => [
      createTransportExperience(() => session),
      createSnapshotExperience(() => session.topology),
      createE2EExperience(() => session),
      createDeterminismCostExperience(() => session.topology),
    ],
    [session],
  );
  const byId = useMemo(() => new Map(experiences.map((e) => [e.id, e])), [experiences]);

  const [results, setResults] = useState<Record<string, ExperienceResult>>(() => loadStoredResults());
  const [running, setRunning] = useState<Record<string, boolean>>({});
  const [runAllInProgress, setRunAllInProgress] = useState(false);
  const [companionConnected, setCompanionConnected] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const companionTransportRef = useRef<Transport | null>(null);

  useEffect(() => {
    persistResults(results);
  }, [results]);

  // Companion control channel (contracts.md §6): a control-plane WS
  // connection, keyed off a room id DISTINCT from the room string any
  // individual experience's own transport connects to (`::control`
  // suffix) — the server's RoomRegistry seats exactly one peer per role
  // per room (server/rooms.ts), so sharing the bare room id with e.g. the
  // transport sweep's own WS connection would collide with that seat.
  // Guest: auto-starts the companion state machine (runs whatever the host
  // requests, streams the `ExperienceResult` back via `result`). Host: this
  // is the transport `runOne`/`runAllExperiences` send `run` over and await
  // `result` on, to merge the guest's measurement into the summary.
  useEffect(() => {
    if (!session.room) {
      companionTransportRef.current = null;
      setCompanionConnected(false);
      return;
    }
    const transport = new WebSocketTransport({
      room: `${session.room}::control`,
      role: session.role,
    });
    companionTransportRef.current = transport;
    transport.onStateChange((s) => setCompanionConnected(s === "open"));

    const stopCompanion =
      session.role === "guest" ? startCompanion(transport, experiences) : undefined;

    return () => {
      stopCompanion?.();
      transport.close();
      if (companionTransportRef.current === transport) companionTransportRef.current = null;
      setCompanionConnected(false);
    };
    // `experiences` is stable per session (useMemo above depends only on
    // `session`), so this effect re-runs only when room/role actually change.
  }, [session, experiences]);

  /**
   * Runs one experience the ONE shared way (contracts.md §6 `RunControl`),
   * then — if this session is a paired host with an open companion channel
   * — also requests the identical run from the guest and merges the
   * guest's `ExperienceResult` in (F4: guest-measured input-lag reaching
   * the host summary). Solo/loopback sessions and guests-without-a-host
   * skip the merge step entirely; the local result stands alone, badged by
   * its own `topology` tag.
   */
  const runOneInternal = useCallback(
    async (experience: Experience, signal: AbortSignal): Promise<ExperienceResult> => {
      // Generous timeout: heavy experiences (e2e boots two Phaser games and
      // drives 420 ticks x 2 orientations) legitimately exceed the 30s
      // DEFAULT — a too-short timeout was silently timing them out in run-all.
      const localPromise = runExperience(experience, experience.defaultConfig, {
        signal,
        timeoutMs: 180_000,
      });
      const transport = companionTransportRef.current;
      const shouldMerge = session.role === "host" && Boolean(session.room) && companionConnected;

      if (!shouldMerge || !transport) return localPromise;

      const guestPromise = requestCompanionRunWithTimeout(
        transport,
        experience.id,
        experience.defaultConfig,
        COMPANION_RUN_TIMEOUT_MS,
        signal,
      );
      const [hostResult, guestResult] = await Promise.all([localPromise, guestPromise]);
      if (!guestResult) return hostResult; // no companion answer in time — local-only, still valid.
      return mergeGuestResult(hostResult, guestResult, session.topology);
    },
    [session, companionConnected],
  );

  const runOne = useCallback(
    async (id: string) => {
      const experience = byId.get(id);
      if (!experience) return;
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setRunning((r) => ({ ...r, [id]: true }));
      try {
        const result = await runOneInternal(experience, controller.signal);
        setResults((r) => ({ ...r, [id]: result }));
      } finally {
        setRunning((r) => ({ ...r, [id]: false }));
      }
    },
    [byId, runOneInternal],
  );

  const runAllExperiences = useCallback(async () => {
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setRunAllInProgress(true);
    setRunning(Object.fromEntries(experiences.map((e) => [e.id, true])));
    try {
      // Same per-experience path as manual (`runOneInternal`, incl. the
      // guest merge), just sequenced with progress/abort like `runAll` —
      // contracts.md §6: "run-all uses exactly the defaults so 'run-all
      // results match manual' is checkable."
      for (const experience of experiences) {
        if (controller.signal.aborted) {
          setResults((r) => ({
            ...r,
            [experience.id]: {
              experienceId: experience.id,
              status: "failed",
              topology: session.topology,
              lossMode: "none",
              raw: { reason: "aborted-before-start" },
              subScores: [],
              verdict: "Aborted before this experience started.",
              measuredCaveat: "n/a — aborted",
            },
          }));
          setRunning((r) => ({ ...r, [experience.id]: false }));
          continue;
        }
        // Fault isolation: one experience throwing/timing out must NOT abort
        // the remaining experiences. Record a `failed` result and continue.
        try {
          const result = await runOneInternal(experience, controller.signal);
          setResults((r) => ({ ...r, [experience.id]: result }));
        } catch (err) {
          setResults((r) => ({
            ...r,
            [experience.id]: {
              experienceId: experience.id,
              status: "failed",
              topology: session.topology,
              lossMode: "none",
              raw: { reason: String(err) },
              subScores: [],
              verdict: `Experience threw during run-all: ${String(err)}`,
              measuredCaveat: "n/a — failed",
            },
          }));
        }
        setRunning((r) => ({ ...r, [experience.id]: false }));
      }
    } finally {
      setRunAllInProgress(false);
      setRunning({});
    }
  }, [experiences, runOneInternal, session.topology]);

  const abortAll = useCallback(() => {
    abortControllerRef.current?.abort("user-abort");
  }, []);

  const clearResults = useCallback(() => {
    setResults({});
  }, []);

  const runState = useCallback(
    (id: string): RunState => {
      if (running[id]) return "running";
      const r = results[id];
      if (!r) return "idle";
      return r.status === "failed" ? "failed" : "completed";
    },
    [running, results],
  );

  const value: RunStoreValue = {
    experiences,
    results,
    running,
    runAllInProgress,
    session,
    companionConnected,
    runState,
    runOne,
    runAllExperiences,
    abortAll,
    clearResults,
  };

  return <RunStoreContext.Provider value={value}>{children}</RunStoreContext.Provider>;
}
