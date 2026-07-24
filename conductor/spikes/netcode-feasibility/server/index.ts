import http from "node:http";
import type net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { createStaticHandler } from "./staticServer.js";
import { attachWsRelay } from "./wsRelay.js";
import { attachSignaling } from "./signaling.js";
import { LossProxy } from "./lossProxy.js";
import { log } from "./logger.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(here, "../dist");

/**
 * Public port — what Render (and, in local dev, Vite's proxy config)
 * connects to. Fronted by the `LossProxy`, so `link-loss` toggling
 * (contracts.md §4) is available identically in both environments —
 * "same code paths" (008.2 DoD).
 */
const PUBLIC_PORT = Number(process.env.PORT ?? 8080);
/** Internal port — the actual HTTP/WS app server, loopback-only. */
const INTERNAL_PORT = Number(process.env.INTERNAL_PORT ?? PUBLIC_PORT + 1);

const lossProxy = new LossProxy();

const staticHandler = createStaticHandler(distDir);

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (url.pathname === "/api/loss" && req.method === "GET") {
    res.setHeader("Content-Type", "application/json");
    res.writeHead(200).end(JSON.stringify(lossProxy.getState()));
    return;
  }

  if (url.pathname === "/api/loss" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      let parsed: { enabled?: boolean; dropRate?: number } = {};
      try {
        parsed = body ? JSON.parse(body) : {};
      } catch {
        res.writeHead(400).end(JSON.stringify({ error: "invalid JSON" }));
        return;
      }
      const next = lossProxy.setState(parsed);
      log("loss.toggle", { enabled: next.enabled, dropRate: next.dropRate });
      res.setHeader("Content-Type", "application/json");
      res.writeHead(200).end(JSON.stringify(next));
    });
    return;
  }

  if (url.pathname === "/api/health") {
    res.writeHead(200).end("ok");
    return;
  }

  staticHandler(req, res);
});

const wsRelayServer = new WebSocketServer({ noServer: true });
const signalingServer = new WebSocketServer({ noServer: true });

attachWsRelay(wsRelayServer);
attachSignaling(signalingServer);

server.on("upgrade", (req, socket, head) => {
  // TCP_NODELAY (spec item 3): set on the raw socket before `ws` takes
  // over, so Nagle's algorithm never coalesces the small, frequent frames
  // (60Hz input, ping/pong) either relay carries. Disabling Nagle here is
  // what makes the WS latency baseline comparable to WebRTC's
  // unreliable channel, which has no send-side coalescing of its own.
  (socket as net.Socket).setNoDelay(true);

  const url = new URL(req.url ?? "/", "http://localhost");
  const room = url.searchParams.get("room") ?? undefined;
  const role = url.searchParams.get("role") ?? undefined;
  if (url.pathname === "/ws") {
    log("upgrade", { endpoint: "/ws", room, role });
    wsRelayServer.handleUpgrade(req, socket, head, (ws) => {
      wsRelayServer.emit("connection", ws, req);
    });
  } else if (url.pathname === "/signal") {
    log("upgrade", { endpoint: "/signal", room, role });
    signalingServer.handleUpgrade(req, socket, head, (ws) => {
      signalingServer.emit("connection", ws, req);
    });
  } else {
    socket.destroy();
  }
});

server.listen(INTERNAL_PORT, "127.0.0.1", () => {
  log("server.start", { scope: "internal", host: "127.0.0.1", port: INTERNAL_PORT });
});

lossProxy.listen(PUBLIC_PORT, INTERNAL_PORT);
log("server.start", {
  scope: "public",
  port: PUBLIC_PORT,
  proxyTo: INTERNAL_PORT,
  note: "loss-proxy-fronted",
});
