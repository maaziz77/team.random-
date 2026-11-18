# The Maze (CSE 312 Project): backend build guide

**If you are a coding agent, read this whole file first, then follow it exactly.**

(This guide lives in `docs/` so the repo's own `README.md` stays free for the graders. Every path
below is from the repo root.)

This folder is a skeleton. The **frontend is finished** and lives in `app/public/` (plus
`app/shared/mazeworld.js`, which the browser also loads). Your job is to write the **backend**
(the app server, the auth server, nginx config and Docker Compose) so that the finished
frontend works unchanged, exactly as specified in these documents.

There is a complete reference implementation that these documents were written from. Every
message format, route, constant and rule below is what the frontend already expects. If you
"improve" or rename anything, the frontend will break.

## Rules (read twice)

1. **Do not edit anything in `app/public/`, `app/shared/` or `tests/`**, or `.env.example`/`AGENTS.md`/`docs/`.
   The frontend files arrive from the frontend zip, each with its task (table below), unchanged.
   Don't replace the repo's `README.md` or `.gitignore` either (the `.gitignore` already covers
   `.env`, keys and `node_modules`). They are finished and
   are the source of truth. If a document seems to disagree with them, the files win; read the
   client code (`app/public/js/*.js`) to see what it expects.
2. **Build exactly what the documents describe**: the same file names, module names, routes,
   message names, field names, numbers and behaviour. Do not add features, endpoints,
   messages, settings, pages, frameworks or libraries that aren't listed. Don't skip anything
   either: every requirement here is graded or relied on by the frontend.
3. **Stack (fixed):** Node.js 22, **Express 4** (the web framework), **`ws` 8** (WebSockets),
   **`jsonwebtoken` 9**, **`pg` 8**, **`bcryptjs` 2**. Nothing else: no TypeScript, no ORM, no
   socket.io, no build step, no frontend framework. CommonJS (`require`), `"use strict"`.
4. **Where something is specified as pseudocode, implement that algorithm**, with the given
   constants. The game's feel depends on them.
5. Never commit secrets: no private keys, no `.env` (see `.gitignore`).
6. **The code files are provided as stubs**: `auth/src/server.js` and every file in `app/src/`
   already exist with their final names, exports, classes and method names, and a
   `// TODO (task #N)` comment at each place to fill in. Fill in only the TODOs of your task;
   don't rename or move anything, and don't add files. The stubs run (so the stack starts
   after task #1); when you implement a part, delete the placeholder it replaces (the
   "stack is running" page at `/`, the 501 answers, the `void x;` lines and the dummy returns).
7. When a step says "verify", actually do it before moving on.

## What you are building

A real-time multiplayer browser game for the CSE 312 team project (handout:
https://cse312.com/hw/project.html). Players log in, one **hosts** a session and shares a
5-letter code, others **join** with it. Everyone meets in a **lobby** (a round hall with a
spinning floor and ten "cells"): walking into a cell joins that team. Then every team plays an
endless, procedurally generated **maze**, all at the same time, for 2–5 minutes; the deepest team
wins; then everyone returns to the lobby. A monster (the Watcher) runs on the server in both
stages. The host can add **bots** (server-controlled players) that real players replace when
they join.

The server is **authoritative**: browsers only send which keys are held and one-shot actions;
the server simulates everything 30 times a second and broadcasts the state.

```
browser ──HTTP──▶ nginx :8080 ──/register /login /logout──▶ auth  (Express, signs RS256 JWTs, Postgres)
                     │
                     └──everything else (pages, /static, /shared, /ws)──▶ app (Express + ws: pages, sessions,
                                                                             lobby + maze simulations)
                                                    db (Postgres 16, accounts only, never published)
```

## Folder layout (what you will end up with)

```
README.md                   the repo's own README: becomes the graders' README (step 7; don't overwrite it)
AGENTS.md                   PROVIDED: points agents here
.env.example                PROVIDED: the optional settings (copy to .env, never commit .env)
docker-compose.yml          you write it         (docs/DEPLOY.md)
docker-compose.prod.yml     you write it         (docs/DEPLOY.md): server-only settings for the deploy
nginx/nginx.conf            you write it         (nginx/README.md)
auth/                       (auth/README.md)
  Dockerfile, package.json  you write them       (docs/DEPLOY.md)
  src/server.js             STUB: fill in the TODOs
app/
  Dockerfile, package.json  you write them       (docs/DEPLOY.md)
  src/                      STUBS: fill in the TODOs (app/src/README.md + docs/*.md)
    server.js   Express routes, home page, WebSocket handshake
    auth.js     JWT verification with the public key
    sessions.js sessions, codes, players, bots, the tick loop, broadcasting
    lobby.js    LobbySim: the lobby simulation
    maze.js     MazeMatch + TeamSim: the maze simulation (+ maze bots)
    look.js     makeLook(): random outfits (copied from public/art.js)
  shared/mazeworld.js       FRONTEND ZIP, added by task #7: seeded maze generator + A*/BFS (server AND browser)
  public/                   FRONTEND ZIP, added file by file by tasks #2, #3, #5, #7 (see the table below). Never edit.
tests/                      PROVIDED with the skeleton: e2e.js (acceptance test), load.js, client.js
docs/                       the specs you implement
```

## The frontend files: who adds what

The frontend is finished, but it is **not** in the skeleton zip: each file is added to the repo
by one task, from the **frontend zip**, **unchanged** (byte for byte), so everyone commits their
share. Copy the files listed for your task to the same paths, commit them with your task, and
don't commit files that belong to another task (you may copy them locally to try things, just
leave them out of your commits).

| Task | Adds (paths from the repo root) |
|---|---|
| #2 auth server | `app/public/style.css`, `app/public/art.js` |
| #3 app shell | `app/public/js/net.js`, `app/public/ui.js`, `app/public/assets/` (whole folder: `manifest.js`, `sprites/`, `audio/`) |
| #5 lobby | `app/public/pages/lobby.html`, `app/public/js/lobby.js`, `app/public/js/howto-lobby.js` |
| #7 maze | `app/public/pages/maze.html`, `app/public/js/maze.js`, `app/public/js/howto-maze.js`, `app/shared/mazeworld.js` |

The pages need all of them to work in a browser: the lobby needs #2, #3 and #5 merged; the maze
also needs #7. `app/public/README.md` and `app/shared/README.md` come with the skeleton (task #1),
which keeps both folders in the repo so the Dockerfile's `COPY public` / `COPY shared` work.

## Read these, in this order

| Doc | What it specifies |
|---|---|
| `docs/ARCHITECTURE.md` | containers, how a request flows, who owns what |
| `docs/DEPLOY.md` | `docker-compose.yml` + `docker-compose.prod.yml`, Dockerfiles, package.json files, volumes, ports, and how the live site is deployed |
| `nginx/README.md` | the exact nginx config |
| `auth/README.md` | the auth server: DB schema, keys, JWTs, cookies, CSRF, the login/register pages |
| `app/README.md` | the app server: routes, the home page HTML, static files |
| `docs/SECURITY.md` | every security rule (a violation zeroes the whole project grade) |
| `docs/PROTOCOL.md` | **every WebSocket message**, both directions, exact fields |
| `app/src/README.md` | the app modules and their public functions |
| `docs/SESSIONS.md` | sessions, codes, joining, reconnects, host, bots, stages, the tick loop |
| `docs/LOBBY.md` | the lobby simulation (pseudocode) |
| `docs/MAZE.md` | the maze simulation (pseudocode), including the Watcher's AI |
| `docs/BOTS.md` | bot behaviour in the lobby and the maze (pseudocode) |
| `app/shared/README.md` | how to use the provided maze generator |
| `app/public/README.md` | what each provided page/script does and expects |

## Build order

1. (task #1) `docker-compose.yml`, `docker-compose.prod.yml`, `nginx/nginx.conf`, both `Dockerfile`s and
   `package.json`s (docs/DEPLOY.md). The Compose files **must** be named exactly that: the team
   repo's GitHub Actions deploy looks for both and skips the deploy without them.
   **Verify:** `docker compose up --build`; http://localhost:8080 shows "The stack is running"
   (the stub) and http://localhost:8080/login answers "Accounts arrive with task #2".
2. The auth server (auth/README.md). **Verify:** `docker compose up --build`, open
   http://localhost:8080/register, register, get redirected to `/` (a 404 or blank page from the
   app is fine at this point), and see a `token` cookie.
3. App: `auth.js`, then `server.js` with the home page, static files and game pages, and a
   WebSocket handshake that just accepts. **Verify:** the home page shows "Logged in as …".
4. `look.js`, `sessions.js` (host/join/roster/hello/bots), `lobby.js`. **Verify:** host a game
   in the browser, you see yourself in the hall, add bots, press Start, the 20 s timer runs,
   the Watcher drags stragglers in, everyone is sent to `/maze?code=…`.
5. `maze.js` (players, stations, gates, walking down, the Watcher, freezing, thawing, bots,
   the clock, the leaderboard, results, back to the lobby). **Verify:** play a round with bots.
6. **Acceptance test (must pass):** with the stack running,
   ```
   cd tests && npm install && node e2e.js
   ```
   It must end with `all passed` (41 checks: security, bots, lobby, maze). Run it twice in a
   row; both must pass. Do not edit the test to make it pass.
7. Add the sections described in `docs/DEPLOY.md` ("README the graders need") to the repo's own
   top-level `README.md` (keep what's already in it, like the live link).

## Definition of done

- `docker compose up --build` on a fresh clone serves the game at http://localhost:8080 with
  no other steps.
- `tests/e2e.js` passes twice in a row.
- In a browser: register, host, add 7 bots, start, play the lobby and the maze, see the results,
  return to the lobby. A second browser (private window, another account) joining with the
  code takes over a bot.
- Nothing in `app/public/`, `app/shared/` or `tests/` was changed.
