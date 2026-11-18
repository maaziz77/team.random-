# `app/public/` (the finished frontend: never edit; added file by file from the frontend zip)

Served by the app at `/static/...` (see app/README.md). The two game pages are sent by the
`/play` and `/maze` routes; everything else is loaded by them.

| File | Added by | What it is |
|---|---|---|
| `pages/lobby.html` | #5 | the lobby page (route `GET /play`). Loads the scripts below + `js/lobby.js` |
| `pages/maze.html` | #7 | the maze page (route `GET /maze`). Also loads `/shared/mazeworld.js`, then `js/maze.js` |
| `js/net.js` | #3 | the WebSocket client (`Net`), keyboard → `{t:"in"}` (`Input`), `escapeHtml`, and `Fit` (start screens shrink to fit the window) |
| `js/lobby.js` | #5 | draws the lobby from `L` snapshots; host controls (Start, match length, bots); the mingle music |
| `js/maze.js` | #7 | rebuilds each team's shaft from `mintro.seed` and draws it from `M` snapshots; leaderboard; results; host-only algorithm view (G) |
| `js/howto-lobby.js`, `js/howto-maze.js` | #5, #7 | the how-to cards |
| `art.js` | #2 | characters (drawn in code from each player's `look`), light panels, levers, plates. `makeLook()` lives here too (task #4 copies it into src/look.js) |
| `ui.js` | #3 | how-to card animations, team cards, tip cards |
| `style.css` | #2 | all styles, including the home, login and register pages the servers render |
| `assets/` | #3 | sprites, the Watcher photos, `audio/mingle.mp3`, `manifest.js` (image list with `/static/assets/...` paths) |

## What the pages do with the server (so you can debug)

- On load the page calls `Net.start()`: `/play?host=1` → sends `{t:"host"}`;
  `?code=X` → `{t:"join", code:X}`; neither → goes to `/`.
- On `hello` it rewrites the URL to `/play?code=CODE` (or `/maze?code=CODE`). If `hello.stage`
  doesn't match the page (lobby vs maze/results), it navigates to the right page.
- On `go` it navigates to `to`. On `err` `nosession`/`full` it goes to `/?err=nosession|full`.
- If the socket drops (not 4000), it calls `GET /me`: 401 → `/login?expired=1`; otherwise it
  reconnects with `{t:"join", code}` after a short delay.
- The lobby page shows the host's controls only if `roster.host === hello.you` and the lobby phase
  is `wait`. The maze page shows G only to the host.
- Bots are recognised by `roster.players[i].bot`.
