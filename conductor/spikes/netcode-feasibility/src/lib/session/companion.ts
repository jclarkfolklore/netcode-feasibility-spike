import type { ExperienceResult, SubScore, Topology, Transport, WireMessage } from "../contracts";
import type { Experience } from "../experience/types";
import { runExperience } from "../experience/runner";

/** Guest companion runs must match the host's local budget (heavy e2e boots two
 * Phaser games and drives 420 ticks); the 30s runner default silently failed
 * them "aborted mid-pass" mid-sweep. Keep in sync with RunStore's local run. */
export const COMPANION_RUN_TIMEOUT_MS = 180_000;

/**
 * Companion mode (contracts.md §6): "host drives; guest runs an
 * auto-cooperating state machine that participates per experience and
 * streams its ExperienceResult back via a `result` message on the reliable
 * channel." This is the guest-side half of that state machine.
 *
 * Scaffolding only for 008.1 — real experiences that need two peers land in
 * 008.3+. Wired enough that a `soloCapable` placeholder round-trips a `run`
 * -> `result` exchange end-to-end over a `LoopbackTransport` pair.
 */
export function startCompanion(
  transport: Transport,
  experiences: Experience[],
  /** Reports what the host is currently driving this guest to run — an
   * experienceId while a companion run is in flight, `null` when idle. Lets the
   * guest UI show "host is running X" instead of leaving the operator blind. */
  onActivity?: (experienceId: string | null) => void,
): () => void {
  const byId = new Map(experiences.map((e) => [e.id, e]));
  let currentAbort: AbortController | null = null;

  const handleMessage = (msg: WireMessage) => {
    if (msg.t !== "run") return;
    const experience = byId.get(msg.experienceId);
    if (!experience) return;

    if (msg.action === "abort") {
      currentAbort?.abort("remote-abort");
      onActivity?.(null);
      return;
    }

    currentAbort = new AbortController();
    onActivity?.(msg.experienceId);
    void runExperience(experience, msg.config, {
      signal: currentAbort.signal,
      timeoutMs: COMPANION_RUN_TIMEOUT_MS,
    }).then((result) => {
      transport.send({ t: "result", experienceId: experience.id, result });
      onActivity?.(null);
    });
  };

  transport.onMessage(handleMessage);

  return () => {
    currentAbort?.abort("companion-stopped");
  };
}

/**
 * Host-side helper: sends a `run` RunControl and resolves with the guest's
 * `result` message for that experienceId (contracts.md §6 RunControl).
 * The host owns the merged summary; this just fetches the guest's half.
 */
export function requestCompanionRun(
  transport: Transport,
  experienceId: string,
  config: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<import("../contracts").ExperienceResult> {
  return new Promise((resolve, reject) => {
    const onMessage = (msg: WireMessage) => {
      if (msg.t === "result" && msg.experienceId === experienceId) {
        resolve(msg.result);
      }
    };
    transport.onMessage(onMessage);

    signal?.addEventListener(
      "abort",
      () => {
        transport.send({ t: "run", experienceId, config, action: "abort" });
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );

    transport.send({ t: "run", experienceId, config, action: "start" });
  });
}

/**
 * Same as `requestCompanionRun`, but resolves to `null` (never rejects,
 * never hangs "run all") if the guest doesn't answer within `timeoutMs` —
 * 008.7's run-all orchestration needs a bounded wait per experience, not an
 * indefinite one, since a companion peer may not exist (solo run) or may
 * have dropped mid-sweep.
 */
export function requestCompanionRunWithTimeout(
  transport: Transport,
  experienceId: string,
  config: Record<string, unknown>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<ExperienceResult | null> {
  const localAbort = new AbortController();
  const onExternalAbort = () => localAbort.abort();
  signal?.addEventListener("abort", onExternalAbort, { once: true });

  const timeout = new Promise<null>((resolve) => {
    const timer = setTimeout(() => {
      localAbort.abort("companion-timeout");
      resolve(null);
    }, timeoutMs);
    localAbort.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
  });

  const request = requestCompanionRun(transport, experienceId, config, localAbort.signal).catch(
    () => null,
  );

  return Promise.race([request, timeout]).finally(() => {
    signal?.removeEventListener("abort", onExternalAbort);
  });
}

/**
 * Guest→host result merge (contracts.md §6, spec item 4 / F4): "guest input
 * lag is measured on the guest, so the host's summary must ingest the
 * guest's `ExperienceResult` via the `result` message... the composite is
 * computed on the host over the merged set."
 *
 * Merge rule: the guest's `input-lag` sub-score (if present) REPLACES the
 * host's, since input-lag is only meaningful measured where the button was
 * actually pressed; every other sub-score key keeps the host's own
 * measurement, with any guest-only key appended. `raw` keeps both sides
 * verbatim under `raw.host`/`raw.guest` so nothing measured is lost, only
 * combined for the composite. The merged result is tagged with the real
 * session `topology` (never `loopback`, since a real 'result' round-trip
 * only happens over a live two-peer wire) so it counts toward cross-network
 * verdicts (contracts.md §6, `crossNetworkResults`).
 */
export function mergeGuestResult(
  host: ExperienceResult,
  guest: ExperienceResult,
  topology: Topology,
): ExperienceResult {
  const guestByKey = new Map(guest.subScores.map((s) => [s.key, s]));
  const seen = new Set<string>();
  const merged: SubScore[] = host.subScores.map((s) => {
    seen.add(s.key);
    if (s.key === "input-lag" && guestByKey.has("input-lag")) {
      const guestSub = guestByKey.get("input-lag")!;
      return {
        ...guestSub,
        rationale: `[guest-measured, merged via 'result' message] ${guestSub.rationale}`,
      };
    }
    return s;
  });
  for (const s of guest.subScores) {
    if (!seen.has(s.key)) {
      merged.push({ ...s, rationale: `[guest-only sub-score] ${s.rationale}` });
    }
  }

  // A failed host run with a completed guest run is still not scoreable
  // (the host owns the merged summary — contracts.md §6) but IS worth
  // showing; a completed host run always wins the status.
  const status = host.status === "completed" ? "completed" : host.status;

  return {
    experienceId: host.experienceId,
    status,
    topology,
    lossMode: host.lossMode,
    raw: { host: host.raw, guest: guest.raw, guestMerged: true },
    subScores: merged,
    verdict: `${host.verdict} Guest-side (merged): ${guest.verdict}`,
    measuredCaveat: `${host.measuredCaveat} Guest-side caveat: ${guest.measuredCaveat}`,
  };
}
