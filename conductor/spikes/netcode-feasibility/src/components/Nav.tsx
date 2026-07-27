import { useState } from "react";
import { useRunStore } from "../state/RunStore";
import { SessionSetup } from "./SessionSetup";
import { InstructionsModal } from "./InstructionsModal";

interface Props {
  route: string;
  onNavigate: (route: string) => void;
}

function StatusDot({ state }: { state: "idle" | "running" | "done" | "failed" }) {
  return <span className={`nav-dot nav-dot-${state}`} aria-hidden="true" />;
}

/** Explicit tight nav labels; fall back to the title's lead clause. */
const NAV_LABELS: Record<string, string> = {
  transport: "Transport",
  "sim-snapshot": "Sim-snapshot",
  "e2e-remote-input": "Remote input (E2E)",
  "determinism-cost": "Determinism",
};
function shortLabel(id: string, title: string): string {
  if (NAV_LABELS[id]) return NAV_LABELS[id];
  const cut = title.search(/[(:]/);
  return (cut > 0 ? title.slice(0, cut) : title).trim();
}

export function Nav({ route, onNavigate }: Props) {
  const {
    experiences,
    runState,
    session,
    companionHealth,
    hostDriven,
    runAllExperiences,
    runAllInProgress,
    abortAll,
  } = useRunStore();

  const [instructionsOpen, setInstructionsOpen] = useState(false);

  // Single source of truth (RunStore.runState); "completed" maps to the "done"
  // dot class. Sidebar dots, Summary scoreboard, and page chips cannot disagree.
  const dotState = (id: string): "idle" | "running" | "done" | "failed" => {
    const s = runState(id);
    return s === "completed" ? "done" : s;
  };

  // What's running RIGHT NOW, for the connection panel: a guest learns it from
  // the companion channel (the host drove it); a host learns it from its own
  // run-state. Either way, one line the operator can watch instead of guessing.
  const activeRunId =
    companionHealth.activity ?? experiences.find((e) => runState(e.id) === "running")?.id ?? null;
  const activeRunLabel = activeRunId
    ? shortLabel(activeRunId, experiences.find((e) => e.id === activeRunId)?.title ?? activeRunId)
    : null;

  return (
    <nav className="app-nav" data-testid="app-nav">
      <button
        type="button"
        className="nav-guide"
        data-testid="app-nav-link-instructions"
        onClick={() => setInstructionsOpen(true)}
      >
        <span className="nav-guide-icon" aria-hidden="true">ⓘ</span>
        <span className="nav-guide-text">
          <b>How to run</b>
          <span>two-machine setup · start here</span>
        </span>
      </button>

      <ul className="app-nav-links" data-testid="app-nav-links">
        <li>
          <button
            type="button"
            className="nav-item"
            data-testid="app-nav-link-home"
            aria-current={route === "/home" ? "page" : undefined}
            onClick={() => onNavigate("/home")}
          >
            <span className="nav-item-icon" aria-hidden="true">
              ⌂
            </span>
            Home
          </button>
        </li>

        <li className="nav-group-label">Experiments</li>
        {experiences.map((exp) => (
          <li key={exp.id}>
            <button
              type="button"
              className="nav-item"
              data-testid={`app-nav-link-${exp.id}`}
              aria-current={route === `/${exp.id}` ? "page" : undefined}
              title={`${shortLabel(exp.id, exp.title)} — ${runState(exp.id)}`}
              onClick={() => onNavigate(`/${exp.id}`)}
            >
              <StatusDot state={dotState(exp.id)} />
              <span className="nav-item-label">{shortLabel(exp.id, exp.title)}</span>
            </button>
          </li>
        ))}
        <li className="nav-dot-legend" data-testid="app-nav-dot-legend" aria-hidden="true">
          <span className="nav-dot nav-dot-idle" /> idle
          <span className="nav-dot nav-dot-running" /> running
          <span className="nav-dot nav-dot-done" /> done
        </li>

        <li className="nav-group-label">Results</li>
        <li>
          <button
            type="button"
            className="nav-item"
            data-testid="app-nav-link-summary"
            aria-current={route === "/summary" ? "page" : undefined}
            onClick={() => onNavigate("/summary")}
          >
            <span className="nav-item-icon" aria-hidden="true">
              ◎
            </span>
            Summary
          </button>
        </li>
      </ul>

      <div className="app-nav-footer">
        <div className="app-nav-run-all" data-testid="app-nav-run-all">
          <button
            type="button"
            className="btn-run-all"
            data-testid="app-nav-run-all-button"
            data-host-driven={hostDriven || undefined}
            disabled={runAllInProgress || hostDriven}
            title={
              hostDriven
                ? "Paired guest: the host drives every run. Watch the experiments go green as the host runs them."
                : undefined
            }
            onClick={() => void runAllExperiences()}
          >
            {runAllInProgress ? "Running all…" : hostDriven ? "▶ Host-driven" : "▶ Run all"}
          </button>
          <button
            type="button"
            data-testid="app-nav-abort-button"
            disabled={!runAllInProgress}
            onClick={abortAll}
          >
            Abort
          </button>
        </div>

        <SessionSetup />

        {session.room && (
          <div className="conn-panel" data-testid="companion-conn">
            <div className="conn-panel-title" data-testid="companion-conn-title">
              connection
            </div>
            <div className="conn-row" data-testid="companion-conn-link">
              <span className="conn-key">link</span>
              <span className="conn-val">
                <span className={`conn-dot conn-dot-${companionHealth.socketState}`} aria-hidden="true" />
                {companionHealth.socketState}
              </span>
            </div>
            <div className="conn-row" data-testid="companion-conn-peer">
              <span className="conn-key">peer</span>
              <span className="conn-val">
                <span
                  className={`conn-dot conn-dot-${companionHealth.peerPresent ? "present" : "absent"}`}
                  aria-hidden="true"
                />
                {companionHealth.peerPresent ? "present" : "waiting…"}
              </span>
            </div>
            <div className="conn-row" data-testid="companion-conn-ping">
              <span className="conn-key">ping</span>
              <span className="conn-val">
                {companionHealth.rttMs != null ? `${companionHealth.rttMs} ms` : "—"}
              </span>
            </div>
            <div className="conn-row" data-testid="companion-conn-run">
              <span className="conn-key">run</span>
              <span className={`conn-val ${activeRunLabel ? "conn-val-active" : ""}`}>
                {activeRunLabel ? `▶ ${activeRunLabel}` : "idle"}
              </span>
            </div>
          </div>
        )}

        <div
          className="app-nav-build"
          data-testid="app-nav-build"
          title={`Build ${__BUILD_SHA__} · ${__BUILD_TIME__}`}
        >
          <span className="app-nav-build-key">build</span>
          <span className="app-nav-build-val" data-testid="app-nav-build-sha">
            {__BUILD_SHA__}
          </span>
          <span className="app-nav-build-time" data-testid="app-nav-build-time">
            {__BUILD_TIME__}
          </span>
        </div>
      </div>

      <InstructionsModal open={instructionsOpen} onClose={() => setInstructionsOpen(false)} />
    </nav>
  );
}
