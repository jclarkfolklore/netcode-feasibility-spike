import { useEffect } from "react";
import { createPortal } from "react-dom";

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * "How to run" modal — explains the two-machine pairing now that room/role
 * are set from the sidebar controls (SessionSetup) instead of the URL.
 * ESC or backdrop click closes.
 */
export function InstructionsModal({ open, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  // Portal to <body>: rendered inside the sidebar's stacking context, the
  // fixed overlay would sit BELOW app-main's cards. Portaling escapes it.
  return createPortal(
    <div className="instructions-overlay" data-testid="instructions-modal" role="dialog" aria-modal="true" aria-label="How to run">
      <div className="instructions-backdrop" data-testid="instructions-backdrop" onClick={onClose} />
      <div className="instructions-card">
        <button
          type="button"
          className="instructions-close"
          data-testid="instructions-close"
          aria-label="Close"
          onClick={onClose}
        >
          ✕
        </button>

        <div className="instructions-eyebrow">Netcode feasibility harness · how to run</div>
        <h2 className="instructions-title">Measure real two-player netcode</h2>
        <p className="instructions-lede">
          This harness measures whether a host-authoritative fighting-game exchange feels responsive
          over a real network — RTT, jitter, and <b>felt input lag</b>. The honest number comes from
          <b> two machines</b>; a single browser gives a clearly-labelled simulated preview.
        </p>

        <section className="instructions-sec">
          <h3>Real two-machine run</h3>
          <ol className="instructions-steps">
            <li>
              In the sidebar <b>Session setup</b>, click <b>new</b> to generate a room id and set role
              to <b>host</b>, then <b>Apply</b> (the page reloads into that session).
            </li>
            <li>
              Click <b>invite link → guest</b> to copy the guest URL, and send it to the second
              machine (or on that machine type the <i>same</i> room id and pick role <b>guest</b>).
            </li>
            <li>
              Open it on the second machine. Watch the <b>connection</b> panel — wait until{" "}
              <b>peer: present</b> and the link is <b>open</b>.
            </li>
            <li>
              On the <b>host</b>, click <b>▶ Run all</b>. The guest is host-driven — its experiments
              go green as the host runs them.
            </li>
            <li>
              Read <b>Summary</b> for the verdict. The guest reports real felt-lag and transport RTT
              on its own clock.
            </li>
          </ol>
        </section>

        <section className="instructions-sec">
          <h3>Solo preview (one browser)</h3>
          <p>
            Leave the room empty (click <b>solo</b>). Both halves run in one browser over a loopback
            pair with a fixed simulated network. Useful to sanity-check the flow — it is{" "}
            <b>never</b> a real cross-machine measurement, and every result says so.
          </p>
        </section>

        <section className="instructions-sec">
          <h3>Reading the numbers</h3>
          <p className="instructions-bands">
            Felt input lag bands (@60fps):{" "}
            <span className="band band-good">≤ 1 frame · good</span>
            <span className="band band-acceptable">≤ 3 frames (~50ms) · acceptable</span>
            <span className="band band-bad">&gt; 3 frames · bad</span>
          </p>
        </section>

        <div className="instructions-foot">
          Set room/role any time from the sidebar — no URL editing required.
        </div>
      </div>
    </div>,
    document.body,
  );
}
