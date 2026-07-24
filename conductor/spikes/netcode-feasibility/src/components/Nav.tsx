import { useRunStore } from "../state/RunStore";

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
  const { experiences, runState, session, runAllExperiences, runAllInProgress, abortAll } =
    useRunStore();

  // Single source of truth (RunStore.runState); "completed" maps to the "done"
  // dot class. Sidebar dots, Summary scoreboard, and page chips cannot disagree.
  const dotState = (id: string): "idle" | "running" | "done" | "failed" => {
    const s = runState(id);
    return s === "completed" ? "done" : s;
  };

  return (
    <nav className="app-nav" data-testid="app-nav">
      <ul className="app-nav-links" data-testid="app-nav-links">
        <li className="nav-group-label">Overview</li>
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
            disabled={runAllInProgress}
            onClick={() => void runAllExperiences()}
          >
            {runAllInProgress ? "Running all…" : "▶ Run all"}
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

        <div data-testid="app-nav-session-badge" className="session-badge">
          <span className="session-badge-row">
            <span className="session-badge-key">room</span>
            <span className="session-badge-val">{session.room ?? "solo"}</span>
          </span>
          <span className="session-badge-row">
            <span className="session-badge-key">role</span>
            <span className="session-badge-val">{session.role}</span>
          </span>
          <span className="session-badge-row">
            <span className="session-badge-key">topo</span>
            <span className={`session-badge-val topo-${session.topology}`}>{session.topology}</span>
          </span>
        </div>
      </div>
    </nav>
  );
}
