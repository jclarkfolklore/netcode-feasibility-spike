/**
 * Structured, greppable server logging for real-time auditing.
 *
 * Every line: `[ISO-8601] <event> key=val key=val`. Designed to be read live
 * via `render logs` (tail) so you can watch connections pair up and traffic
 * actually flow peer-to-peer — the audit that the round trip is genuinely
 * working, not shortcutting. High-frequency data (60Hz relayed frames) is
 * NOT logged per-message; instead the relay emits a periodic per-room
 * throughput summary (see `wsRelay.ts`) so the tail stays readable.
 */
export type LogFields = Record<string, string | number | boolean | undefined>;

function fmt(v: string | number | boolean): string {
  if (typeof v === "string" && /[\s"=]/.test(v)) return JSON.stringify(v);
  return String(v);
}

export function log(event: string, fields: LogFields = {}): void {
  const parts = Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${fmt(v as string | number | boolean)}`);
  // eslint-disable-next-line no-console
  console.log(`[${new Date().toISOString()}] ${event}${parts.length ? " " + parts.join(" ") : ""}`);
}
