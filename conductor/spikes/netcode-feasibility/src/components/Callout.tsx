import type { ReactNode } from "react";

export type CalloutKind = "info" | "warning" | "success" | "danger" | "note";

const GLYPH: Record<CalloutKind, string> = {
  info: "ℹ",
  warning: "⚠",
  success: "✓",
  danger: "✕",
  note: "※",
};

/**
 * Typed callout — a short (1–3 sentence) bordered block that interrupts the
 * reading flow on purpose. Ration it: max two visible per page. See
 * DESIGN-PHILOSOPHY.md §2.1 for when to use which kind:
 *  - info    — neutral context the reader needs before acting
 *  - warning — a validity caveat (loopback / not-a-real-measurement)
 *  - success — a measured, positive finding
 *  - danger  — a measured, negative finding or a broken/failed state
 *  - note    — aside / provenance, lowest urgency
 */
export function Callout({
  kind,
  children,
  testId,
}: {
  kind: CalloutKind;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <div className="callout" data-kind={kind} data-testid={testId} role="note">
      <span className="callout-glyph" aria-hidden="true">
        {GLYPH[kind]}
      </span>
      <div className="callout-body">{children}</div>
    </div>
  );
}
