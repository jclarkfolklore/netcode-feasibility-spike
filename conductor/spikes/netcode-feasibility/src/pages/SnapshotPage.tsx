import { useEffect, useRef, useState } from "react";
import { ExperienceLayout } from "../components/ExperienceLayout";
import { SnapshotDiagram } from "../components/diagrams/SnapshotDiagram";
import { ResultView } from "../components/ResultView";
import { MetricTile, MetricTileGrid } from "../components/MetricTile";
import { Callout } from "../components/Callout";
import { ControlGroup } from "../components/ControlGroup";
import { InfoTip } from "../components/InfoTip";
import { KeyLegend } from "../components/KeyLegend";
import { useDemoModal } from "../components/useDemoModal";
import { useRunStore } from "../state/RunStore";
import { bootGuestGame, bootHostGame, type GuestGameHandle, type HostGameHandle } from "../experiences/snapshot/bootGames";
import { NET_SNAPSHOT_EVENT, type SnapshotHostScene } from "../experiences/snapshot/hostScene";
import { InterpolationBuffer } from "../experiences/snapshot/interpBuffer";
import { measureEncodeCost, encodeBinary, decodeBinary, BINARY_FULL_SIZE } from "../experiences/snapshot/snapshotCodec";
import { createSnapshotBotProvider } from "../experiences/demoBot";
import type { GuestRenderMode } from "../experiences/snapshot/guestScene";
import type { FighterSnap, Snapshot } from "../lib/contracts";

const EXPERIENCE_ID = "sim-snapshot";

interface LiveReadout {
  tick: number;
  jsonBytes: number;
  binaryBytes: number;
  deltaBytes: number;
  jsonMs: number;
  binaryMs: number;
  deltaMs: number;
  stalenessMs: number;
  /** Per-fighter state read from the RECEIVED (decoded + applied) snapshot. */
  wire: [FighterSnap, FighterSnap];
}

/**
 * Interactive host/guest demo — separate from the automated `run()` used for
 * scoring/ExperienceResult. This is the "look at it" half of the sub-spec
 * (F6/F7): a live host FightScene (keyboard-drivable: WASD/FGSHIFT/Q for P1,
 * arrows/./,/UP//SLASH/ENTER for P2 — same bindings as the normal game) next
 * to a live guest render vehicle, so the fidelity gap is visibly, not just
 * numerically, honest.
 */
function useLiveSnapshotDemo() {
  const hostParentRef = useRef<HTMLDivElement | null>(null);
  const guestParentRef = useRef<HTMLDivElement | null>(null);
  const [running, setRunning] = useState(false);
  const [readout, setReadout] = useState<LiveReadout | null>(null);
  const [interpDelayMs, setInterpDelayMs] = useState(50);
  // Default to redrive-mutators: it re-runs the pose functions so the guest
  // animates too — the round-trip / mirroring reads clearly. state-only stays
  // available as the explicit "watch what's lost" toggle.
  const [renderMode, setRenderMode] = useState<GuestRenderMode>("redrive-mutators");
  const [demoBot, setDemoBot] = useState(true);
  const interpDelayRef = useRef(interpDelayMs);
  interpDelayRef.current = interpDelayMs;
  const demoBotRef = useRef(demoBot);
  demoBotRef.current = demoBot;
  const lastHumanInputAt = useRef(0);

  const handles = useRef<{
    host: HostGameHandle;
    guest: GuestGameHandle;
    interp: InterpolationBuffer;
    onSnapshot: (s: Snapshot) => void;
    onKeydown: (e: KeyboardEvent) => void;
  } | null>(null);

  useEffect(() => {
    if (handles.current) handles.current.guest.scene.mode = renderMode;
  }, [renderMode]);

  async function start() {
    if (running || !hostParentRef.current || !guestParentRef.current) return;
    setRunning(true);

    // Any real keypress pauses the bot so a human can take over (DP §10).
    const onKeydown = () => {
      lastHumanInputAt.current = performance.now();
    };
    window.addEventListener("keydown", onKeydown);

    // When the bot is on, drive BOTH fighters through real movement/combat via
    // the host scene's input seam — so the fighters walk around and the guest
    // visibly mirrors that movement a beat later (the round trip).
    const lastHuman = () => lastHumanInputAt.current;
    const localSource = demoBotRef.current
      ? (scene: SnapshotHostScene) => createSnapshotBotProvider(scene, () => scene.currentTick, lastHuman)
      : undefined;

    const host = await bootHostGame(hostParentRef.current, { localSource });
    const guest = await bootGuestGame(guestParentRef.current);
    guest.scene.mode = renderMode;
    const interp = new InterpolationBuffer();
    let prev: Snapshot | null = null;

    const onSnapshot = (snapshot: Snapshot) => {
      const cost = measureEncodeCost(prev, snapshot);
      prev = snapshot;

      // Honesty: the payload the guest renders is the REAL encoded snapshot,
      // routed through encode → decode → apply. The bytes shown are the bytes
      // applied — never a same-process object handoff (UX-REVIEW W1.2).
      const decoded = decodeBinary(encodeBinary(snapshot).bytes);
      interp.push(decoded);
      const sample = interp.sampleAt(decoded.hostTime, interpDelayRef.current);
      if (sample) guest.scene.applySnapshot(sample);

      const wireFrom = sample ?? decoded;
      setReadout({
        tick: snapshot.tick,
        jsonBytes: cost.jsonBytes,
        binaryBytes: cost.binaryBytes,
        deltaBytes: cost.deltaBytes,
        jsonMs: cost.jsonMs,
        binaryMs: cost.binaryMs,
        deltaMs: cost.deltaMs,
        stalenessMs: interp.staleness(snapshot.hostTime),
        wire: wireFrom.fighters,
      });
    };

    host.game.events.on(NET_SNAPSHOT_EVENT, onSnapshot);
    handles.current = { host, guest, interp, onSnapshot, onKeydown };
  }

  function stop() {
    if (handles.current) {
      window.removeEventListener("keydown", handles.current.onKeydown);
      handles.current.host.game.events.off(NET_SNAPSHOT_EVENT, handles.current.onSnapshot);
      handles.current.host.destroy();
      handles.current.guest.destroy();
      handles.current = null;
    }
    setRunning(false);
    setReadout(null);
  }

  useEffect(() => stop, []);

  return {
    hostParentRef,
    guestParentRef,
    running,
    readout,
    start,
    stop,
    interpDelayMs,
    setInterpDelayMs,
    renderMode,
    setRenderMode,
    demoBot,
    setDemoBot,
  };
}

export function SnapshotPage() {
  const { experiences, results, running, runOne, abortAll } = useRunStore();
  const experience = experiences.find((e) => e.id === EXPERIENCE_ID)!;
  const result = results[experience.id];
  const isRunning = running[experience.id] ?? false;

  const demo = useLiveSnapshotDemo();
  const modal = useDemoModal();

  return (
    <ExperienceLayout
      testId="page-sim-snapshot"
      diagram={<SnapshotDiagram />}
      title={experience.title}
      whatItTests={experience.whatItTests}
      whatItTestsMore={experience.whatItTestsMore}
      whyItMatters={experience.whyItMatters}
      howToRead={experience.howToRead}
    >
      <section data-testid="page-sim-snapshot-live" className="experience-layout-section">
        <h3 data-testid="page-sim-snapshot-live-heading">Live host / guest side-by-side</h3>
        <p data-testid="page-sim-snapshot-live-body">
          Host (left) is the REAL FightScene; guest (right) is a separate, render-only scene that only
          applies incoming snapshots — it never runs combat. With the demo bot off, drive it yourself:
        </p>
        <KeyLegend testId="page-sim-snapshot-keys" />

        <div className="run-row">
          <button
            type="button"
            data-variant={demo.running ? undefined : "primary"}
            data-testid="page-sim-snapshot-live-start"
            disabled={demo.running}
            onClick={() => void demo.start()}
          >
            Start live demo
          </button>
          <button
            type="button"
            data-testid="page-sim-snapshot-live-stop"
            disabled={!demo.running}
            onClick={demo.stop}
          >
            Stop
          </button>
          <button
            type="button"
            data-testid="page-sim-snapshot-live-expand"
            disabled={!demo.running}
            onClick={modal.toggle}
          >
            Expand ⤢
          </button>
        </div>

        <ControlGroup title="Demo controls" testId="page-sim-snapshot-demo-controls">
          <div className="field-grid">
            <label>
              <span className="field-label-row">
                Interp delay (ms)
                <InfoTip text="How far behind 'now' the guest renders. Higher smooths jitter but adds directly to how stale the opponent looks." />
              </span>
              <select
                data-testid="page-sim-snapshot-interp-delay"
                value={demo.interpDelayMs}
                onChange={(e) => demo.setInterpDelayMs(Number(e.target.value))}
              >
                <option value={0}>0ms</option>
                <option value={50}>50ms</option>
                <option value={100}>100ms</option>
              </select>
            </label>
            <label>
              <span className="field-label-row">
                Guest render mode
                <InfoTip text="state-only applies snapshot fields directly; redrive-mutators additionally re-calls the host's public move functions to approximate pose." />
              </span>
              <select
                data-testid="page-sim-snapshot-render-mode"
                value={demo.renderMode}
                onChange={(e) => demo.setRenderMode(e.target.value as GuestRenderMode)}
              >
                <option value="state-only">state-only (default)</option>
                <option value="redrive-mutators">redrive-mutators (experimental)</option>
              </select>
            </label>
            <label className="field-checkbox">
              <input
                type="checkbox"
                data-testid="page-sim-snapshot-demo-bot"
                checked={demo.demoBot}
                onChange={(e) => demo.setDemoBot(e.target.checked)}
              />
              <span className="field-label-row">
                Demo bot (auto-fight)
                <InfoTip text="Runs a scripted fight with no keyboard. Any real keypress pauses it for 5s so you can take over." />
              </span>
            </label>
          </div>
        </ControlGroup>

        {modal.expanded && (
          <button
            type="button"
            className="demo-modal-backdrop"
            aria-label="Close demo"
            onClick={modal.collapse}
          />
        )}
        <div
          data-testid="page-sim-snapshot-canvases"
          className={`demo-stage${modal.expanded ? " demo-modal" : ""}`}
        >
          {modal.expanded && (
            <button
              type="button"
              className="demo-modal-close"
              data-variant="primary"
              data-testid="page-sim-snapshot-live-collapse"
              onClick={modal.collapse}
            >
              ✕ Close
            </button>
          )}
          <div className="demo-canvas-cell">
            <div className="demo-canvas-label" data-testid="page-sim-snapshot-host-label">
              HOST (real sim)
            </div>
            <div className="demo-canvas-frame" data-testid="page-sim-snapshot-host-parent" ref={demo.hostParentRef}>
              {!demo.running && <div className="canvas-frame-hint">Press Start live demo — the real fight sim renders here</div>}
            </div>
          </div>
          <div className="demo-canvas-cell">
            <div className="demo-canvas-label" data-testid="page-sim-snapshot-guest-label">
              GUEST (snapshot render vehicle)
            </div>
            <div className="demo-canvas-frame" data-testid="page-sim-snapshot-guest-parent" ref={demo.guestParentRef}>
              {!demo.running && <div className="canvas-frame-hint">Guest renders the received snapshot here</div>}
            </div>
            {demo.running && !modal.expanded && (
              <div className="demo-canvas-caption" data-testid="page-sim-snapshot-guest-caption">
                Same fight, rendered{" "}
                <strong>{demo.readout ? `${demo.readout.stalenessMs.toFixed(0)}ms` : "~50ms"}</strong> behind — the
                round trip. Position &amp; health mirror; <code>redrive-mutators</code> approximates the pose,
                <code>state-only</code> drops it.
              </div>
            )}
          </div>
        </div>

        {demo.readout && (
          <div className="result-block" data-testid="page-sim-snapshot-live-readout">
            <MetricTileGrid testId="page-sim-snapshot-live-readout-payload">
              <MetricTile label="binary" value={`${demo.readout.binaryBytes}B`} source={`${demo.readout.binaryMs.toFixed(3)}ms · ${BINARY_FULL_SIZE}B fixed`} band="good" />
              <MetricTile label="delta" value={`${demo.readout.deltaBytes}B`} source={`${demo.readout.deltaMs.toFixed(3)}ms encode`} band="good" />
              <MetricTile label="json" value={`${demo.readout.jsonBytes}B`} source={`${demo.readout.jsonMs.toFixed(3)}ms encode`} />
              <MetricTile label="staleness" value={`${demo.readout.stalenessMs.toFixed(1)}ms`} source="host − rendered" />
              <MetricTile label="tick" value={`${demo.readout.tick}`} source="host sim" />
            </MetricTileGrid>
            <div className="hud-from-wire" data-testid="page-sim-snapshot-live-readout-wire">
              <div className="hud-from-wire-label">From wire — decoded on guest</div>
              <MetricTileGrid>
                {(["P1", "P2"] as const).map((who, i) => (
                  <MetricTile
                    key={who}
                    label={`${who} state`}
                    value={demo.readout!.wire[i].state}
                    source={`hp ${Math.round(demo.readout!.wire[i].health)} · meter ${Math.round(demo.readout!.wire[i].special)}`}
                    band={demo.readout!.wire[i].state === "ko" ? "bad" : "none"}
                  />
                ))}
              </MetricTileGrid>
            </div>
          </div>
        )}
      </section>

      <div className="run-row">
        <button
          type="button"
          data-variant="primary"
          data-testid="page-sim-snapshot-run-button"
          disabled={isRunning}
          onClick={() => void runOne(experience.id)}
        >
          {isRunning ? "Running…" : "Run measurement"}
        </button>
        <button
          type="button"
          data-testid="page-sim-snapshot-abort-button"
          disabled={!isRunning}
          onClick={abortAll}
        >
          Abort
        </button>
        <span className="run-mode-badge is-solo">solo · loopback</span>
      </div>

      {result ? (
        <div className="result-block">
          <ResultView testId="page-sim-snapshot-result" result={result} />
        </div>
      ) : (
        <div className="result-block ghost-table" data-testid="page-sim-snapshot-result-empty">
          Results appear here after a run: serialization ladder (json / binary / delta bytes + encode ms) + verdict.
        </div>
      )}

      <details className="section-collapsible" data-testid="page-sim-snapshot-fidelity">
        <summary data-testid="page-sim-snapshot-fidelity-heading">The fidelity-gap finding, in plain language</summary>
        <div data-testid="page-sim-snapshot-fidelity-body" className="result-details-body">
          <p>
            <strong>Mirrors cleanly:</strong> position, <code>health</code>/<code>confidence</code>/
            <code>special</code>, facing, and the logical <code>state</code>/timers — the guest's
            HUD-visible numbers match the host every tick.
          </p>
          <p>
            <strong>Doesn't reproduce from state alone:</strong> pose/tweens (attack lunges, hit-flash,
            block-shield, charge-ring, walk leg-swing, the move-badge text) — they're Phaser Tween side
            effects of the sim's private mutators, never stored as snapshottable fields.
            <code>redrive-mutators</code> recovers <em>some</em> pose by re-calling the public mutators,
            but only approximately — the frozen <code>Snapshot</code> schema doesn't carry which
            move/attack kind played, so an attack can only be guessed as a generic light attack.
          </p>
          <Callout kind="warning" testId="page-sim-snapshot-fidelity-callout">
            The snapshot doesn't carry <strong>which attack is playing</strong> — the guest sees
            <code>state: attack</code> + timers but must guess the move. A production schema needs a
            move-identity field. (See <code>raw.fidelity</code> / <code>raw.productionApiFinding</code>
            in the measured result.)
          </Callout>
        </div>
      </details>
    </ExperienceLayout>
  );
}
