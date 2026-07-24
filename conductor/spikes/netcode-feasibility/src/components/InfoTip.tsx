/**
 * Per-control help affix — a `ⓘ` glyph that reveals a short bubble on hover
 * and keyboard focus. Pure CSS positioning (no library). Never put a
 * load-bearing caveat only in a tooltip — tooltips are invisible on a
 * projector. See DESIGN-PHILOSOPHY.md §2.3 / §7.
 *
 * Content pattern: "What it is. What increasing it does."
 */
export function InfoTip({ text, testId }: { text: string; testId?: string }) {
  return (
    <span className="info-tip" tabIndex={0} role="note" aria-label={text} data-testid={testId}>
      <span className="info-tip-glyph" aria-hidden="true">
        ⓘ
      </span>
      <span className="info-tip-bubble" role="tooltip">
        {text}
      </span>
    </span>
  );
}
