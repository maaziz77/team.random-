# The app server (`app/`)

Express 4 + `ws` 8 on one HTTP server, **port 8000**. Modules are described in
`app/src/README.md`; this file covers HTTP: routes, pages, static files, the WebSocket handshake.

## Startup (`src/server.js` → `main()`)

1. `await loadPublicKey()` (src/auth.js): wait until the auth server has written the public key.
2. Build the Express app (below), create `http.createServer(app)`, attach the WebSocket
   handshake, call `sessions.start()` (starts the 30 Hz tick loop and the 20 s ping loop), and
   `listen(8000)` logging `app: listening on 8000`. Any startup error: log and exit 1.

## Express setup

- `app.disable("x-powered-by")`. Do **not** add `X-Content-Type-Options` here (nginx adds it).
- Static files:
  - `/static` → `app/public` with `express.static(PUBLIC, { index: false, maxAge: "1h", setHeaders })`
    where `setHeaders` sets `Cache-Control: no-cache` for `.js`, `.css` and `.html` files.
  - `/shared` → `app/shared` with `{ index: false }` and `Cache-Control: no-cache`.
- Unknown routes: 404 text "Not found".

## Routes

| Route | Behaviour |
|---|---|
| `GET /` | `Cache-Control: no-store`. The home page (HTML below). Logged in = `userFromRequest(req)` (src/auth.js) returns a username. When logged in, make sure a `csrf` cookie exists (see "CSRF for the logout form") and embed it. `?err=nosession` → error "No session with that code. Check it, or host your own."; `?err=full` → "That session is full."; anything else → no error. |
| `GET /play` | The lobby page: if not logged in → **303 to `/login`**. `Cache-Control: no-store`. If `?code=` is present, upper-case it; if it isn't `^[A-Z0-9]{5}$` → 303 to `/?err=nosession`. Otherwise send the file `public/pages/lobby.html`. (`?host=1` is handled by the page's script.) |
| `GET /maze` | Same rules, sends `public/pages/maze.html`. |
| `GET /me` | `Cache-Control: no-store`. Not logged in → **401** `{"user":null}`. Logged in → `{"user": name, "csrf": token}` (makes the csrf cookie if missing). The game pages call this when their socket drops, to tell an expired login from a network blip. |
| `GET /ws` (Upgrade) | the WebSocket handshake, below |

## The WebSocket handshake

Use `new WebSocketServer({ noServer: true, maxPayload: 4096 })` and handle the HTTP server's
`upgrade` event yourself:

```
reject(code, msg) = write "HTTP/1.1 {code} {msg}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n" to the socket and destroy it
pathname of req.url must be "/ws"                       else reject(404, "Not Found")
originHost = new URL(req.headers.origin).host            (missing/invalid → null)
originHost must equal req.headers.host                   else reject(403, "Forbidden")   ← stops other sites using your cookie
claims = claimsFromRequest(req)                           (valid RS256 JWT from the token cookie)
claims must exist                                        else reject(401, "Unauthorized")
wss.handleUpgrade(req, socket, head, ws => {
  // the connection lasts no longer than the login
  t = setTimeout(() => ws.close(4401, "login expired"), clamp(claims.exp*1000 - Date.now(), 0, 2**31-1))
  ws.on("close", () => clearTimeout(t))
  sessions.connect(ws, claims.sub)                        ← the ONLY identity the server ever uses
})
```

## CSRF for the logout form

The home page's logout form posts to the auth server, which checks the double-submit token.
`csrfToken(req, res)`: reuse the `csrf` cookie if it matches `^[A-Za-z0-9_-]{32,64}$`, otherwise
create `crypto.randomBytes(24).toString("base64url")` and set it:
`csrf=VALUE; Path=/; Max-Age=604800; SameSite=Strict` (+ `; Secure` behind HTTPS). Return it.

## The home page HTML (exact)

```js
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

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
```

The acceptance test looks for the exact text `Logged in as <b>USERNAME</b>`.
