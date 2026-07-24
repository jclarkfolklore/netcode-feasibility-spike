import { useEffect, useRef, useState } from "react";
import { ExperienceLayout } from "../components/ExperienceLayout";
import { StaleOpponentDiagram } from "../components/diagrams/StaleOpponentDiagram";
import { ResultView } from "../components/ResultView";
import { useRunStore } from "../state/RunStore";
import { LoopbackTransport } from "../lib/transport/loopback";
import { WebSocketTransport } from "../lib/transport/ws";
import { WebRTCTransport } from "../lib/transport/webrtc";
import { computeDistribution, type Distribution } from "../lib/transport/metrics";
import type { Transport } from "../lib/contracts";
import { InterpolationBuffer } from "../experiences/snapshot/interpBuffer";
import { bootE2EGuestGame, bootE2EHostGame, type E2EGuestHandle, type E2EHostHandle } from "../experiences/e2e/bootE2E";
import { NET_E2E_SNAPSHOT_EVENT } from "../experiences/e2e/netFightScene";
import { RemoteInput } from "../experiences/e2e/remoteInput";
import { FeltLagTracker } from "../experiences/e2e/feltLagTracker";
import { wrapWithSimulatedNetwork, type SimulatedNetworkConfig } from "../experiences/e2e/simulatedNetwork";
import { E2E_EXPERIENCE_ID } from "../experiences/e2e/e2eExperience";
import { createE2EBotProvider, E2E_HOST_PHASE, E2E_GUEST_PHASE } from "../experiences/demoBot";
import { MetricTile, MetricTileGrid } from "../components/MetricTile";
import { useDemoModal } from "../components/useDemoModal";
import { ControlGroup } from "../components/ControlGroup";
import { InfoTip } from "../components/InfoTip";
import { Callout } from "../components/Callout";
import type { BandValue } from "../components/Band";
import type { FighterSnap, Snapshot } from "../lib/contracts";

const FRAME_MS = 1000 / 60;

function msToFrames(ms: number): number {
  return ms / FRAME_MS;
}

function feltLagBand(ms: number): BandValue {
  const frames = msToFrames(ms);
  if (frames <= 1) return "good";
  if (frames <= 3) return "acceptable";
  return "bad";
}

type TransportKind = "loopback" | "ws" | "webrtc-unreliable" | "webrtc-reliable";

/**
 * This manual live-demo's OWN real-transport room suffix — distinct from
 * both the automated `e2eExperience.ts` measurement's `${room}::e2e` (see
 * `pairedRoomId` there) and the companion `::control` channel
 * (`RunStore.tsx`), so a person driving this interactive panel by hand
 * never cross-wires with a concurrent "Run automated measurement"/"run all"
 * pass over the same room id (contracts.md §6).
 */
const LIVE_DEMO_ROOM_SUFFIX = "::e2e-live";

function buildRealTransport(kind: Exclude<TransportKind, "loopback">, room: string, role: "host" | "guest"): Transport {
  if (kind === "ws") return new WebSocketTransport({ room, role });
  return new WebRTCTransport({ room, role, mode: kind === "webrtc-unreliable" ? "unreliable" : "reliable" });
}

/**
 * Interactive two-role demo of the full end-to-end loop (F2/F3/F7/F11) —
 * separate from, and a human-driven complement to, the "Run automated
 * measurement" button below (which now does the REAL two-client
 * measurement whenever `?room=` is set — see `e2eExperience.ts`'s module
 * doc comment for the fix):
 * - No `?room=` (solo/loopback): boots BOTH the host sim and the guest
 *   render vehicle on this one page, wired by a `LoopbackTransport` pair —
 *   pressing keys in either canvas drives that side's real keyboard capture
 *   over the identical wire path a real two-machine run would use. An
 *   injected simulated-network panel makes the loopback demo an honest
 *   felt-lag measurement instead of a near-zero-latency non-answer. This is
 *   a SOLO PREVIEW, same as the automated measurement's solo-preview mode —
 *   not a real cross-machine round trip.
 * - With `?room=<id>&role=host|guest`: this page boots ONLY its own role's
 *   half over the selected REAL transport (WS/WebRTC), for a real
 *   two-tab/two-machine run — real DOM keyboard capture (`GuestInputScene`)
 *   sends real `input` messages over that real wire.
 */
function useE2EDemo() {
  const { session } = useRunStore();
  const hostParentRef = useRef<HTMLDivElement | null>(null);
  const guestParentRef = useRef<HTMLDivElement | null>(null);

  const [running, setRunning] = useState(false);
  const [hostLocalPlayer, setHostLocalPlayer] = useState<1 | 2>(1);
  const [remoteInputDelayMs, setRemoteInputDelayMs] = useState(0);
  const [symmetricDelayMs, setSymmetricDelayMs] = useState(0);
  const [guestInterpDelayMs, setGuestInterpDelayMs] = useState(50);
  const [simNetwork, setSimNetwork] = useState<SimulatedNetworkConfig>({ latencyMs: 0, jitterMs: 0, dropPercent: 0 });
  const [transportKind, setTransportKind] = useState<TransportKind>("loopback");

  const [feltLag, setFeltLag] = useState<Distribution | null>(null);
  const [stalenessMs, setStalenessMs] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const [demoBot, setDemoBot] = useState(true);
  const [wire, setWire] = useState<[FighterSnap, FighterSnap] | null>(null);

  const configRef = useRef({ remoteInputDelayMs, symmetricDelayMs, guestInterpDelayMs });
  configRef.current = { remoteInputDelayMs, symmetricDelayMs, guestInterpDelayMs };
  const demoBotRef = useRef(demoBot);
  demoBotRef.current = demoBot;
  const lastHumanInputAt = useRef(0);

  const handles = useRef<{
    host?: E2EHostHandle;
    guest?: E2EGuestHandle;
    remote?: RemoteInput;
    lagTracker: FeltLagTracker;
    interp: InterpolationBuffer;
    rafId: number;
    onSnapshot?: (s: unknown) => void;
    onKeydown?: (e: KeyboardEvent) => void;
    transports: Transport[];
  } | null>(null);

  const guestLocalPlayer: 1 | 2 = hostLocalPlayer === 1 ? 2 : 1;
  const isPaired = session.room !== null;

  async function start() {
    if (running) return;
    setRunning(true);
    const transports: Transport[] = [];

    if (!isPaired) {
      // Solo/loopback: both halves live on this page.
      if (!hostParentRef.current || !guestParentRef.current) return;
      const [hostSideRaw, guestSideRaw] = LoopbackTransport.createPair();
      transports.push(hostSideRaw, guestSideRaw);
      const hostSide = wrapWithSimulatedNetwork(hostSideRaw, simNetwork);
      const guestSide = wrapWithSimulatedNetwork(guestSideRaw, simNetwork);

      const remote = new RemoteInput(guestLocalPlayer, configRef.current.remoteInputDelayMs);
      const lagTracker = new FeltLagTracker();
      const interp = new InterpolationBuffer();

      // Only count inputs once the host is actually FIGHTING. Inputs that
      // arrive during the pre-fight countdown would otherwise queue and drain
      // with multi-second stale felt-lag attribution (the countdown pile-up
      // pitfall; mirrors the automated experience gating presses on isFighting).
      const hostRef: { h?: E2EHostHandle } = {};
      hostSide.onMessage((msg) => {
        if (msg.t === "input" && hostRef.h?.scene.isFighting) remote.ingest(msg, performance.now());
      });
      guestSide.onMessage((msg) => {
        if (msg.t === "snapshot") interp.push(msg);
      });

      // Demo bot: drive BOTH fighters through the real input seams so the loop
      // shows a real fight with no keyboard (DP §10). Host-local fighter via
      // the NetFightScene source override; guest-controlled fighter via the
      // GuestInputScene source override (its inputs flow through the normal
      // single send path, so felt-lag attribution stays correct). Each yields
      // to a real keypress for 5s.
      const botOn = demoBotRef.current;
      const lastHuman = () => lastHumanInputAt.current;

      const host = await bootE2EHostGame(hostParentRef.current, {
        hostLocalPlayer,
        remote,
        getSymmetricDelayTicks: () => Math.round(configRef.current.symmetricDelayMs / FRAME_MS),
        localSource: botOn ? (scene) => createE2EBotProvider(scene, E2E_HOST_PHASE, lastHuman) : undefined,
      });
      const guest = await bootE2EGuestGame(guestParentRef.current, {
        guestLocalPlayer,
        transport: guestSide,
        onInputSent: (msg) => lagTracker.recordSent(msg.seq, msg.tSent),
        localSource: botOn ? (scene) => createE2EBotProvider(scene, E2E_GUEST_PHASE, lastHuman) : undefined,
      });
      hostRef.h = host;

      const onKeydown = () => {
        lastHumanInputAt.current = performance.now();
      };
      window.addEventListener("keydown", onKeydown);

      const onSnapshot = (snapshot: unknown) => hostSide.send(snapshot as Parameters<Transport["send"]>[0]);
      host.game.events.on(NET_E2E_SNAPSHOT_EVENT, onSnapshot);

      const frame = () => {
        const now = performance.now();
        const sample = interp.sampleAt(now, configRef.current.guestInterpDelayMs);
        if (sample) {
          guest.fightScene.applySnapshot(sample);
          const myLastSeq = guestLocalPlayer === 1 ? sample.p1LastInputSeq : sample.p2LastInputSeq;
          lagTracker.attribute(myLastSeq, now);
          setStalenessMs(interp.staleness(now));
          setFeltLag(computeDistribution(lagTracker.samplesMs));
          setTick(host.scene.currentTick);
          setWire((sample as Snapshot).fighters);
        }
        if (handles.current) handles.current.rafId = requestAnimationFrame(frame);
      };
      const rafId = requestAnimationFrame(frame);

      handles.current = { host, guest, remote, lagTracker, interp, rafId, onSnapshot, onKeydown, transports };
      return;
    }

    // Paired: this page is EITHER the host or the guest, per `?role=`.
    const room = `${session.room}${LIVE_DEMO_ROOM_SUFFIX}`;
    const kind = transportKind === "loopback" ? "ws" : transportKind;
    const realTransport = buildRealTransport(kind, room, session.role);
    transports.push(realTransport);

    if (session.role === "host" && hostParentRef.current) {
      const remote = new RemoteInput(guestLocalPlayer, configRef.current.remoteInputDelayMs);
      const hostRef: { h?: E2EHostHandle } = {};
      realTransport.onMessage((msg) => {
        if (msg.t === "input" && hostRef.h?.scene.isFighting) remote.ingest(msg, performance.now());
      });
      const host = await bootE2EHostGame(hostParentRef.current, {
        hostLocalPlayer,
        remote,
        getSymmetricDelayTicks: () => Math.round(configRef.current.symmetricDelayMs / FRAME_MS),
      });
      hostRef.h = host;
      const onSnapshot = (snapshot: unknown) => realTransport.send(snapshot as Parameters<Transport["send"]>[0]);
      host.game.events.on(NET_E2E_SNAPSHOT_EVENT, onSnapshot);
      handles.current = { host, lagTracker: new FeltLagTracker(), interp: new InterpolationBuffer(), rafId: 0, onSnapshot, transports };
      return;
    }

    if (session.role === "guest" && guestParentRef.current) {
      const lagTracker = new FeltLagTracker();
      const interp = new InterpolationBuffer();
      realTransport.onMessage((msg) => {
        if (msg.t === "snapshot") interp.push(msg);
      });
      const guest = await bootE2EGuestGame(guestParentRef.current, {
        guestLocalPlayer,
        transport: realTransport,
        onInputSent: (msg) => lagTracker.recordSent(msg.seq, msg.tSent),
      });

      const frame = () => {
        const now = performance.now();
        const sample = interp.sampleAt(now, configRef.current.guestInterpDelayMs);
        if (sample) {
          guest.fightScene.applySnapshot(sample);
          const myLastSeq = guestLocalPlayer === 1 ? sample.p1LastInputSeq : sample.p2LastInputSeq;
          lagTracker.attribute(myLastSeq, now);
          setStalenessMs(interp.staleness(now));
          setFeltLag(computeDistribution(lagTracker.samplesMs));
        }
        if (handles.current) handles.current.rafId = requestAnimationFrame(frame);
      };
      const rafId = requestAnimationFrame(frame);
      handles.current = { guest, lagTracker, interp, rafId, transports };
    }
  }

  function stop() {
    const h = handles.current;
    if (h) {
      cancelAnimationFrame(h.rafId);
      if (h.onKeydown) window.removeEventListener("keydown", h.onKeydown);
      if (h.host && h.onSnapshot) h.host.game.events.off(NET_E2E_SNAPSHOT_EVENT, h.onSnapshot);
      h.host?.destroy();
      h.guest?.destroy();
      for (const t of h.transports) t.close();
      handles.current = null;
    }
    setRunning(false);
    setFeltLag(null);
    setStalenessMs(null);
    setTick(0);
    setWire(null);
  }

  useEffect(() => stop, []);

  return {
    hostParentRef,
    guestParentRef,
    running,
    start,
    stop,
    hostLocalPlayer,
    setHostLocalPlayer,
    guestLocalPlayer,
    remoteInputDelayMs,
    setRemoteInputDelayMs,
    symmetricDelayMs,
    setSymmetricDelayMs,
    guestInterpDelayMs,
    setGuestInterpDelayMs,
    simNetwork,
    setSimNetwork,
    transportKind,
    setTransportKind,
    feltLag,
    stalenessMs,
    tick,
    wire,
    demoBot,
    setDemoBot,
    isPaired,
    session,
  };
}

export function E2EPage() {
  const { experiences, results, running, runOne, abortAll } = useRunStore();
  const experience = experiences.find((e) => e.id === E2E_EXPERIENCE_ID)!;
  const result = results[experience.id];
  const isRunning = running[experience.id] ?? false;

  const demo = useE2EDemo();
  const modal = useDemoModal();

  return (
    <ExperienceLayout
      testId="page-e2e"
      diagram={<StaleOpponentDiagram />}
      title={experience.title}
      whatItTests={experience.whatItTests}
      whatItTestsMore={experience.whatItTestsMore}
      whyItMatters={experience.whyItMatters}
      howToRead={experience.howToRead}
    >
      <section data-testid="page-e2e-live" className="experience-layout-section">
        <h3 data-testid="page-e2e-live-heading">Live end-to-end loop</h3>
        {demo.isPaired ? (
          <Callout kind="info" testId="page-e2e-live-body">
            Paired session: <code>room={demo.session.room}</code>, <code>role={demo.session.role}</code>. This page
            boots ONLY its role's half over a real transport.
          </Callout>
        ) : (
          <Callout kind="warning" testId="page-e2e-live-body">
            <strong>Solo preview</strong> — no <code>?room=</code> set, so both halves run on this one page over a
            loopback pair. Real input path, but <strong>not</strong> a real network. Open with{" "}
            <code>?room=&lt;id&gt;</code> on two machines for a real measurement.
          </Callout>
        )}

        <ControlGroup title="Roles" testId="page-e2e-group-roles">
          <div className="field-grid">
            <label>
              <span className="field-label-row">
                Host role
                <InfoTip text="Which fighter the host's own keyboard drives; the other fighter is the guest, driven over the wire." />
              </span>
              <select
                data-testid="page-e2e-host-local-player"
                value={demo.hostLocalPlayer}
                disabled={demo.running}
                onChange={(e) => demo.setHostLocalPlayer(Number(e.target.value) as 1 | 2)}
              >
                <option value={1}>Guest controls P2 (default)</option>
                <option value={2}>Guest controls P1</option>
              </select>
            </label>
            {!demo.isPaired && (
              <label className="field-checkbox">
                <input
                  type="checkbox"
                  data-testid="page-e2e-demo-bot"
                  checked={demo.demoBot}
                  disabled={demo.running}
                  onChange={(e) => demo.setDemoBot(e.target.checked)}
                />
                <span className="field-label-row">
                  Demo bot (auto-fight)
                  <InfoTip text="Drives both fighters through a scripted fight with no keyboard. Any real keypress pauses it for 5s." />
                </span>
              </label>
            )}
          </div>
        </ControlGroup>

        <ControlGroup title="Input timing" testId="page-e2e-group-timing">
          <div className="field-grid">
            <label>
              <span className="field-label-row">
                Remote input-delay (ms)
                <InfoTip text="Holds guest inputs briefly so they apply on a consistent tick instead of arriving ragged." />
              </span>
              <input
                type="number"
                data-testid="page-e2e-remote-input-delay"
                min={0}
                max={500}
                value={demo.remoteInputDelayMs}
                onChange={(e) => demo.setRemoteInputDelayMs(Number(e.target.value) || 0)}
              />
            </label>
            <label>
              <span className="field-label-row">
                Symmetric host delay (ms)
                <InfoTip text="Delays the host's OWN input by the same amount as the guest's, so neither player has a hometown advantage." />
              </span>
              <input
                type="number"
                data-testid="page-e2e-symmetric-delay"
                min={0}
                max={500}
                value={demo.symmetricDelayMs}
                onChange={(e) => demo.setSymmetricDelayMs(Number(e.target.value) || 0)}
              />
            </label>
            <label>
              <span className="field-label-row">
                Guest interp buffer (ms)
                <InfoTip text="Extra buffering before the guest renders a snapshot. Higher = smoother under jitter, but adds directly to felt lag." />
              </span>
              <select
                data-testid="page-e2e-interp-delay"
                value={demo.guestInterpDelayMs}
                onChange={(e) => demo.setGuestInterpDelayMs(Number(e.target.value))}
              >
                <option value={0}>0ms</option>
                <option value={50}>50ms</option>
                <option value={100}>100ms</option>
              </select>
            </label>
          </div>
        </ControlGroup>

        {!demo.isPaired && (
          <ControlGroup
            title="Simulated network"
            tip="Applied to the loopback wire so a solo run behaves like a real network."
            testId="page-e2e-group-network"
          >
            <div className="field-grid">
              <label>
                <span className="field-label-row">Simulated latency (ms)</span>
                <input
                  type="number"
                  data-testid="page-e2e-sim-latency"
                  min={0}
                  max={500}
                  value={demo.simNetwork.latencyMs}
                  onChange={(e) => demo.setSimNetwork((c) => ({ ...c, latencyMs: Number(e.target.value) || 0 }))}
                />
              </label>
              <label>
                <span className="field-label-row">Simulated jitter (ms)</span>
                <input
                  type="number"
                  data-testid="page-e2e-sim-jitter"
                  min={0}
                  max={200}
                  value={demo.simNetwork.jitterMs}
                  onChange={(e) => demo.setSimNetwork((c) => ({ ...c, jitterMs: Number(e.target.value) || 0 }))}
                />
              </label>
              <label>
                <span className="field-label-row">Simulated payload-drop (%)</span>
                <input
                  type="number"
                  data-testid="page-e2e-sim-drop"
                  min={0}
                  max={100}
                  value={demo.simNetwork.dropPercent}
                  onChange={(e) => demo.setSimNetwork((c) => ({ ...c, dropPercent: Number(e.target.value) || 0 }))}
                />
              </label>
            </div>
          </ControlGroup>
        )}

        <div className="run-row">
          <button
            type="button"
            data-variant="primary"
            data-testid="page-e2e-live-start"
            disabled={demo.running}
            onClick={() => void demo.start()}
          >
            Start live loop
          </button>
          <button type="button" data-testid="page-e2e-live-stop" disabled={!demo.running} onClick={demo.stop}>
            Stop
          </button>
          <button
            type="button"
            data-testid="page-e2e-live-expand"
            disabled={!demo.running}
            onClick={modal.toggle}
          >
            Expand ⤢
          </button>
        </div>

        {modal.expanded && (
          <button
            type="button"
            className="demo-modal-backdrop"
            aria-label="Close demo"
            onClick={modal.collapse}
          />
        )}
        <div data-testid="page-e2e-canvases" className={`demo-stage${modal.expanded ? " demo-modal" : ""}`}>
          {modal.expanded && (
            <button
              type="button"
              className="demo-modal-close"
              data-variant="primary"
              data-testid="page-e2e-live-collapse"
              onClick={modal.collapse}
            >
              ✕ Close
            </button>
          )}
          {(!demo.isPaired || demo.session.role === "host") && (
            <div className="demo-canvas-cell">
              <div className="demo-canvas-label" data-testid="page-e2e-host-label">
                HOST (real sim — local keyboard drives player {demo.hostLocalPlayer})
              </div>
              <div className="demo-canvas-frame" data-testid="page-e2e-host-parent" ref={demo.hostParentRef}>
                {!demo.running && <div className="canvas-frame-hint">Press Start live loop — the host sim renders here</div>}
              </div>
            </div>
          )}
          {(!demo.isPaired || demo.session.role === "guest") && (
            <div className="demo-canvas-cell">
              <div className="demo-canvas-label" data-testid="page-e2e-guest-label">
                GUEST (render vehicle — local keyboard drives player {demo.guestLocalPlayer}, sent over the wire)
              </div>
              <div className="demo-canvas-frame" data-testid="page-e2e-guest-parent" ref={demo.guestParentRef}>
                {!demo.running && <div className="canvas-frame-hint">Guest renders the received snapshot here</div>}
              </div>
            </div>
          )}
        </div>

        {demo.feltLag && (
          <div className="result-block" data-testid="page-e2e-live-readout">
            <MetricTileGrid testId="page-e2e-live-readout-lag">
              <MetricTile
                label="felt lag p50"
                value={`${demo.feltLag.p50.toFixed(1)}ms`}
                source={`${msToFrames(demo.feltLag.p50).toFixed(2)}f`}
                band={feltLagBand(demo.feltLag.p50)}
              />
              <MetricTile
                label="felt lag p95"
                value={`${demo.feltLag.p95.toFixed(1)}ms`}
                source={`${msToFrames(demo.feltLag.p95).toFixed(2)}f`}
                band={feltLagBand(demo.feltLag.p95)}
              />
              <MetricTile
                label="felt lag p99"
                value={`${demo.feltLag.p99.toFixed(1)}ms`}
                source={`${msToFrames(demo.feltLag.p99).toFixed(2)}f`}
                band={feltLagBand(demo.feltLag.p99)}
              />
              {demo.stalenessMs !== null && (
                <MetricTile label="staleness" value={`${demo.stalenessMs.toFixed(1)}ms`} source="opponent in the past" />
              )}
              <MetricTile label="host tick" value={`${demo.tick}`} source={`n=${demo.feltLag.count}`} />
            </MetricTileGrid>
            {demo.wire && (
              <div className="hud-from-wire" data-testid="page-e2e-live-readout-wire">
                <div className="hud-from-wire-label">From wire — decoded on guest</div>
                <MetricTileGrid>
                  {(["P1", "P2"] as const).map((who, i) => (
                    <MetricTile
                      key={who}
                      label={`${who} state`}
                      value={demo.wire![i].state}
                      source={`hp ${Math.round(demo.wire![i].health)} · meter ${Math.round(demo.wire![i].special)}`}
                      band={demo.wire![i].state === "ko" ? "bad" : "none"}
                    />
                  ))}
                </MetricTileGrid>
              </div>
            )}
          </div>
        )}

        <Callout kind="note" testId="page-e2e-live-caveat">
          Felt lag = simulated network + real app-processing latency, measured in the browser (input event
          timestamp → <code>lastInputSeq</code> attribution → committed rAF delta) — comparative, <strong>not</strong>{" "}
          hardware glass-to-glass (that needs LDAT/photodiode).
        </Callout>
      </section>

      <div className="run-row">
        <button
          type="button"
          className="btn-primary"
          data-variant="primary"
          data-testid="page-e2e-run-button"
          disabled={isRunning}
          onClick={() => void runOne(experience.id)}
        >
          {isRunning ? "Running…" : "Run measurement"}
        </button>
        <button type="button" data-testid="page-e2e-abort-button" disabled={!isRunning} onClick={abortAll}>
          Abort
        </button>
        <span className={`run-mode-badge ${demo.isPaired ? "is-real" : "is-solo"}`}>
          {demo.isPaired ? `real · ${demo.session.role} half` : "solo preview · simulated network"}
        </span>
      </div>

      {result ? (
        <div className="result-block">
          <ResultView testId="page-e2e-result" result={result} />
        </div>
      ) : (
        <div className="result-block ghost-table" data-testid="page-e2e-result-empty">
          Results appear here after a run: felt-lag p50 / p95 / p99 stat tiles + verdict.
        </div>
      )}

      <details className="section-collapsible" data-testid="page-e2e-fidelity-note">
        <summary data-testid="page-e2e-fidelity-note-heading">Fidelity caveat — the input seam</summary>
        <p data-testid="page-e2e-fidelity-note-body">
          The input seam is the "subclassed path": a harness-side <code>NetFightScene extends FightScene</code> swaps
          the inherited <code>keyboard</code> field after <code>super.create()</code> and adds a tick counter in an
          overridden <code>update()</code> — the same inherited combat/rematch logic runs unchanged, driven through
          the swapped provider. No <code>src/</code> file is edited. The rematch poll (<code>FightScene.ts:163</code>,{" "}
          <code>getInput(1).special</code>) is affected by which slot is local vs. remote (F15) — whichever side
          controls P1 can trigger the rematch.
        </p>
      </details>
    </ExperienceLayout>
  );
}
