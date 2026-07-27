import { useMemo, useState } from "react";
import { ResultView } from "../components/ResultView";
import { Verdict } from "../components/Verdict";
import { MetricTile, MetricTileGrid } from "../components/MetricTile";
import { Band } from "../components/Band";
import { Callout } from "../components/Callout";
import { Markdown } from "../components/Markdown";
import { DistributionBar } from "../components/DistributionBar";
import {
  aggregateResults,
  crossNetworkResults,
  isSoloTopology,
  scoreExperienceResult,
  splitAxes,
  type WeightOverrides,
} from "../lib/experience/scoring";
import {
  cumulativeVerdictNarrative,
  downloadTextFile,
  generateCsv,
  generateJson,
  generateMarkdownReport,
} from "../lib/experience/report";
import type { ExperienceResult, SubScoreKey } from "../lib/contracts";
import { useRunStore } from "../state/RunStore";

type VerdictBand = "good" | "acceptable" | "bad" | "none";

function verdictBand(score: number | null): VerdictBand {
  if (score === null) return "none";
  if (score >= 80) return "good";
  if (score >= 50) return "acceptable";
  return "bad";
}

const VERDICT_LABEL: Record<VerdictBand, string> = {
  good: "Feasible",
  acceptable: "Feasible with caveats",
  bad: "Not feasible as measured",
  none: "No data yet",
};

/** Plain name, route, and a one-line working hypothesis (shown as ghost takeaway before a run). */
const SCOREBOARD_META: Record<string, { name: string; route: string; hypothesis: string }> = {
  transport: {
    name: "Transport (WS vs WebRTC)",
    route: "/transport",
    hypothesis: "Expected: TCP head-of-line blocking only bites in the loss tail.",
  },
  "sim-snapshot": {
    name: "Sim-snapshot",
    route: "/sim-snapshot",
    hypothesis: "Expected: a 2-fighter snapshot is tiny and cheap; render fidelity is the risk.",
  },
  "e2e-remote-input": {
    name: "Remote input (E2E)",
    route: "/e2e-remote-input",
    hypothesis: "Expected: guest felt lag lands near the 3-frame ceiling — the decisive number.",
  },
  "determinism-cost": {
    name: "Determinism cost",
    route: "/determinism-cost",
    hypothesis: "Expected: rollback retrofit is structural (weeks/months), not cheap.",
  },
};

/** First sentence of a (possibly Markdown) verdict — the row's one-line takeaway. */
function firstVerdictSentence(text: string): string {
  const trimmed = text.trim();
  const m = trimmed.match(/^.*?[.!?](?=\s|$)/s);
  return (m ? m[0] : trimmed.split("\n")[0]).trim();
}

function Scoreboard({
  experiences,
  results,
  runState,
}: {
  experiences: { id: string; title: string }[];
  results: Record<string, ExperienceResult | undefined>;
  runState: (id: string) => "idle" | "running" | "completed" | "failed";
}) {
  return (
    <div className="scoreboard" data-testid="page-summary-scoreboard">
      {experiences.map((exp) => {
        const result = results[exp.id];
        const meta = SCOREBOARD_META[exp.id] ?? { name: exp.title, route: "/home", hypothesis: "" };
        const score = result ? scoreExperienceResult(result) : null;
        const band = verdictBand(score);
        const status = runState(exp.id);
        const takeaway = result ? firstVerdictSentence(result.verdict) : meta.hypothesis;
        return (
          <button
            key={exp.id}
            type="button"
            className="scoreboard-row"
            data-testid={`page-summary-scoreboard-${exp.id}`}
            onClick={() => {
              window.location.hash = meta.route;
            }}
          >
            <div className="scoreboard-row-top">
              <span className="scoreboard-name">{meta.name}</span>
              <span className={`band-pill scoreboard-status`} data-band={status === "idle" ? "none" : status}>
                {status}
              </span>
            </div>
            <div className="scoreboard-row-mid">
              <span className="scoreboard-score mono" data-band={band}>
                {score === null ? "—" : score.toFixed(0)}
              </span>
              <Band band={band} label={band === "none" ? "—" : undefined} />
              <span className="scoreboard-open">Open →</span>
            </div>
            <span className={`scoreboard-takeaway${result ? "" : " is-ghost"}`}>{takeaway}</span>
          </button>
        );
      })}
    </div>
  );
}

interface FoundDistribution {
  path: string;
  p50: number;
  p95: number;
  p99: number;
}

/** Best-effort scan of a result's `raw` payload for any {p50,p95,p99} distribution, for the distribution strip. */
function findDistributions(raw: unknown, path = "", depth = 0, acc: FoundDistribution[] = []): FoundDistribution[] {
  if (depth > 4 || acc.length >= 4 || raw === null || typeof raw !== "object") return acc;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.p50 === "number" && typeof obj.p95 === "number" && typeof obj.p99 === "number") {
    acc.push({ path: path || "value", p50: obj.p50, p95: obj.p95, p99: obj.p99 });
    return acc;
  }
  for (const [key, value] of Object.entries(obj)) {
    if (acc.length >= 4) break;
    if (Array.isArray(value)) {
      value.forEach((item, i) => findDistributions(item, `${path}${path ? "." : ""}${key}[${i}]`, depth + 1, acc));
    } else {
      findDistributions(value, `${path}${path ? "." : ""}${key}`, depth + 1, acc);
    }
  }
  return acc;
}

function ResultDistributions({ result, testId }: { result: ExperienceResult; testId: string }) {
  const distributions = useMemo(() => findDistributions(result.raw), [result]);
  if (distributions.length === 0) return null;
  return (
    <div data-testid={testId}>
      <h4>Distributions (p50/p95/p99, not means)</h4>
      {distributions.map((d) => (
        <DistributionBar key={d.path} title={d.path} dist={d} testId="summary-sparkline" />
      ))}
    </div>
  );
}

function ExperienceDetail({ result }: { result: ExperienceResult }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="summary-detail" data-testid={`page-summary-detail-${result.experienceId}`}>
      <button
        type="button"
        className="summary-detail-toggle"
        data-testid={`page-summary-detail-toggle-${result.experienceId}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {open ? "▾" : "▸"} {result.experienceId}
        <Band band={result.status} />
        {isSoloTopology(result.topology) && <span className="badge badge-solo"> solo/loopback</span>}
      </button>
      {open && (
        <div className="summary-detail-body">
          <ResultView testId={`page-summary-result-${result.experienceId}-view`} result={result} />
          <ResultDistributions result={result} testId={`page-summary-distributions-${result.experienceId}`} />
        </div>
      )}
    </div>
  );
}

/** Full, always-expanded per-experience block used only in the print/PDF report. */
function PrintExperienceBlock({ result }: { result: ExperienceResult }) {
  return (
    <div className="card" style={{ marginBottom: "1rem" }}>
      <h4>
        {result.experienceId} <Band band={result.status} />
      </h4>
      <ResultView testId={`print-result-${result.experienceId}-view`} result={result} />
      <ResultDistributions result={result} testId={`print-distributions-${result.experienceId}`} />
    </div>
  );
}

export function SummaryPage() {
  const { experiences, results, runState, runAllExperiences, runAllInProgress, session, companionConnected, hostDriven, clearResults } =
    useRunStore();
  const [weightOverrides, setWeightOverrides] = useState<WeightOverrides>({});

  const resultList = useMemo(
    () => experiences.map((e) => results[e.id]).filter((r): r is ExperienceResult => Boolean(r)),
    [experiences, results],
  );

  const { feasibilityResults, determinismResult } = useMemo(() => splitAxes(resultList), [resultList]);
  const feasibilityAggregate = useMemo(
    () => aggregateResults(feasibilityResults, weightOverrides),
    [feasibilityResults, weightOverrides],
  );
  const determinismScore = useMemo(
    () => (determinismResult ? scoreExperienceResult(determinismResult) : null),
    [determinismResult],
  );
  const crossNetwork = useMemo(() => crossNetworkResults(resultList), [resultList]);
  const soloCount = resultList.length - crossNetwork.length;

  const feasibilityBand = verdictBand(feasibilityAggregate.compositeScore);
  const determinismBand = verdictBand(determinismScore);

  const allWeightKeys = useMemo(() => {
    const keys = new Set<SubScoreKey>();
    for (const r of feasibilityResults) for (const s of r.subScores) keys.add(s.key);
    return Array.from(keys);
  }, [feasibilityResults]);

  const headlineMetrics = useMemo(() => {
    const all = resultList.flatMap((r) => r.subScores.map((s) => ({ experienceId: r.experienceId, sub: s })));
    return all.sort((a, b) => b.sub.weight - a.sub.weight).slice(0, 9);
  }, [resultList]);

  const cumulativeVerdict = useMemo(() => cumulativeVerdictNarrative(resultList), [resultList]);

  const reportCtx = () => ({
    generatedAt: new Date().toISOString(),
    session: { room: session.room, role: session.role, topology: session.topology },
    feasibilityScore: feasibilityAggregate.compositeScore,
    determinismScore,
    results: resultList,
    cumulativeVerdict,
  });

  const exportMarkdown = () => {
    const ctx = reportCtx();
    downloadTextFile(
      "netcode-feasibility-summary.md",
      generateMarkdownReport(ctx),
      "text/markdown;charset=utf-8",
    );
  };
  const exportCsv = () => {
    downloadTextFile("netcode-feasibility-results.csv", generateCsv(resultList), "text/csv;charset=utf-8");
  };
  const exportJson = () => {
    const ctx = reportCtx();
    downloadTextFile(
      "netcode-feasibility-results.json",
      generateJson(ctx, feasibilityAggregate),
      "application/json;charset=utf-8",
    );
  };

  return (
    <article data-testid="page-summary" className="print-report">
      <div className="summary-header no-print">
        <h2 data-testid="page-summary-title">Summary</h2>
        <button type="button" data-variant="primary" data-testid="page-summary-download-pdf" onClick={() => window.print()}>
          Download PDF
        </button>
      </div>
      <h2 className="print-only" data-testid="page-summary-title-print">
        Netcode Feasibility — Summary Report
      </h2>

      {/* Traffic-light verdicts — render above the fold with zero interaction from stored results (F18). */}
      <div className="summary-verdicts">
        <Verdict
          testId="page-summary-verdict"
          eyebrow="Host-authoritative feasibility"
          label={VERDICT_LABEL[feasibilityBand]}
          band={feasibilityBand}
          score={feasibilityAggregate.compositeScore === null ? "—" : feasibilityAggregate.compositeScore.toFixed(1)}
          meta={
            <span data-testid="page-summary-verdict-meta">
              {feasibilityAggregate.completedCount} completed · {feasibilityAggregate.failedCount} failed ·{" "}
              {feasibilityAggregate.skippedCount} skipped · {crossNetwork.length} cross-network / {soloCount} solo
              (loopback)
            </span>
          }
        />
        <Verdict
          testId="page-summary-determinism-verdict"
          eyebrow="Rollback readiness — separate axis"
          label={VERDICT_LABEL[determinismBand]}
          band={determinismBand}
          score={determinismScore === null ? "—" : determinismScore.toFixed(1)}
        />
      </div>

      <div className="summary-body no-print">
        {/* LEFT: the clickable scoreboard (link rows) + the page's run controls. */}
        <div className="summary-nav-col">
          <div className="home-section-heading">
            <h3>Experiment scoreboard →</h3>
          </div>
          <Scoreboard experiences={experiences} results={results} runState={runState} />

          <div className="run-controls">
            <button
              type="button"
              data-variant="primary"
              data-testid="page-summary-run-all-button"
              data-host-driven={hostDriven || undefined}
              disabled={runAllInProgress || hostDriven}
              title={
                hostDriven
                  ? "Paired guest: the host drives every run. Watch the experiments go green as the host runs them."
                  : undefined
              }
              onClick={() => void runAllExperiences()}
            >
              {runAllInProgress ? "Running all…" : hostDriven ? "Host-driven" : "Run all"}
            </button>
            <button
              type="button"
              data-testid="page-summary-clear-button"
              onClick={() => {
                if (window.confirm("Clear all stored experiment results? This cannot be undone.")) clearResults();
              }}
            >
              Clear stored results
            </button>
            {session.room && (
              <span data-testid="page-summary-companion-status" className="session-badge">
                companion channel: {companionConnected ? "connected" : "not connected"}
              </span>
            )}
          </div>
        </div>

        {/* RIGHT: caveat, metrics, weights, export, narrative, per-experience detail. */}
        <div className="summary-detail-col">
          <Callout kind="note" testId="page-summary-caveat">
            Measurement caveat: simulated network + real app-processing latency, comparative between runs on
            this harness — <strong>not</strong> hardware glass-to-glass. Distributions (<code>p50</code>/
            <code>p95</code>/<code>p99</code>), not means, drive every band.
          </Callout>

          <section className="experience-layout-section">
            <h3>Headline metrics</h3>
            {headlineMetrics.length === 0 ? (
              <div className="ghost-table" data-testid="page-summary-headline-empty">
                Run all to fill p50 / p95 / p99 and per-sub-score bands for each experiment.
              </div>
            ) : (
              <MetricTileGrid testId="page-summary-headline-metrics">
                {headlineMetrics.map(({ experienceId, sub }) => (
                  <MetricTile
                    key={`${experienceId}-${sub.key}`}
                    testId={`page-summary-headline-${experienceId}-${sub.key}`}
                    label={sub.key}
                    value={sub.value0to100.toFixed(0)}
                    band={sub.band}
                    source={experienceId}
                  />
                ))}
              </MetricTileGrid>
            )}
          </section>

          <section className="experience-layout-section">
            <h3>Weights</h3>
            <p className="section-help">Adjust a weight and watch the composite move — the scoring is transparent, not fixed behind the scenes.</p>
            <div data-testid="page-summary-weight-controls">
              {allWeightKeys.length === 0 && <p>No sub-scores yet to weight.</p>}
              {allWeightKeys.map((key) => (
                <label key={key} className="weight-slider-row" data-testid={`page-summary-weight-${key}`}>
                  <span>{key}</span>
                  <input
                    type="range"
                    min={0.25}
                    max={2}
                    step={0.25}
                    value={weightOverrides[key] ?? 1}
                    data-testid={`page-summary-weight-input-${key}`}
                    onChange={(e) =>
                      setWeightOverrides((prev) => ({ ...prev, [key]: Number(e.target.value) }))
                    }
                  />
                  <span>{(weightOverrides[key] ?? 1).toFixed(2)}x</span>
                </label>
              ))}
            </div>
          </section>

          <details className="section-collapsible" data-testid="page-summary-narrative">
            <summary>Full narrative — the cumulative finding in prose</summary>
            <div data-testid="page-summary-cumulative-verdict">
              <Markdown text={cumulativeVerdict} />
            </div>
          </details>

          <section className="experience-layout-section">
            <h3>Export</h3>
            <div className="export-controls" data-testid="page-summary-export-controls">
              <button type="button" data-testid="page-summary-export-markdown" onClick={exportMarkdown}>
                Download Markdown report
              </button>
              <button type="button" data-testid="page-summary-export-csv" onClick={exportCsv}>
                Download CSV
              </button>
              <button type="button" data-testid="page-summary-export-json" onClick={exportJson}>
                Download JSON
              </button>
            </div>
          </section>

          <section className="experience-layout-section" data-testid="page-summary-results">
            <h3>Per-experience detail (expandable)</h3>
            {experiences.map((exp) => {
              const result = results[exp.id];
              return (
                <div key={exp.id} data-testid={`page-summary-result-${exp.id}`}>
                  <h4>{exp.title}</h4>
                  {result ? (
                    <ExperienceDetail result={result} />
                  ) : (
                    <p data-testid={`page-summary-result-${exp.id}-empty`}>Not run yet.</p>
                  )}
                </div>
              );
            })}
          </section>
        </div>
      </div>

      {/* Print-only: every experience fully expanded, one clean multi-page report. */}
      <section className="print-only print-page-break">
        <h3>Cumulative finding</h3>
        <Markdown text={cumulativeVerdict} />
        <h3>Per-experience detail</h3>
        {experiences.map((exp) => {
          const result = results[exp.id];
          return (
            <div key={exp.id}>
              <h4>{exp.title}</h4>
              {result ? <PrintExperienceBlock result={result} /> : <p>Not run yet.</p>}
            </div>
          );
        })}
        {allWeightKeys.length > 0 && (
          <>
            <h3>Weights applied</h3>
            <ul>
              {allWeightKeys.map((key) => (
                <li key={key}>
                  {key}: {(weightOverrides[key] ?? 1).toFixed(2)}x
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="result-caveat">Generated {new Date().toLocaleString()}</p>
      </section>
    </article>
  );
}
