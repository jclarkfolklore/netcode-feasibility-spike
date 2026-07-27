import { ExperienceLayout } from "../components/ExperienceLayout";
import { ResultView } from "../components/ResultView";
import { RunButton } from "../components/RunButton";
import { Markdown } from "../components/Markdown";
import { DeterminismDiagram } from "../components/diagrams/DeterminismDiagram";
import { useRunStore } from "../state/RunStore";
import { COST_TABLE, NON_DETERMINISM_SOURCES } from "../lib/experience/determinismCost";

const EXPERIENCE_ID = "determinism-cost";

/** Short glanceable names + magnitude for the L0 cost-tier strip (COST_TABLE order). */
const COST_SHORT = ["RNG seeding", "Fixed timestep", "Restorable physics"];
const MAGNITUDE: Record<string, { label: string; fill: number }> = {
  hours: { label: "hours", fill: 1 },
  days: { label: "days", fill: 2 },
  weeks: { label: "weeks", fill: 3 },
  months: { label: "months", fill: 6 },
};
function magnitudeOf(estimate: string): { label: string; fill: number } {
  const first = estimate.trim().split(/[\s,]/)[0].toLowerCase();
  return MAGNITUDE[first] ?? { label: first, fill: 2 };
}

export function DeterminismCostExperiencePage() {
  const { experiences, results, running, abortAll } = useRunStore();
  const experience = experiences.find((e) => e.id === EXPERIENCE_ID)!;
  const result = results[experience.id];
  const isRunning = running[experience.id] ?? false;

  return (
    <ExperienceLayout
      testId="page-determinism-cost"
      diagram={<DeterminismDiagram />}
      title={experience.title}
      whatItTests={experience.whatItTests}
      whatItTestsMore={experience.whatItTestsMore}
      whyItMatters={experience.whyItMatters}
      howToRead={experience.howToRead}
    >
      {/* L0 glanceable answer: the three retrofit tiers, magnitude at a glance. */}
      <section className="experience-layout-section" data-testid="page-determinism-cost-tiers">
        <h3>Retrofit cost — the three tiers</h3>
        <div className="cost-tier-strip">
          {COST_TABLE.map((row, i) => {
            const mag = magnitudeOf(row.estimate);
            return (
              <div className={`cost-tile cost-${row.cost}`} key={row.part} data-testid={`page-determinism-cost-tier-${i}`}>
                <div className="cost-tile-name">{COST_SHORT[i] ?? row.part}</div>
                <div className="cost-tile-mag">{mag.label}</div>
                <div className="cost-bar" aria-hidden="true">
                  {Array.from({ length: 6 }, (_, j) => (
                    <span key={j} className={`cost-bar-seg${j < mag.fill ? " is-filled" : ""}`} />
                  ))}
                </div>
                <span className={`cost-chip cost-chip-${row.cost}`}>{row.cost}</span>
              </div>
            );
          })}
        </div>
      </section>

      <details className="section-collapsible" data-testid="page-determinism-cost-cost-table">
        <summary data-testid="page-determinism-cost-cost-table-heading">Retrofit cost estimate — detail</summary>
        <div data-testid="page-determinism-cost-cost-table-list" className="result-details-body">
          {COST_TABLE.map((row) => {
            const mag = magnitudeOf(row.estimate);
            return (
              <div className={`cost-row cost-${row.cost}`} key={row.part} data-testid={`page-determinism-cost-cost-row-${row.part}`}>
                <div className="cost-row-head">
                  <span className={`cost-chip cost-chip-${row.cost}`}>{row.cost}</span>
                  <strong>{row.part}</strong>
                  <span className="cost-row-mag mono">{mag.label}</span>
                </div>
                <div className="cost-bar cost-bar-lg" aria-hidden="true">
                  {Array.from({ length: 6 }, (_, j) => (
                    <span key={j} className={`cost-bar-seg${j < mag.fill ? " is-filled" : ""}`} />
                  ))}
                </div>
                <div className="explainer-prose">
                  <Markdown text={row.estimate} />
                  <p className="cost-row-anchor">{row.anchor}</p>
                </div>
              </div>
            );
          })}
        </div>
      </details>

      <details className="section-collapsible" data-testid="page-determinism-cost-sources">
        <summary data-testid="page-determinism-cost-sources-heading">Non-determinism sources (verified <code>file:line</code>)</summary>
        <div data-testid="page-determinism-cost-sources-list" className="result-details-body">
          {NON_DETERMINISM_SOURCES.map((source) => (
            <div className="cost-source-row" key={source.location} data-testid={`page-determinism-cost-source-${source.location}`}>
              <div className="cost-source-head">
                <span className={`cost-chip cost-chip-${source.cost}`}>{source.cost}</span>
                <code>{source.location}</code>
              </div>
              <div className="explainer-prose">{source.description}</div>
            </div>
          ))}
        </div>
      </details>

      <div className="run-row">
        <RunButton
          experienceId={experience.id}
          testId="page-determinism-cost-run-button"
          label="Run headless reproducibility demo"
        />
        <button
          type="button"
          data-testid="page-determinism-cost-abort-button"
          disabled={!isRunning}
          onClick={abortAll}
        >
          Abort
        </button>
        <span className="run-mode-badge is-solo">solo · headless</span>
      </div>

      {result ? (
        <div className="result-block">
          <ResultView testId="page-determinism-cost-result" result={result} />
        </div>
      ) : (
        <div className="result-block ghost-table" data-testid="page-determinism-cost-result-empty">
          Results appear here after a run: RNG call sites, reproducibility hash match, and the retrofit cost estimate.
        </div>
      )}
    </ExperienceLayout>
  );
}
