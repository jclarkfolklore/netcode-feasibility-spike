export type BandValue = "good" | "acceptable" | "bad" | "none" | "completed" | "failed" | "skipped";

const LABEL: Record<BandValue, string> = {
  good: "Good",
  acceptable: "Acceptable",
  bad: "Bad",
  none: "No data",
  completed: "Completed",
  failed: "Failed",
  skipped: "Skipped",
};

/** Traffic-light pill used consistently for sub-score bands and experience statuses. */
export function Band({
  band,
  label,
  testId,
}: {
  band: BandValue;
  /** Override the default label (e.g. show the raw status string). */
  label?: string;
  testId?: string;
}) {
  return (
    <span className="band-pill" data-band={band} data-testid={testId}>
      <span className="band-dot" aria-hidden="true" />
      {label ?? LABEL[band]}
    </span>
  );
}
