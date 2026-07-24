import type { ReactNode } from "react";
import { Markdown } from "./Markdown";

interface Props {
  testId: string;
  title: string;
  whatItTests: string;
  /** Optional remaining detail, revealed behind a "Show more". */
  whatItTestsMore?: string;
  whyItMatters: string;
  howToRead: string;
  /** Optional concept diagram shown at the top of the explainer column. */
  diagram?: ReactNode;
  children?: ReactNode;
}

/**
 * Two-column experience scaffold: a sticky explainer column (a concept
 * diagram + "what this tests", with "why" / "how to read" collapsed by
 * default for progressive disclosure) beside the interactive controls +
 * results. This keeps the teammate-facing explanation one glance away
 * without forcing a wall of text or a long scroll.
 */
export function ExperienceLayout({
  testId,
  title,
  whatItTests,
  whatItTestsMore,
  whyItMatters,
  howToRead,
  diagram,
  children,
}: Props) {
  return (
    <article data-testid={testId} className="experience-layout">
      <header className="experience-header">
        <h2 data-testid={`${testId}-title`}>{title}</h2>
      </header>

      <div className="experience-layout-grid">
        <aside className="experience-explainer">
          {diagram ? <div className="experience-diagram">{diagram}</div> : null}

          <div data-testid={`${testId}-what`} className="explainer-block">
            <h3 data-testid={`${testId}-what-heading`}>What this tests</h3>
            <div data-testid={`${testId}-what-body`} className="explainer-prose">
              <Markdown text={whatItTests} />
            </div>
            {whatItTestsMore && (
              <details className="prose-more" data-testid={`${testId}-what-more`}>
                <summary>Show more</summary>
                <div className="explainer-prose">
                  <Markdown text={whatItTestsMore} />
                </div>
              </details>
            )}
          </div>

          <details data-testid={`${testId}-why`} className="explainer-collapsible">
            <summary data-testid={`${testId}-why-heading`}>Why multiplayer needs it</summary>
            <div data-testid={`${testId}-why-body`} className="explainer-prose">
              <Markdown text={whyItMatters} />
            </div>
          </details>

          <details data-testid={`${testId}-how`} className="explainer-collapsible">
            <summary data-testid={`${testId}-how-heading`}>How to read the result</summary>
            <div data-testid={`${testId}-how-body`} className="explainer-prose">
              <Markdown text={howToRead} />
            </div>
          </details>
        </aside>

        <div className="experience-main-col">
          <section data-testid={`${testId}-controls`} className="experience-layout-controls">
            {children}
          </section>
        </div>
      </div>
    </article>
  );
}
