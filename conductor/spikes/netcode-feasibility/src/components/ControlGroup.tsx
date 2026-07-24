import type { ReactNode } from "react";
import { InfoTip } from "./InfoTip";

/**
 * A named set of related controls — the fieldset replacement. Related knobs
 * live together under a small-caps title so a group of inputs reads as one
 * unit ("Input timing", "Simulated network"). See DESIGN-PHILOSOPHY.md §7.
 *
 * Children are typically a `.field-grid` of labeled inputs.
 */
export function ControlGroup({
  title,
  tip,
  children,
  testId,
}: {
  title: string;
  /** Optional group-level tooltip explaining the whole set. */
  tip?: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <div className="control-group" data-testid={testId}>
      <div className="control-group-title">
        <span>{title}</span>
        {tip && <InfoTip text={tip} testId={testId && `${testId}-tip`} />}
      </div>
      {children}
    </div>
  );
}
