import type { ExperienceResult } from "../lib/contracts";
import type { BandValue } from "./Band";
import { Band } from "./Band";
import { Callout } from "./Callout";
import { Markdown } from "./Markdown";
import { MetricTile, MetricTileGrid } from "./MetricTile";

export interface ResultTile {
  label: string;
  value: string;
  band?: BandValue;
  /** Small sub-line under the value (e.g. frames, encode ms, provenance). */
  source?: string;
}

/** First sentence of a (possibly Markdown) verdict — the L0 judgment. */
function firstSentence(text: string): string {
  const trimmed = text.trim();
  const m = trimmed.match(/^.*?[.!?](?=\s|$)/s);
  return (m ? m[0] : trimmed.split("\n")[0]).trim();
}

/**
 * The canonical result block, identical on all four experiment pages + Summary
 * (DESIGN-PHILOSOPHY.md §5):
 *   1. Verdict strip — status chip + one-sentence judgment + topology/loss chips
 *   2. Stat tiles — the experiment's decisive numbers (supplied per-page)
 *   3. ▸ Details — full verdict prose, sub-scores, caveat note
 *
 * A COMPLETED chip with zero visible numbers is forbidden: pass at least one
 * `tile` (a ghost tile stating where the number lives is acceptable).
 */
export function ResultView({
  result,
  tiles,
  testId,
}: {
  result: ExperienceResult;
  tiles?: ResultTile[];
  testId: string;
}) {
  const statusBand: BandValue = result.status;
  // Default the stat tiles to the result's sub-scores (each a scored decisive
  // metric with a band) when a page doesn't supply page-specific ones — so
  // every result block leads with numbers, never a bare COMPLETED chip (DP §5).
  const effectiveTiles: ResultTile[] =
    tiles ??
    result.subScores.map((s) => ({
      label: s.key,
      value: `${s.value0to100}`,
      band: s.band,
      source: "/ 100",
    }));
  return (
    <div data-testid={testId} className="result-view">
      <div className="result-verdict-strip">
        <Band band={statusBand} testId={`${testId}-status`} />
        <span className="result-verdict-lead" data-testid={`${testId}-verdict-lead`}>
          {firstSentence(result.verdict)}
        </span>
        <span className="result-context-chips" data-testid={`${testId}-topology`}>
          <span className="context-chip mono">{result.topology}</span>
          <span className="context-chip mono">loss: {result.lossMode}</span>
        </span>
      </div>

      {effectiveTiles.length > 0 && (
        <MetricTileGrid testId={`${testId}-tiles`}>
          {effectiveTiles.map((t) => (
            <MetricTile
              key={t.label}
              label={t.label}
              value={t.value}
              band={t.band}
              source={t.source}
              testId={`${testId}-tile-${t.label.replace(/\s+/g, "-").toLowerCase()}`}
            />
          ))}
        </MetricTileGrid>
      )}

      <details className="section-collapsible result-details" data-testid={`${testId}-details`}>
        <summary>Details — methodology, sub-scores, caveats</summary>
        <div className="result-details-body">
          <Markdown text={result.verdict} testId={`${testId}-verdict`} />
          {result.subScores.length > 0 && (
            <ul className="result-subscores" data-testid={`${testId}-subscores`}>
              {result.subScores.map((s) => (
                <li
                  key={s.key}
                  className="result-subscore-row"
                  data-testid={`${testId}-subscore-${s.key}`}
                >
                  <span className="result-subscore-key">{s.key}</span>
                  <Band band={s.band} label={`${s.value0to100}/100`} />
                  <span className="result-subscore-value">weight {s.weight}</span>
                  <Markdown text={s.rationale} />
                </li>
              ))}
            </ul>
          )}
          {result.measuredCaveat && (
            <Callout kind="note" testId={`${testId}-caveat`}>
              {result.measuredCaveat}
            </Callout>
          )}
        </div>
      </details>
    </div>
  );
}
