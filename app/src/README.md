# App modules (`app/src/`)

Six CommonJS files, **provided as stubs**: each already has its final exports, classes and
method names, and a `// TODO (task #N)` at each place to fill in (the stubs run, so the stack
starts before anything is implemented). Exports are fixed: other modules (and the docs) rely on
these names. Which task fills in what:

| File | Tasks |
|---|---|
| `server.js`, `auth.js` | #3 |
| `look.js`, `sessions.js` | #4 (the bot parts of `sessions.js`: #6) |
| `lobby.js` | #5 (the bot brain: #6) |
| `maze.js` | #7 (the Watcher: #8; bots: #9) |

| File | Exports | Spec |
|---|---|---|
| `server.js` | (entry point) | app/README.md |
| `auth.js` | `loadPublicKey, userFromToken, userFromRequest, claimsFromRequest, parseCookies` | below |
| `look.js` | `makeLook` | below |
| `sessions.js` | `connect, start, sessions` | docs/SESSIONS.md |
| `lobby.js` | `LobbySim, planLobby` | docs/LOBBY.md (+ docs/BOTS.md) |
| `maze.js` | `MazeMatch, MATCH_SECONDS` | docs/MAZE.md (+ docs/BOTS.md) |

`maze.js` requires `../shared/mazeworld.js` (added by task #7 from the frontend zip; the stub keeps
the `require` commented out until then; see app/shared/README.md).

Common helpers you will want in lobby.js / maze.js (define them locally in each file):
```js
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
```

## `auth.js`: verifying tokens (no network, no database)

- `KEY_FILE = process.env.PUBLIC_KEY_FILE || "/public-key/public.pem"`,
  `USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/`.
- `async loadPublicKey()`: loop forever: try to read KEY_FILE; if it contains `"PUBLIC KEY"`,
  keep it in a module variable and return it; else wait 1 s (log
  `app: waiting for the auth server's public key at ...` on attempts 1, 6, 11, …).
- `parseCookies(header)`: same parser as the auth server (split `;`, first `=`, decodeURIComponent
  with try/catch).
- `claimsFromToken(token)`: return `null` unless `publicKey` is loaded and `token` is a string of
  at most 4096 chars; `jwt.verify(token, publicKey, { algorithms: ["RS256"] })` inside try/catch
  (any error → null); require `typeof claims.exp === "number"` and `typeof claims.sub === "string"`
  matching USERNAME_RE; return the claims.
- `userFromToken(token)` → `claims.sub` or null.
- `claimsFromRequest(req)` / `userFromRequest(req)`: the same, reading the `token` cookie.

## `look.js`: random outfits

Copy the outfit generator **verbatim** from `app/public/art.js` (in the frontend zip; task #2 adds it to the repo): the constants `SHIRTS`,
`ACCENTS`, `PANTS`, `SHOES`, `STYLES`, `HAIR`, `HAIR_COL`, `HATS` and the function
`makeLook(rnd = Math.random)` (the section starting at the comment `// shirts: [main, shade].`
and ending just before `// ------------------------------------------------------------------ rig`).
It also needs `const INK = "#1d1b26"` and `const lerp = (a, b, t) => a + (b - a) * t`. Export
`{ makeLook }`. The server makes each player's look so every client draws the same outfit.
