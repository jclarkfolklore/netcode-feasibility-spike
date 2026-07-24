import { useEffect, useMemo, useRef, useState } from "react";
import { ExperienceLayout } from "../components/ExperienceLayout";
import { TcpHolBlockingDiagram } from "../components/diagrams/TcpHolBlockingDiagram";
import { ResultView } from "../components/ResultView";
import { Callout } from "../components/Callout";
import { useRunStore } from "../state/RunStore";
import { runExperience } from "../lib/experience/runner";
import type { ExperienceResult, LossMode } from "../lib/contracts";
import {
  ALL_TRANSPORT_KINDS,
  FULL_LOSS_PERCENTS,
  FULL_PAYLOAD_BYTES,
  FULL_RATES_HZ,
  type CellResult,
  type TransportKind,
  type TransportSweepConfig,
} from "../lib/experience/transportExperience";

const EXPERIENCE_ID = "transport";
const CUSTOM_SWEEP_TIMEOUT_MS = 180_000; // the full matrix can take minutes; the runner default (30s) is not enough.

/** Measures the browser's actual `performance.now()` timer resolution (F16 investigation). */
function measureClockResolution(samples = 500): number {
  let minDelta = Infinity;
  let prev = performance.now();
  for (let i = 0; i < samples; i++) {
    const now = performance.now();
    const delta = now - prev;
    if (delta > 0 && delta < minDelta) minDelta = delta;
    prev = now;
  }
  return Number.isFinite(minDelta) ? minDelta : 0;
}

function CrossOriginIsolationPanel() {
  const [resolutionMs, setResolutionMs] = useState<number | null>(null);
  const isolated = typeof window !== "undefined" ? window.crossOriginIsolated : undefined;

  return (
    <section data-testid="page-transport-coi" className="experience-layout-section">
      <h3 data-testid="page-transport-coi-heading">Timer precision diagnostic</h3>
      <p data-testid="page-transport-coi-status">
        <code>window.crossOriginIsolated</code>: <strong>{String(isolated)}</strong>. Both
        `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`
        are served in dev (vite.config.ts) and prod (server/staticServer.ts) — see this page's build
        notes below for why it can still read `false` in a real browser, and why RTT numbers here are
        unaffected either way.
      </p>
      <button
        type="button"
        data-testid="page-transport-coi-measure-button"
        onClick={() => setResolutionMs(measureClockResolution())}
      >
        Measure performance.now() resolution
      </button>
      {resolutionMs !== null && (
        <p data-testid="page-transport-coi-resolution">
          Smallest observed nonzero delta across 500 back-to-back calls:{" "}
          <strong>{resolutionMs.toFixed(4)}ms</strong>.
        </p>
      )}
    </section>
  );
}

function LinkLossPanel() {
  const [state, setState] = useState<{ enabled: boolean; dropRate: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const res = await fetch("/api/loss");
      if (!res.ok) throw new Error(`GET /api/loss -> ${res.status}`);
      setState(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const toggle = async (enabled: boolean, dropRate: number) => {
    try {
      const res = await fetch("/api/loss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, dropRate }),
      });
      if (!res.ok) throw new Error(`POST /api/loss -> ${res.status}`);
      setState(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section data-testid="page-transport-link-loss" className="experience-layout-section">
      <h3 data-testid="page-transport-link-loss-heading">Server link-loss proxy (contracts.md §4)</h3>
      <p data-testid="page-transport-link-loss-status">
        {error
          ? `Unreachable: ${error} (static preview without the Node server? sweeps below will show no real loss.)`
          : state
            ? `enabled: ${state.enabled} · dropRate: ${state.dropRate}`
            : "loading…"}
      </p>
      <button type="button" data-testid="page-transport-link-loss-enable-2pct" onClick={() => void toggle(true, 0.02)}>
        Enable 2% link-loss
      </button>
      <button type="button" data-testid="page-transport-link-loss-disable" onClick={() => void toggle(false, 0)}>
        Disable link-loss
      </button>
      <p className="result-caveat">
        The sweep below toggles this automatically per `link-loss` cell — these buttons are for manual
        poking (e.g. to confirm the proxy is reachable) between runs.
      </p>
    </section>
  );
}

function CellTable({ cells }: { cells: CellResult[] }) {
  if (cells.length === 0) return null;
  return (
    <div data-testid="page-transport-cell-table" style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.85rem" }}>
        <thead>
          <tr>
            {["transport", "rate", "payload", "lossMode", "loss%", "p50", "p95", "p99", "max", "jitter", "loss% obs.", "reorder", "note"].map(
              (h) => (
                <th key={h} style={{ textAlign: "left", borderBottom: "1px solid currentColor", padding: "0.25rem 0.5rem" }}>
                  {h}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {cells.map((c, i) => (
            <tr key={i} data-testid={`page-transport-cell-row-${i}`}>
              <td style={{ padding: "0.25rem 0.5rem" }}>{c.transport}</td>
              <td style={{ padding: "0.25rem 0.5rem" }}>{c.rateHz}Hz</td>
              <td style={{ padding: "0.25rem 0.5rem" }}>{c.payloadBytes}B</td>
              <td style={{ padding: "0.25rem 0.5rem" }}>
                {c.lossMode}
                {c.lossMode === "payload-drop" && " (not HOL)"}
              </td>
              <td style={{ padding: "0.25rem 0.5rem" }}>{c.lossPercent}%</td>
              <td style={{ padding: "0.25rem 0.5rem" }}>{c.rttMs.p50.toFixed(1)}</td>
              <td style={{ padding: "0.25rem 0.5rem" }}>{c.rttMs.p95.toFixed(1)}</td>
              <td style={{ padding: "0.25rem 0.5rem" }}>{c.rttMs.p99.toFixed(1)}</td>
              <td style={{ padding: "0.25rem 0.5rem" }}>{c.rttMs.max.toFixed(1)}</td>
              <td style={{ padding: "0.25rem 0.5rem" }}>{c.jitterMs.toFixed(1)}</td>
              <td style={{ padding: "0.25rem 0.5rem" }}>{c.lossPercentObserved.toFixed(1)}%</td>
              <td style={{ padding: "0.25rem 0.5rem" }}>{c.reorderCount}</td>
              <td style={{ padding: "0.25rem 0.5rem" }}>
                {c.pathological ? "expected-pathological (F14 — SCTP fragmentation)" : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function toggleInArray<T>(arr: T[], value: T): T[] {
  return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
}

/**
 * The 008.3 Transport experience page. Exports `TransportPage` (named, for
 * the supervisor to wire into `App.tsx`'s route switch) alongside the
 * store-driven default-config run (manual button + "run all", identical
 * path) and page-local "advanced sweep" controls for the full rate x
 * payload x loss matrix (spec item 3) — the shared `RunStore` only ever
 * runs an experience's `defaultConfig`, so the deeper matrix is run here,
 * directly through `runExperience`, with its own longer timeout and its
 * own local result state.
 */
export function TransportPage() {
  const { experiences, results, running, runOne, abortAll, session } = useRunStore();
  const experience = experiences.find((e) => e.id === EXPERIENCE_ID)!;
  const defaultResult = results[experience.id];
  const isRunning = running[experience.id] ?? false;

  const [transports, setTransports] = useState<TransportKind[]>(ALL_TRANSPORT_KINDS);
  const [rates, setRates] = useState<number[]>([60]);
  const [payloadSizes, setPayloadSizes] = useState<number[]>([64, 1024, 16384]);
  const [lossMode, setLossMode] = useState<LossMode>("link-loss");
  const [lossRates, setLossRates] = useState<number[]>([0, 2, 5]);
  const [samplesPerCell, setSamplesPerCell] = useState(15);

  const [customResult, setCustomResult] = useState<ExperienceResult | null>(null);
  const [customRunning, setCustomRunning] = useState(false);
  const customAbortRef = useRef<AbortController | null>(null);

  const customConfig: TransportSweepConfig = useMemo(
    () => ({ transports, rates, payloadSizes, lossMode, lossRates, samplesPerCell, perPingTimeoutMs: 500 }),
    [transports, rates, payloadSizes, lossMode, lossRates, samplesPerCell],
  );

  const runCustomSweep = async () => {
    const controller = new AbortController();
    customAbortRef.current = controller;
    setCustomRunning(true);
    try {
      const result = await runExperience(experience, customConfig, {
        signal: controller.signal,
        timeoutMs: CUSTOM_SWEEP_TIMEOUT_MS,
      });
      setCustomResult(result);
    } finally {
      setCustomRunning(false);
    }
  };

  return (
    <ExperienceLayout
      testId="page-transport"
      diagram={<TcpHolBlockingDiagram />}
      title={experience.title}
      whatItTests={experience.whatItTests}
      whatItTestsMore={experience.whatItTestsMore}
      whyItMatters={experience.whyItMatters}
      howToRead={experience.howToRead}
    >
      <div className="chip-row" data-testid="page-transport-session-note">
        <span className="context-chip mono">room {session.room ?? "(none)"}</span>
        <span className="context-chip mono">role {session.role}</span>
        <span className="context-chip mono">topo {session.topology}</span>
      </div>
      {session.room ? (
        <Callout kind="info">A live room is set — runs below use real WebSocket/WebRTC transports.</Callout>
      ) : (
        <Callout kind="warning">
          <strong>Loopback only</strong> — no <code>?room=</code> set, so runs below just demonstrate the plumbing
          (near-zero latency, not a real network). Open this page with <code>?room=&lt;id&gt;</code> in two tabs
          (one host, one guest) for the real sweep.
        </Callout>
      )}

      <section className="experience-layout-section">
        <h3 data-testid="page-transport-default-heading">Default run (manual / run-all — identical config)</h3>
        <button
          type="button"
          data-variant="primary"
          data-testid="page-transport-run-button"
          disabled={isRunning}
          onClick={() => void runOne(experience.id)}
        >
          {isRunning ? "Running…" : "Run default sweep"}
        </button>
        <button type="button" data-testid="page-transport-abort-button" disabled={!isRunning} onClick={abortAll}>
          Abort
        </button>
        {defaultResult ? (
          <div className="result-block">
            <ResultView testId="page-transport-result" result={defaultResult} />
            <CellTable cells={(defaultResult.raw as { cells?: CellResult[] }).cells ?? []} />
          </div>
        ) : (
          <div className="result-block ghost-table" data-testid="page-transport-result-empty">
            Results appear here after a run: RTT p50 / p95 / p99, jitter, and observed loss per transport.
          </div>
        )}
      </section>

      <details className="section-collapsible" data-testid="page-transport-advanced">
        <summary data-testid="page-transport-advanced-heading">
          Advanced sweep — full matrix (rate × payload × loss)
        </summary>

        <fieldset data-testid="page-transport-transports-field">
          <legend>Transports</legend>
          {ALL_TRANSPORT_KINDS.map((kind) => (
            <label key={kind} style={{ marginRight: "1rem" }}>
              <input
                type="checkbox"
                data-testid={`page-transport-transport-toggle-${kind}`}
                checked={transports.includes(kind)}
                onChange={() => setTransports((t) => toggleInArray(t, kind))}
              />{" "}
              {kind}
            </label>
          ))}
        </fieldset>

        <fieldset data-testid="page-transport-rates-field">
          <legend>Rates (Hz)</legend>
          {FULL_RATES_HZ.map((hz) => (
            <label key={hz} style={{ marginRight: "1rem" }}>
              <input
                type="checkbox"
                data-testid={`page-transport-rate-toggle-${hz}`}
                checked={rates.includes(hz)}
                onChange={() => setRates((r) => toggleInArray(r, hz))}
              />{" "}
              {hz}Hz
            </label>
          ))}
        </fieldset>

        <fieldset data-testid="page-transport-payloads-field">
          <legend>Payload sizes (bytes) — 16384 x webrtc-unreliable is expected-pathological (F14)</legend>
          {FULL_PAYLOAD_BYTES.map((b) => (
            <label key={b} style={{ marginRight: "1rem" }}>
              <input
                type="checkbox"
                data-testid={`page-transport-payload-toggle-${b}`}
                checked={payloadSizes.includes(b)}
                onChange={() => setPayloadSizes((p) => toggleInArray(p, b))}
              />{" "}
              {b}B
            </label>
          ))}
        </fieldset>

        <fieldset data-testid="page-transport-lossmode-field">
          <legend>Loss mode</legend>
          <label style={{ marginRight: "1rem" }}>
            <input
              type="radio"
              data-testid="page-transport-lossmode-none"
              name="lossMode"
              checked={lossMode === "none"}
              onChange={() => setLossMode("none")}
            />{" "}
            none
          </label>
          <label style={{ marginRight: "1rem" }}>
            <input
              type="radio"
              data-testid="page-transport-lossmode-payload-drop"
              name="lossMode"
              checked={lossMode === "payload-drop"}
              onChange={() => setLossMode("payload-drop")}
            />{" "}
            payload-drop (app-layer, NOT HOL)
          </label>
          <label>
            <input
              type="radio"
              data-testid="page-transport-lossmode-link-loss"
              name="lossMode"
              checked={lossMode === "link-loss"}
              onChange={() => setLossMode("link-loss")}
            />{" "}
            link-loss (real HOL on the WS leg — the only valid WS-vs-WebRTC basis)
          </label>
        </fieldset>

        <fieldset data-testid="page-transport-lossrates-field">
          <legend>Loss %</legend>
          {FULL_LOSS_PERCENTS.map((pct) => (
            <label key={pct} style={{ marginRight: "1rem" }}>
              <input
                type="checkbox"
                data-testid={`page-transport-lossrate-toggle-${pct}`}
                checked={lossRates.includes(pct)}
                disabled={lossMode === "none"}
                onChange={() => setLossRates((r) => toggleInArray(r, pct))}
              />{" "}
              {pct}%
            </label>
          ))}
        </fieldset>

        <label data-testid="page-transport-samples-field">
          Samples per cell:{" "}
          <input
            type="number"
            data-testid="page-transport-samples-input"
            min={1}
            max={200}
            value={samplesPerCell}
            onChange={(e) => setSamplesPerCell(Number(e.target.value) || 1)}
          />
        </label>

        <div>
          <button
            type="button"
            data-testid="page-transport-run-custom-button"
            disabled={customRunning || transports.length === 0 || rates.length === 0 || payloadSizes.length === 0}
            onClick={() => void runCustomSweep()}
          >
            {customRunning ? "Running sweep…" : "Run custom sweep"}
          </button>
          <button
            type="button"
            data-testid="page-transport-abort-custom-button"
            disabled={!customRunning}
            onClick={() => customAbortRef.current?.abort("user-abort")}
          >
            Abort
          </button>
        </div>

        {customResult && (
          <>
            <ResultView testId="page-transport-custom-result" result={customResult} />
            <CellTable cells={(customResult.raw as { cells?: CellResult[] }).cells ?? []} />
          </>
        )}
      </details>

      <details className="section-collapsible" data-testid="page-transport-diagnostics">
        <summary>Diagnostics &amp; manual controls</summary>
        <LinkLossPanel />
        <CrossOriginIsolationPanel />
      </details>

      <details className="section-collapsible" data-testid="page-transport-notes">
        <summary>Build notes — timer precision &amp; isolation</summary>
        <p>
          COOP/COEP headers alone make `crossOriginIsolated` true only for a TOP-LEVEL document whose
          entire subresource graph also satisfies CORP/CORS — a single cross-origin, no-CORP
          subresource (e.g. a font, a script, or the Vite dev client's own HMR websocket in some
          setups) silently keeps it `false` with no console error. It is also always `false` inside
          an iframe unless that iframe itself is served with the headers and `allow="cross-origin-
          isolated"`, which trips up any preview surface that embeds this app in a frame. Neither
          transport measurement here depends on it: RTT is `performance.now()`-based peer-echo, and
          modern browsers already grant sub-millisecond `performance.now()` resolution to a
          same-origin, top-level, HTTPS (or localhost) document regardless of isolation — isolation
          only ever *reduces* an already-coarser default back toward full resolution for cross-origin
          contexts. Use the "Measure performance.now() resolution" button above for this machine's
          actual number instead of assuming from `crossOriginIsolated` alone.
        </p>
      </details>
    </ExperienceLayout>
  );
}
