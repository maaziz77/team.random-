"use strict";
// ============================================================================================
// STUB: the app server's entry point. Spec: app/README.md (routes, pages, the handshake).
// It already runs (so http://localhost:8080 shows something after Phase 1); each TODO below is
// filled in by the task named in it. Keep the file name, the module names and the routes.
// ============================================================================================
const http = require("http");
const path = require("path");
const express = require("express");
// const crypto = require("crypto");                  // TODO (task #3): csrfToken() needs it
// const { WebSocketServer } = require("ws");         // TODO (task #3): the /ws handshake
const { loadPublicKey /* , userFromRequest, claimsFromRequest, parseCookies */ } = require("./auth");
const sessions = require("./sessions");

const PORT = 8000;
const PUBLIC = path.join(__dirname, "..", "public");
const SHARED = path.join(__dirname, "..", "shared");
void PUBLIC; void SHARED; // used by the static routes (task #3)

// TODO (task #3): escapeHtml, isHttps, csrfToken(req, res), shell(title, bodyClass, body) and
// homePage(user, csrf, error), exactly as in app/README.md ("The home page HTML").

async function main() {
  await loadPublicKey(); // TODO (task #3): real version in src/auth.js waits for the auth server's key

  const app = express();
  app.disable("x-powered-by");

  // TODO (task #3): static files
  //   /static → app/public (no index; maxAge 1h; Cache-Control: no-cache for .js/.css/.html)
  //   /shared → app/shared (no index; Cache-Control: no-cache)

  // TODO (task #3): GET /  → the home page (logged in or not), ?err=nosession|full
  //   (placeholder until then, so you can see the stack is up)
  app.get("/", (req, res) => {
    res.type("html").send(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>The Maze</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fredoka:wght@500;700&display=swap"></head>
<body style="font-family:Fredoka,sans-serif;background:#120f24;color:#fbf6ec;display:grid;place-items:center;min-height:100vh;margin:0">
<main style="text-align:center"><h1>The Maze</h1><p>The stack is running. The home page arrives with task #3.</p></main></body></html>`);
  });

  // TODO (task #3): GET /play → public/pages/lobby.html (login required, ?code checked)
  // TODO (task #3): GET /maze → public/pages/maze.html (same rules)
  // TODO (task #3): GET /me   → {user, csrf} or 401 {user: null}

  app.use((req, res) => res.status(404).type("text").send("Not found"));

  const server = http.createServer(app);

  // TODO (task #3): the WebSocket handshake on "upgrade" (path /ws, Origin host === Host,
  // valid JWT → wss.handleUpgrade → close at token expiry → sessions.connect(ws, claims.sub)).
  server.on("upgrade", (req, socket) => {
    socket.write("HTTP/1.1 501 Not Implemented\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    socket.destroy();
  });

  sessions.start();
  server.listen(PORT, () => console.log(`app: listening on ${PORT}`));
}

main().catch((e) => { console.error(e); process.exit(1); });
