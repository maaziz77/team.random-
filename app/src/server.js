"use strict";
// The app server's entry point (task #3). Spec: app/README.md.
// Express serves the pages and static files, and a WebSocket server (the `ws` package on the
// same HTTP server, path /ws) carries the game. Who a user is comes only from the JWT cookie,
// verified with the auth server's public key (src/auth.js).
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const { WebSocketServer } = require("ws");
const { loadPublicKey, userFromRequest, claimsFromRequest, parseCookies } = require("./auth");
const sessions = require("./sessions");

const PORT = 8000;
const PUBLIC = path.join(__dirname, "..", "public");
const SHARED = path.join(__dirname, "..", "shared");
const CODE_RE = /^[A-Z0-9]{5}$/;

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const isHttps = (req) => String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";

// The home page's logout form posts to the auth server, which checks the CSRF double-submit
// token. If the browser doesn't have one yet (say its cookie expired), make one here.
function csrfToken(req, res) {
  let t = parseCookies(req.headers.cookie).csrf;
  if (!t || !/^[A-Za-z0-9_-]{32,64}$/.test(t)) {
    t = crypto.randomBytes(24).toString("base64url");
    res.append("Set-Cookie", [`csrf=${t}`, "Path=/", "Max-Age=604800", "SameSite=Strict", isHttps(req) ? "Secure" : null]
      .filter(Boolean).join("; "));
  }
  return t;
}

function shell(title, bodyClass, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@500;700&family=Luckiest+Guy&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/static/style.css">
</head>
<body class="${bodyClass}">
${body}
</body>
</html>`;
}

function homePage(user, csrf, error) {
  const top = `
    <div class="splash">
      <div class="ribbon yellow">CSE 312 Project</div>
      <h1 class="logo"><span>THE</span><span>MAZE</span></h1>
      <p class="sticker">Pick a cell, find your team, then go down the shaft before the Watcher finds you.</p>
    </div>`;
  if (!user) {
    return shell("The Maze", "site", `<main class="screen comic site-screen">${top}
      <div class="cta row">
        <a class="btn" href="/login"><span>Log in</span></a>
        <a class="btn alt" href="/register"><span>Register</span></a>
      </div>
      <p class="keys">You need an account to play. Usernames show above your character.</p>
    </main>`);
  }
  return shell("The Maze", "site", `<main class="screen comic site-screen">${top}
    <div class="userbar">Logged in as <b>${escapeHtml(user)}</b>
      <form method="POST" action="/logout" class="inline">
        <input type="hidden" name="csrf" value="${escapeHtml(csrf)}">
        <button class="link" type="submit">Log out</button>
      </form>
    </div>
    ${error ? `<p class="form-error" role="alert">${escapeHtml(error)}</p>` : ""}
    <div class="home-actions">
      <section class="hcard host">
        <div class="ribbon small">Host</div>
        <p>Start a new session and share its code with your friends.</p>
        <form method="GET" action="/play">
          <input type="hidden" name="host" value="1">
          <button class="btn" type="submit"><span>Host a game</span></button>
        </form>
      </section>
      <section class="hcard join">
        <div class="ribbon small yellow">Join</div>
        <p>Got a code? Type it in.</p>
        <form method="GET" action="/play" class="join-form">
          <input name="code" class="code-input" required maxlength="5" minlength="5" pattern="[A-Za-z0-9]{5}"
            autocomplete="off" spellcheck="false" placeholder="ABCDE" aria-label="Session code">
          <button class="btn alt" type="submit"><span>Join</span></button>
        </form>
      </section>
    </div>
    <p class="keys">Up to 40 players per session. Teams are made in the lobby.</p>
  </main>`);
}

const HOME_ERRORS = {
  nosession: "No session with that code. Check it, or host your own.",
  full: "That session is full.",
};

async function main() {
  await loadPublicKey(); // waits until the auth server has written its public key

  const app = express();
  app.disable("x-powered-by");
  // (nginx adds X-Content-Type-Options: nosniff to every response)

  // static files: game scripts, styles, sprites, and the maze code shared with the server
  app.use("/static", express.static(PUBLIC, {
    index: false, maxAge: "1h",
    setHeaders: (res, file) => { if (/\.(js|css|html)$/.test(file)) res.set("Cache-Control", "no-cache"); },
  }));
  app.use("/shared", express.static(SHARED, {
    index: false,
    setHeaders: (res) => res.set("Cache-Control", "no-cache"),
  }));

  app.get("/", (req, res) => {
    res.set("Cache-Control", "no-store");
    const user = userFromRequest(req);
    const error = Object.hasOwn(HOME_ERRORS, req.query.err) ? HOME_ERRORS[req.query.err] : "";
    res.type("html").send(homePage(user, user ? csrfToken(req, res) : "", error));
  });

  // the game pages: login required. The page then connects to /ws, which checks the token again.
  const gamePage = (file) => (req, res) => {
    if (!userFromRequest(req)) return res.redirect(303, "/login");
    res.set("Cache-Control", "no-store");
    if (req.query.code !== undefined) {
      const code = typeof req.query.code === "string" ? req.query.code.toUpperCase() : "";
      if (!CODE_RE.test(code)) return res.redirect(303, "/?err=nosession");
    }
    res.sendFile(path.join(PUBLIC, "pages", file));
  };
  app.get("/play", gamePage("lobby.html"));
  app.get("/maze", gamePage("maze.html"));

  // the game pages call this when their socket drops, to tell an expired login from a blip
  app.get("/me", (req, res) => {
    res.set("Cache-Control", "no-store");
    const user = userFromRequest(req);
    if (!user) return res.status(401).json({ user: null });
    res.json({ user, csrf: csrfToken(req, res) });
  });

  app.use((req, res) => res.status(404).type("text").send("Not found"));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });

  // The handshake: same-origin pages only (stops other sites opening a socket with your cookie)
  // and a valid token only. The username in the token is the only identity the server uses.
  server.on("upgrade", (req, socket, head) => {
    const reject = (code, msg) => {
      socket.write(`HTTP/1.1 ${code} ${msg}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      socket.destroy();
    };
    let pathname = null;
    try { pathname = new URL(req.url, "http://x").pathname; } catch { /* junk URL */ }
    if (pathname !== "/ws") return reject(404, "Not Found");

    let originHost = null;
    try { originHost = new URL(req.headers.origin).host; } catch { /* missing or junk */ }
    if (!originHost || originHost !== req.headers.host) return reject(403, "Forbidden");

    const claims = claimsFromRequest(req);
    if (!claims) return reject(401, "Unauthorized");

    wss.handleUpgrade(req, socket, head, (ws) => {
      // the connection lasts no longer than the login
      const left = claims.exp * 1000 - Date.now();
      const t = setTimeout(() => ws.close(4401, "login expired"), Math.max(0, Math.min(left, 2 ** 31 - 1)));
      ws.on("close", () => clearTimeout(t));
      sessions.connect(ws, claims.sub);
    });
  });

  sessions.start();
  server.listen(PORT, () => console.log(`app: listening on ${PORT}`));
}

main().catch((e) => { console.error(e); process.exit(1); });
