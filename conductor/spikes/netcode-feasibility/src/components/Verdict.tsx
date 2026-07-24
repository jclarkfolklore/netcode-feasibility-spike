import type { ReactNode } from "react";
import type { BandValue } from "./Band";

interface Props {
  /** Small uppercase label above the headline, e.g. "Host-authoritative feasibility". */
  eyebrow: string;
  /** The big plain-language verdict, e.g. "Feasible with caveats". */
  label: string;
  /** The numeric score, already formatted (or "—" when no data). */
  score: string;
  band: BandValue;
  meta?: ReactNode;
  testId?: string;
}

/** Big banner verdict — the "traffic light + headline" the room reads from the back. */
export function Verdict({ eyebrow, label, score, band, meta, testId }: Props) {
  return (
    <section className="verdict-banner" data-band={band} data-testid={testId}>
      <div className="verdict-banner-light" aria-hidden="true" />
      <div>
        <div className="verdict-banner-eyebrow">{eyebrow}</div>
        <div className="verdict-banner-label">{label}</div>
        {meta && <div className="verdict-banner-meta">{meta}</div>}
      </div>
      <div className="verdict-banner-score">
        {score}
        <span className="verdict-banner-score-unit"> /100</span>
      </div>
    </section>
  );
}
