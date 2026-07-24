import type { ReactNode } from "react";

interface Props {
  /** Left column — explainer copy / diagrams / static visuals. */
  visual: ReactNode;
  /** Right column — controls + live results. */
  interactive: ReactNode;
  testId?: string;
}

/**
 * Explainer/visual column + interactive/results column. Stacks to a single
 * column under 900px so pages don't force a long scroll on a projector or a
 * narrow window.
 */
export function TwoColumnLayout({ visual, interactive, testId }: Props) {
  return (
    <div className="two-col-layout" data-testid={testId}>
      <div className="two-col-visual" data-testid={testId && `${testId}-visual`}>
        {visual}
      </div>
      <div className="two-col-interactive" data-testid={testId && `${testId}-interactive`}>
        {interactive}
      </div>
    </div>
  );
}
