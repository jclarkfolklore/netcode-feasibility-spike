import { useState, type ReactNode } from "react";

interface Props {
  testId: string;
  whatItTests: string;
  whyItMatters: string;
  howToRead: string;
  /** Optional extra detail (e.g. methodology notes) shown only when expanded. */
  detail?: ReactNode;
  /** Starts expanded. Default false — the compact 3-line summary is what a
   * teammate sees first (research.md §D: "passes the 30-second time-to-answer test"). */
  defaultOpen?: boolean;
}

/**
 * Compact "what this tests / why it matters / how to read it" panel. Always
 * shows the three one-line summaries; a collapsible detail slot holds
 * anything longer so the default view stays short.
 */
export function ExplainerPanel({
  testId,
  whatItTests,
  whyItMatters,
  howToRead,
  detail,
  defaultOpen = false,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="explainer-panel" data-testid={testId}>
      <div className="explainer-panel-summary">
        <div data-testid={`${testId}-what`}>
          <div className="explainer-panel-item-label">What this tests</div>
          <p className="explainer-panel-item-body">{whatItTests}</p>
        </div>
        <div data-testid={`${testId}-why`}>
          <div className="explainer-panel-item-label">Why it matters</div>
          <p className="explainer-panel-item-body">{whyItMatters}</p>
        </div>
        <div data-testid={`${testId}-how`}>
          <div className="explainer-panel-item-label">How to read it</div>
          <p className="explainer-panel-item-body">{howToRead}</p>
        </div>
      </div>
      {detail && (
        <>
          <button
            type="button"
            className="explainer-panel-toggle"
            data-testid={`${testId}-detail-toggle`}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? "▾ Hide details" : "▸ More detail"}
          </button>
          {open && (
            <div className="explainer-panel-detail" data-testid={`${testId}-detail-body`}>
              {detail}
            </div>
          )}
        </>
      )}
    </div>
  );
}
