import { useRunStore } from "../state/RunStore";
import { HostAuthoritativeLoopDiagram } from "../components/diagrams/HostAuthoritativeLoopDiagram";
import { Callout } from "../components/Callout";
import { buildRoomUrl } from "../lib/session/session";

interface Props {
  onNavigate: (route: string) => void;
}

const EXPERIENCE_BLURB: Record<string, string> = {
  transport:
    "WebSocket vs WebRTC DataChannel, measured under injected link-loss — does TCP head-of-line blocking actually show up in the tail?",
  "sim-snapshot":
    "Capture the real Phaser fight state, relay it, and render it on a second client with no local sim — is it cheap, and does it look right?",
  "e2e-remote-input":
    "The full loop wired end to end: real input seam -> snapshot -> transport -> guest render. Measures the guest's felt input lag — the decisive number.",
  "determinism-cost":
    "Would seeding the sim's RNG and fixing the timestep be cheap enough to reopen rollback/lockstep instead?",
};

export function HomePage({ onNavigate }: Props) {
  const { experiences, session } = useRunStore();

  const inviteUrl = session.room
    ? buildRoomUrl(session.room, session.role === "host" ? "guest" : "host")
    : null;

  return (
    <div data-testid="page-home">
      <section className="home-hero" data-testid="page-home-hero">
        <div className="home-hero-eyebrow">Track 008 · Netcode Feasibility Spike</div>
        <h1 className="home-hero-title" data-testid="page-home-title">
          Is host-authoritative multiplayer actually feasible for this fighting game?
        </h1>
        <p className="home-hero-sub" data-testid="page-home-subtitle">
          This app runs the real host-authoritative loop — actual Phaser sim on the host, a
          serializable snapshot, a swappable transport, and a guest that renders with{" "}
          <strong>no local simulation</strong> — and measures what actually matters instead of
          arguing about it. Four experiments, one uniform run model, one honest composite score.
        </p>
      </section>

      <div className="home-body">
        {/* LEFT: the clickable navigation — clearly styled as links. */}
        <nav className="home-nav-col" data-testid="page-home-experiences-section" aria-label="Experiments">
          <div className="home-section-heading">
            <h3>Open an experiment →</h3>
          </div>
          <div className="home-nav-cards" data-testid="page-home-experience-cards">
            {experiences.map((exp, i) => (
              <button
                key={exp.id}
                type="button"
                className="experience-card"
                data-testid={`page-home-experience-card-${exp.id}`}
                onClick={() => onNavigate(`/${exp.id}`)}
              >
                <span className="experience-card-index">{String(i + 1).padStart(2, "0")}</span>
                <span className="experience-card-title">{exp.title}</span>
                <p className="experience-card-body">{EXPERIENCE_BLURB[exp.id] ?? ""}</p>
                <span className="experience-card-cta">Open experiment →</span>
              </button>
            ))}
            <button
              type="button"
              className="experience-card experience-card-summary"
              data-testid="page-home-experience-card-summary"
              onClick={() => onNavigate("/summary")}
            >
              <span className="experience-card-index">★</span>
              <span className="experience-card-title">Summary &amp; verdict</span>
              <p className="experience-card-body">
                Every experiment rolled into one weighted composite score + a PDF-exportable report.
              </p>
              <span className="experience-card-cta">Open summary →</span>
            </button>
          </div>
        </nav>

        {/* RIGHT: the explanatory content. */}
        <div className="home-explain-col">
          <section className="home-loop" data-testid="page-home-loop-section">
            <div className="home-section-heading">
              <h3>The loop every experiment measures a slice of</h3>
            </div>
            <HostAuthoritativeLoopDiagram />
          </section>

          <section className="home-section" data-testid="page-home-how-to-read-section">
            <div className="home-section-heading">
              <h3>How to read a result</h3>
            </div>
            <div className="how-to-grid">
          <div className="how-to-step">
            <div className="how-to-step-number">1</div>
            <p>
              Every metric maps to a 0–100 sub-score with a traffic-light band: <strong>good</strong>,{" "}
              <strong>acceptable</strong>, or <strong>bad</strong>, anchored to human-perceptible
              thresholds (frames @60fps), not dataset variance.
            </p>
          </div>
          <div className="how-to-step">
            <div className="how-to-step-number">2</div>
            <p>
              Sub-scores combine with a <strong>geometric mean + min-gate</strong> — one bad metric
              caps the whole composite. A great latency number can't paper over a broken one.
            </p>
          </div>
          <div className="how-to-step">
            <div className="how-to-step-number">3</div>
            <p>
              Distributions are shown as <strong>p50 / p95 / p99</strong>, never a mean — the tail
              is what determines whether something feels bad in practice.
            </p>
          </div>
          <div className="how-to-step">
            <div className="how-to-step-number">4</div>
            <p>
              Determinism-readiness is a <strong>separate axis</strong> — "should we switch to
                  rollback?" — never blended into the host-authoritative feasibility score.
                </p>
              </div>
            </div>
          </section>

          <section className="home-section" data-testid="page-home-two-machine-section">
            <div className="home-section-heading">
              <h3>Running across two machines</h3>
            </div>
            <div className="room-instructions" data-testid="page-home-room-instructions">
              <div className="how-to-grid">
                <div className="how-to-step">
                  <div className="how-to-step-number">1</div>
                  <p>
                    Open this app on the <strong>host</strong> machine — no params needed
                    (<code>role=host</code> is the default).
                  </p>
                </div>
                <div className="how-to-step">
                  <div className="how-to-step-number">2</div>
                  <p>
                    On the second machine, open the same URL with{" "}
                    <code>?room=my-room&amp;role=guest</code>.
                  </p>
                </div>
                <div className="how-to-step">
                  <div className="how-to-step-number">3</div>
                  <p>
                    Run any experiment — results tag themselves with the inferred <code>topology</code>{" "}
                    (<code>loopback</code> / <code>LAN</code> / <code>WAN</code>) automatically.
                  </p>
                </div>
              </div>

              {session.room ? (
                <Callout kind="info" testId="page-home-room-current">
                  This session: room <code>{session.room}</code>, role <code>{session.role}</code>, topology{" "}
                  <code>{session.topology}</code>.
                  {inviteUrl && (
                    <>
                      {" "}
                      Send the other peer: <code data-testid="page-home-room-invite">{inviteUrl}</code>
                    </>
                  )}
                </Callout>
              ) : (
                <Callout kind="note" testId="page-home-room-none">
                  No room is set — you're running <strong>solo / loopback</strong>. That's always valid: it
                  exercises the identical code path, just without a second network peer. A cross-network run is
                  what badges a result's <code>topology</code> as not-loopback.
                </Callout>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
