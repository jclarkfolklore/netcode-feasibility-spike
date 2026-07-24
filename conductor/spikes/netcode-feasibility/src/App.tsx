import { useEffect, useState } from "react";
import { Nav } from "./components/Nav";
import { ServerWakeBanner } from "./components/ServerWakeBanner";
import { HomePage } from "./pages/HomePage";
import { TransportPage } from "./pages/TransportExperiencePage";
import { SnapshotPage } from "./pages/SnapshotPage";
import { E2EPage } from "./pages/E2EPage";
import { DeterminismCostExperiencePage } from "./pages/DeterminismCostExperiencePage";
import { SummaryPage } from "./pages/SummaryPage";
import { RunStoreProvider } from "./state/RunStore";

/**
 * Minimal hash-based router. Hash routing (not history/pathname routing)
 * deliberately keeps `?room=&role=` in the URL's search string untouched
 * across page navigation (contracts.md §6 pairing). `/home` is the default
 * landing route.
 */
function useHashRoute(): [string, (route: string) => void] {
  const [route, setRoute] = useState(() => window.location.hash.slice(1) || "/home");

  useEffect(() => {
    const onHashChange = () => setRoute(window.location.hash.slice(1) || "/home");
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const navigate = (next: string) => {
    window.location.hash = next;
  };

  return [route, navigate];
}

function Page({ route, onNavigate }: { route: string; onNavigate: (route: string) => void }) {
  switch (route) {
    case "/summary":
      return <SummaryPage />;
    case "/transport":
      return <TransportPage />;
    case "/sim-snapshot":
      return <SnapshotPage />;
    case "/e2e-remote-input":
      return <E2EPage />;
    case "/determinism-cost":
      return <DeterminismCostExperiencePage />;
    case "/home":
    default:
      return <HomePage onNavigate={onNavigate} />;
  }
}

export function App() {
  const [route, navigate] = useHashRoute();

  return (
    <RunStoreProvider>
      <div data-testid="app-shell" className="app-shell">
        <aside className="app-sidebar" data-testid="app-sidebar">
          <div className="app-brand">
            <span className="app-brand-mark" aria-hidden="true">◈</span>
            <span className="app-brand-text">
              <span className="app-brand-title" data-testid="app-header-title">
                Netcode Feasibility
              </span>
              <span className="app-brand-sub">host-authoritative · track 008</span>
            </span>
          </div>
          <Nav route={route} onNavigate={navigate} />
        </aside>
        <main className="app-main" data-testid="app-main">
          <div className="app-main-inner">
            <ServerWakeBanner />
            <Page route={route} onNavigate={navigate} />
          </div>
        </main>
      </div>
    </RunStoreProvider>
  );
}
