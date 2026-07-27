import { useState } from "react";
import { useRunStore } from "../state/RunStore";
import { buildRoomUrl } from "../lib/session/session";
import type { Role } from "../lib/contracts";

/**
 * UI controls for the room/role pairing that used to require hand-editing
 * `?room=&role=` in the URL. Applying navigates the browser to the same URL
 * with the chosen params — a full reload so `parseSession()` (RunStore, once
 * at mount) re-reads them and the transport re-inits under the new session.
 */
function randomRoom(): string {
  return `room-${Math.random().toString(36).slice(2, 7)}`;
}

function applySession(room: string, role: Role): void {
  const url = new URL(window.location.href);
  const r = room.trim();
  if (r) {
    url.searchParams.set("room", r);
    url.searchParams.set("role", role);
  } else {
    url.searchParams.delete("room");
    url.searchParams.delete("role");
  }
  // Full reload: session is parsed once at load, so re-applying it means
  // re-entering the app with the new search string.
  window.location.href = url.toString();
}

export function SessionSetup() {
  const { session } = useRunStore();
  const [room, setRoom] = useState(session.room ?? "");
  const [role, setRole] = useState<Role>(session.role);
  const [copied, setCopied] = useState<Role | null>(null);

  const dirty = (room.trim() || null) !== (session.room ?? null) || role !== session.role;

  const copyLink = async (linkRole: Role) => {
    const r = room.trim();
    if (!r) return;
    try {
      await navigator.clipboard.writeText(buildRoomUrl(r, linkRole));
      setCopied(linkRole);
      window.setTimeout(() => setCopied((c) => (c === linkRole ? null : c)), 1400);
    } catch {
      /* clipboard blocked — the link is still visible on the badge below */
    }
  };

  return (
    <div className="session-setup" data-testid="session-setup">
      <div className="session-setup-title" data-testid="session-setup-title">
        session setup
      </div>

      <label className="session-setup-field">
        <span className="session-setup-label">room</span>
        <span className="session-setup-room-row">
          <input
            type="text"
            className="session-setup-input"
            data-testid="session-setup-room"
            value={room}
            placeholder="solo (loopback)"
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setRoom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && dirty) applySession(room, role);
            }}
          />
          <button
            type="button"
            className="session-setup-mini"
            data-testid="session-setup-new"
            title="Generate a fresh room id"
            onClick={() => setRoom(randomRoom())}
          >
            new
          </button>
        </span>
      </label>

      <div className="session-setup-field">
        <span className="session-setup-label">role</span>
        <div className="session-setup-roles" role="radiogroup" aria-label="role">
          {(["host", "guest"] as const).map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={role === r}
              className={`session-setup-role ${role === r ? "is-active" : ""}`}
              data-testid={`session-setup-role-${r}`}
              onClick={() => setRole(r)}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="session-setup-actions">
        <button
          type="button"
          className="session-setup-apply"
          data-testid="session-setup-apply"
          disabled={!dirty}
          title={dirty ? "Reload into this room/role" : "Already the active session"}
          onClick={() => applySession(room, role)}
        >
          {dirty ? "Apply" : "Active"}
        </button>
        <button
          type="button"
          className="session-setup-mini"
          data-testid="session-setup-solo"
          title="Clear room — single-browser loopback preview"
          disabled={!session.room && !room.trim()}
          onClick={() => applySession("", role)}
        >
          solo
        </button>
      </div>

      <div className="session-setup-copy">
        <span className="session-setup-label">invite link</span>
        <span className="session-setup-copy-btns">
          <button
            type="button"
            className="session-setup-mini"
            data-testid="session-setup-copy-host"
            disabled={!room.trim()}
            onClick={() => void copyLink("host")}
          >
            {copied === "host" ? "copied ✓" : "host"}
          </button>
          <button
            type="button"
            className="session-setup-mini"
            data-testid="session-setup-copy-guest"
            disabled={!room.trim()}
            onClick={() => void copyLink("guest")}
          >
            {copied === "guest" ? "copied ✓" : "guest"}
          </button>
        </span>
      </div>

      {/* Active (applied) session — what's actually live right now. */}
      <div data-testid="app-nav-session-badge" className="session-badge">
        <span className="session-badge-row">
          <span className="session-badge-key">active</span>
          <span className="session-badge-val">
            {session.room ? `${session.room} · ${session.role}` : "solo"}
          </span>
        </span>
        <span className="session-badge-row">
          <span className="session-badge-key">topo</span>
          <span className={`session-badge-val topo-${session.topology}`}>{session.topology}</span>
        </span>
      </div>
    </div>
  );
}
