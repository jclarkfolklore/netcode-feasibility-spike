import type { ExperienceResult, SubScore } from "../contracts";
import type { AggregateScore } from "./scoring";

/**
 * Shareable export (008.7 spec item 6): "a self-contained report (HTML or
 * Markdown) + raw CSV/JSON of all results, downloadable via Blob/URL so a
 * teammate sees results from the link alone." No new dependency — this is
 * built entirely on the DOM's `Blob`/`URL.createObjectURL` and a synthetic
 * anchor click, per the track's "no new dependencies" constraint.
 */

export interface ReportContext {
  generatedAt: string; // ISO timestamp
  session: { room: string | null; role: string; topology: string };
  feasibilityScore: number | null;
  determinismScore: number | null;
  results: ExperienceResult[];
  cumulativeVerdict: string;
}

function fmtScore(n: number | null): string {
  return n === null ? "—" : n.toFixed(1);
}

function subScoreLine(s: SubScore): string {
  return `  - **${s.key}**: ${s.value0to100.toFixed(1)}/100 (${s.band}, weight ${s.weight}) — ${s.rationale}`;
}

/** Self-contained Markdown report — opens/reads fine in any teammate's editor or a Gist. */
export function generateMarkdownReport(ctx: ReportContext): string {
  const lines: string[] = [];
  lines.push(`# Netcode Feasibility Spike — Summary Report`);
  lines.push("");
  lines.push(`Generated: ${ctx.generatedAt}`);
  lines.push(
    `Session: room=${ctx.session.room ?? "(none — solo)"} · role=${ctx.session.role} · topology=${ctx.session.topology}`,
  );
  lines.push("");
  lines.push(`## Verdicts`);
  lines.push("");
  lines.push(`- **Host-authoritative feasibility composite:** ${fmtScore(ctx.feasibilityScore)} / 100`);
  lines.push(
    `- **Determinism/rollback-readiness (separate strategic axis):** ${fmtScore(ctx.determinismScore)} / 100`,
  );
  lines.push("");
  lines.push(
    "> Measurement caveat: all latency/lag figures are simulated network + real app-processing " +
      "latency, comparative between runs on this harness — not hardware glass-to-glass (that needs " +
      "LDAT/photodiode tooling). Distributions (p50/p95/p99), not means, are what matter for feel.",
  );
  lines.push("");
  lines.push(`## Cumulative finding`);
  lines.push("");
  lines.push(ctx.cumulativeVerdict);
  lines.push("");
  lines.push(`## Per-experience results`);
  lines.push("");
  for (const r of ctx.results) {
    lines.push(`### ${r.experienceId}`);
    lines.push("");
    lines.push(`- status: **${r.status}** · topology: ${r.topology} · lossMode: ${r.lossMode}`);
    lines.push(`- verdict: ${r.verdict}`);
    lines.push(`- measurement caveat: ${r.measuredCaveat}`);
    if (r.subScores.length > 0) {
      lines.push(`- sub-scores:`);
      for (const s of r.subScores) lines.push(subScoreLine(s));
    }
    lines.push("");
  }
  lines.push(`## Raw data`);
  lines.push("");
  lines.push(
    "See the accompanying `.json` (full fidelity, incl. `raw` distributions/per-cell data) and " +
      "`.csv` (flat sub-score table) exports for machine-readable data.",
  );
  return lines.join("\n");
}

/** One row per sub-score (plus one experience-level row when an experience has none) — flat, spreadsheet-friendly. */
export function generateCsv(results: ExperienceResult[]): string {
  const header = [
    "experienceId",
    "status",
    "topology",
    "lossMode",
    "subScoreKey",
    "value0to100",
    "band",
    "weight",
    "rationale",
  ];
  const rows: string[][] = [header];

  const escape = (v: string): string => `"${v.replace(/"/g, '""')}"`;

  for (const r of results) {
    if (r.subScores.length === 0) {
      rows.push([r.experienceId, r.status, r.topology, r.lossMode, "", "", "", "", ""]);
      continue;
    }
    for (const s of r.subScores) {
      rows.push([
        r.experienceId,
        r.status,
        r.topology,
        r.lossMode,
        s.key,
        String(s.value0to100),
        s.band,
        String(s.weight),
        s.rationale,
      ]);
    }
  }

  return rows.map((row) => row.map(escape).join(",")).join("\n");
}

/** Full-fidelity JSON — every `raw` distribution/per-cell datum, plus the composite scores. */
export function generateJson(ctx: ReportContext, aggregate: AggregateScore): string {
  return JSON.stringify(
    {
      generatedAt: ctx.generatedAt,
      session: ctx.session,
      feasibilityScore: ctx.feasibilityScore,
      determinismScore: ctx.determinismScore,
      cumulativeVerdict: ctx.cumulativeVerdict,
      aggregate,
      results: ctx.results,
    },
    null,
    2,
  );
}

/**
 * The written cumulative verdict (008.7 spec item 7): synthesizes the
 * spike's per-experience findings into one plain-language recommendation
 * on host-authoritative feasibility. Pulls real numbers out of `results`
 * where available (so it stays honest as more experiences get run) and
 * falls back to the canonical research.md §E findings when an experience
 * hasn't been run yet, clearly labeling which parts are measured vs. not-yet-run.
 */
export function cumulativeVerdictNarrative(results: ExperienceResult[]): string {
  const byId = new Map(results.map((r) => [r.experienceId, r]));
  const transport = byId.get("transport");
  const snapshot = byId.get("sim-snapshot");
  const e2e = byId.get("e2e-remote-input");
  const determinism = byId.get("determinism-cost");

  const parts: string[] = [];

  // 1. Transport / HOL.
  if (transport?.status === "completed") {
    parts.push(`**Transport:** ${transport.verdict}`);
  } else {
    parts.push(
      "**Transport:** not yet run — research.md's working assumption is that WebSocket is fine for " +
        "same-region play and that WebRTC's case rests entirely on the loss-conditioned p99 tail " +
        "(TCP head-of-line blocking under real link-loss). Run the Transport experience under " +
        "`link-loss` to confirm or refute this for real.",
    );
  }

  // 2. Snapshot cost / production API gap.
  if (snapshot?.status === "completed") {
    parts.push(`**Snapshot cost:** ${snapshot.verdict}`);
  } else {
    parts.push(
      "**Snapshot cost:** not yet run — the expectation (research.md) is that per-tick encode cost " +
        "is cheap against the 16.67ms/frame budget, but that snapshotting the live Phaser sim exposes " +
        "a real gap: there is no state→render API, so full visual fidelity (tweens, pose motion) " +
        "can't be captured by the frozen `Snapshot` schema alone — a production implementation would " +
        "need Fighter to expose that as first-class state, not Phaser side effects.",
    );
  }

  // 3. Guest input-lag — the decisive number.
  if (e2e?.status === "completed") {
    parts.push(`**Guest felt input lag (the decisive number):** ${e2e.verdict}`);
  } else {
    parts.push(
      "**Guest felt input lag:** not yet run — this is the single most decision-relevant number in " +
        "the spike. The working expectation is that host-authoritative state-relay (RTT + " +
        "interpolation buffer + stale-opponent rendering) lands the guest past the ~3-frame " +
        "(~48ms) \"feels offline\" ceiling once real-world latency (not LAN) is involved.",
    );
  }

  // 4. Determinism / rollback reopening — kept as a SEPARATE axis, never blended.
  if (determinism?.status === "completed") {
    parts.push(`**Rollback reopening (separate axis, not blended into feasibility):** ${determinism.verdict}`);
  } else {
    parts.push(
      "**Rollback reopening:** not yet run — research.md anchors the honest cost to the MKX " +
        "retrofit figure (~8 man-years), of which only the RNG-seeding slice (3 call sites) is cheap; " +
        "fixed-timestep and deterministic/snapshot-restorable physics are structural and dominate the " +
        "estimate. This answers \"should we switch to rollback?\", not \"is host-authoritative good " +
        "enough?\" — the two verdicts are shown separately on purpose.",
    );
  }

  const allRun = transport && snapshot && e2e && determinism;
  parts.push(
    allRun
      ? "**Recommendation:** the composite above (transport + snapshot-cost + input-lag, min-gated) " +
          "is the honest host-authoritative feasibility read; treat determinism-readiness as an " +
          "independent, separately-tracked strategic question, not a modifier on it."
      : "**Recommendation:** run every experience (\"Run all\") for a real composite — this narrative " +
          "fills in with the spike's working hypotheses (research.md §E) for anything not yet measured, " +
          "clearly labeled above as \"not yet run.\"",
  );

  return parts.join("\n\n");
}

/** Triggers a browser download of `content` as `filename` — Blob/URL, no server round-trip, no dependency. */
export function downloadTextFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke on a timeout, not immediately — some browsers cancel the
  // download if the object URL is revoked before the click is processed.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
