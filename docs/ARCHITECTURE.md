# Architecture

## Containers (docker compose)

| Service | Image / build | Listens | Published | Role |
|---|---|---|---|---|
| `nginx` | `nginx:1.27-alpine` + `nginx/nginx.conf` | 80 | **`${APP_PORT:-8080}`:80** (the only published port; on the server only to 127.0.0.1) | reverse proxy; sends `/register`, `/login`, `/logout` to `auth`, everything else to `app`; WebSocket upgrade on `/ws` |
| `auth` | `./auth` (node:22-alpine) | 3000 | no | accounts (Postgres), bcrypt, signs RS256 JWTs, login/register/logout pages |
| `app` | `./app` (node:22-alpine) | 8000 | no | home page, game pages, static files, WebSocket server, all game simulation (in memory) |
| `db` | `postgres:16-alpine` | 5432 | **no** (never publish it) | the `users` table |

Named volumes: `db_data` (Postgres), `auth_keys` (the RSA private key: mounted **only** in
`auth`), `public_key` (the RSA public key: written by `auth`, mounted **read-only** in `app`).

## Who owns what

- **auth** is the only thing that reads/writes the database and the only thing that can sign
  tokens. The app never calls it and never touches the database.
- **app** decides who a user is **only** by verifying the JWT in the `token` cookie with the
  public key (RS256). The username is the token's `sub` claim. The app has no database.
- **Game state is in memory** in the app (sessions, lobby, maze). Restarting the app ends running
  games; accounts and logins survive (they're in Postgres and in the signed cookie).
- **The browser draws; the server decides.** Clients send movement intent and actions over the
  WebSocket; the server runs the simulations at 30 Hz and broadcasts snapshots (see
  docs/PROTOCOL.md). The maze walls are never sent: both sides generate them from a seed with
  `app/shared/mazeworld.js`.

## A request's journey

1. `GET /` → nginx → app → home page (logged in or not, from the cookie).
2. `GET /register` → nginx → auth → form with a CSRF token; `POST /register` → auth creates
   the user, sets the `token` cookie, redirects to `/`.
3. "Host a game" is a form `GET /play?host=1` → app serves `public/pages/lobby.html` (login
   required). The page's script opens `ws://host/ws` (`wss://` on HTTPS); nginx upgrades it;
   the app checks Origin + JWT in the handshake; the client sends `{t:"host"}`; the app creates
   a session and replies `hello` with the code. The page rewrites its URL to `/play?code=CODE`.
4. Friends open `/play?code=CODE` (or type the code on the home page) → `{t:"join", code}`.
5. When the lobby round ends the server sends `{t:"go", to:"/maze?code=CODE"}`; every client
   navigates there, reconnects and sends `{t:"join", code}` again; the server knows them by
   username and puts them back in their team.
6. When the match ends: `over` (results), then 14 s later `{t:"go", to:"/play?code=CODE"}`.

## Tick loop (app)

One `setInterval` at 30 Hz runs every session's `tick(dt)` (dt = real elapsed seconds, capped at
0.1). A tick: housekeeping (disconnects, host, empty sessions) → roster broadcast if changed →
run the current stage's simulation → send events → send snapshots. Details: docs/SESSIONS.md.
