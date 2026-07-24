import { useEffect, useRef, useState } from "react";

type Health = "checking" | "ok" | "waking";

/**
 * Cold-start feedback (DEPLOY.md): the Render free tier spins the server down
 * after ~15 min idle, so the WS relay / signaling / health endpoint can be
 * unreachable for ~30–60s while it wakes. This polls `/api/health` and shows a
 * non-blocking banner while it's unreachable, clearing once it responds — so a
 * paired/transport run isn't attempted against a server that's still waking
 * (client-only experiments still work meanwhile). In dev the server is always
 * up, so this never shows.
 */
async function ping(signal: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch("/api/health", { signal, cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}

export function ServerWakeBanner() {
  const [health, setHealth] = useState<Health>("checking");
  const [dismissed, setDismissed] = useState(false);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    let stopped = false;
    const controller = new AbortController();

    const tick = async () => {
      const ok = await ping(controller.signal);
      if (stopped) return;
      if (ok) {
        setHealth("ok");
        return; // healthy — stop polling
      }
      setHealth("waking");
      startedAt.current = startedAt.current || Date.now();
      timer = window.setTimeout(tick, 3000);
    };

    let timer = window.setTimeout(tick, 300);
    return () => {
      stopped = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, []);

  if (health === "ok" || health === "checking" || dismissed) return null;

  return (
    <div className="server-wake-banner" role="status" data-testid="server-wake-banner">
      <span className="server-wake-spinner" aria-hidden="true" />
      <span className="server-wake-text">
        <strong>Waking the server…</strong> the free-tier host spins down after ~15&nbsp;min idle —
        give it ~30–60s. Client-only experiments (Sim-snapshot, solo demos) work now; paired /
        transport runs need the server. Retrying <code>/api/health</code>…
      </span>
      <button
        type="button"
        className="server-wake-dismiss"
        data-testid="server-wake-dismiss"
        aria-label="Dismiss"
        onClick={() => setDismissed(true)}
      >
        ✕
      </button>
    </div>
  );
}
