import { useRunStore } from "../state/RunStore";

interface Props {
  experienceId: string;
  /** data-testid for the button (kept identical to the old per-page value so
   * existing selectors/tests keep working). */
  testId: string;
  /** Label when this tab CAN run it (host or solo). Guest paired sessions always
   * show the host-driven affordance instead. */
  label?: string;
}

/**
 * The one place the "who may press Run" rule lives. On a paired GUEST tab the
 * host drives every run over the companion channel, so a manual Run here would
 * only ever hit the "no host driving" failure — instead of offering that trap,
 * the button is disabled and labelled "host-driven", and the guest's own state
 * still goes running → green as the host drives it (RunStore companion hooks).
 */
export function RunButton({ experienceId, testId, label = "Run measurement" }: Props) {
  const { runOne, runState, hostDriven } = useRunStore();
  const isRunning = runState(experienceId) === "running";

  if (hostDriven) {
    return (
      <button
        type="button"
        data-variant="primary"
        data-testid={testId}
        data-host-driven="true"
        disabled
        title="Paired session: the host drives every run. This starts automatically here when the host runs it — watch it go green."
      >
        {isRunning ? "Running…" : "▶ Host-driven"}
      </button>
    );
  }

  return (
    <button
      type="button"
      data-variant="primary"
      data-testid={testId}
      disabled={isRunning}
      onClick={() => void runOne(experienceId)}
    >
      {isRunning ? "Running…" : label}
    </button>
  );
}
