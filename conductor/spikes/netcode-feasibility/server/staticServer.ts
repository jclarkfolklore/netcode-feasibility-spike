import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Minimal static file server for the built `dist/` output (spec item 3 +
 * F16). No extra dependency — this spike's asset surface is tiny (the
 * built SPA + `public/data/announcer.json`, copied into `dist/` by
 * `vite build` automatically since it lives under `public/`).
 *
 * Sets COOP+COEP on every response so the page is cross-origin-isolated
 * (`crossOriginIsolated === true`), unlocking high-res timers
 * (`performance.now()` sub-millisecond resolution) per F16 — the served
 * page must display this as an observable DoD, not just claim it.
 */
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function setSecurityHeaders(res: ServerResponse): void {
  // F16: cross-origin isolation. `require-corp` blocks cross-origin
  // subresources without CORP/CORS — fine here, the app is self-contained
  // and WS/STUN aren't subresource loads subject to CORP.
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
}

export function createStaticHandler(rootDir: string) {
  return function handleStatic(req: IncomingMessage, res: ServerResponse): void {
    setSecurityHeaders(res);

    const url = new URL(req.url ?? "/", "http://localhost");
    let reqPath = decodeURIComponent(url.pathname);
    if (reqPath === "/") reqPath = "/index.html";

    // Prevent path traversal outside rootDir.
    const filePath = path.normalize(path.join(rootDir, reqPath));
    if (!filePath.startsWith(path.normalize(rootDir))) {
      res.writeHead(400).end("Bad path");
      return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        // SPA fallback: unknown paths (client-side hash routes) get index.html.
        const indexPath = path.join(rootDir, "index.html");
        fs.readFile(indexPath, (err2, indexData) => {
          if (err2) {
            res.writeHead(404).end("Not found");
            return;
          }
          res.setHeader("Content-Type", MIME[".html"]);
          res.writeHead(200).end(indexData);
        });
        return;
      }
      const ext = path.extname(filePath);
      res.setHeader("Content-Type", MIME[ext] ?? "application/octet-stream");
      res.writeHead(200).end(data);
    });
  };
}
