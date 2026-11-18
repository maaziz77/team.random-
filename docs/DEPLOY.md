# Docker Compose, Dockerfiles, package.json, and the live deploy

Create these files exactly. (They are configuration, so they are given in full.)

The file names matter: the team repo already has a GitHub Actions workflow that deploys `main`
to the server on every push, and it needs **`docker-compose.yml` and `docker-compose.prod.yml`**
(it quietly skips the deploy if either is missing). The port must be **`${APP_PORT:-8080}`**:
the server runs the live copy on 8080 and two test copies on 8081 and 8082 from the same files.
Never set `container_name` (the three copies would collide).

## `docker-compose.yml` (project root)

```yaml
# The Maze (CSE 312): run locally with `docker compose up` → http://localhost:8080
services:
  nginx:
    image: nginx:1.27-alpine
    ports:
      - "${APP_PORT:-8080}:80"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      - app
      - auth
    restart: unless-stopped

  auth:
    build: ./auth
    environment:
      DATABASE_URL: postgres://horror:${POSTGRES_PASSWORD:-horror-dev-password}@db:5432/horror
      PRIVATE_KEY_DIR: /auth-keys      # private key: only this container mounts it
      PUBLIC_KEY_DIR: /public-key      # public key: shared with the app
      TOKEN_HOURS: "168"
    volumes:
      - auth_keys:/auth-keys
      - public_key:/public-key
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped

  app:
    build: ./app
    environment:
      PUBLIC_KEY_FILE: /public-key/public.pem
    volumes:
      - public_key:/public-key:ro
    depends_on:
      - auth
    restart: unless-stopped

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: horror
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-horror-dev-password}
      POSTGRES_DB: horror
    volumes:
      - db_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U horror -d horror"]
      interval: 2s
      timeout: 3s
      retries: 30
    restart: unless-stopped
    # no "ports:" on purpose: the database is only reachable from the other containers

volumes:
  db_data:
  auth_keys:
  public_key:
```

## `docker-compose.prod.yml` (project root)

Only used on the server, on top of the first file:
`docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build` (the deploy
script does this; you never run it locally).

```yaml
# Server-only settings, layered over docker-compose.yml by the deploy script.
services:
  nginx:
    # only the server's own nginx (which adds HTTPS) may reach the app; nothing else from outside
    ports: !override
      - "127.0.0.1:${APP_PORT:-8080}:80"
    restart: always
  auth:
    restart: always
  app:
    restart: always
  db:
    restart: always
```

## `auth/package.json`

```json
{
  "name": "horror-auth",
  "version": "1.0.0",
  "private": true,
  "description": "Auth server: registration, login, logout; issues RS256 JWTs",
  "main": "src/server.js",
  "scripts": { "start": "node src/server.js" },
  "dependencies": {
    "bcryptjs": "^2.4.3",
    "express": "^4.21.2",
    "jsonwebtoken": "^9.0.2",
    "pg": "^8.13.1"
  }
}
```

## `auth/Dockerfile`

```dockerfile
FROM node:22-alpine
WORKDIR /srv
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
COPY src ./src
# key directories owned by the unprivileged user (named volumes copy this ownership on first use)
RUN mkdir -p /auth-keys /public-key && chown node:node /auth-keys /public-key && chmod 700 /auth-keys
ENV NODE_ENV=production
EXPOSE 3000
USER node
CMD ["node", "src/server.js"]
```

## `app/package.json`

```json
{
  "name": "horror-app",
  "version": "1.0.0",
  "private": true,
  "description": "Game server: Express pages + WebSocket sessions running the lobby and the maze",
  "main": "src/server.js",
  "scripts": { "start": "node src/server.js" },
  "dependencies": {
    "express": "^4.21.2",
    "jsonwebtoken": "^9.0.2",
    "ws": "^8.18.0"
  }
}
```

## `app/Dockerfile`

```dockerfile
FROM node:22-alpine
WORKDIR /srv
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
COPY src ./src
COPY shared ./shared
COPY public ./public
ENV NODE_ENV=production
EXPOSE 8000
USER node
CMD ["node", "src/server.js"]
```

## `.dockerignore` (in both `app/` and `auth/`)

```
node_modules
npm-debug.log
.DS_Store
```

If you can run npm, also generate lockfiles with `npm install --package-lock-only` in `app/`
and `auth/` (optional; the Dockerfiles work without them).

## `.env` files (optional settings)

Docker Compose reads a `.env` file from the project folder automatically. **Nobody needs one
to run the game**: without it everything uses the defaults in `docker-compose.yml`.
`.env.example` (committed) lists the two settings; `.env` itself is never committed.

| Where | `.env` | What it's for |
|---|---|---|
| your laptop | optional, your own | e.g. `APP_PORT=8090` if 8080 is busy |
| the server, live copy (`~/team.random-/.env`) | **required before the first real deploy** | `POSTGRES_PASSWORD=` a long random string |
| the server, test copies (`~/test-1`, `~/test-2`) | optional | their databases aren't reachable from outside either |

The database password is only applied when the database volume is first created. Changing it
later means the app can't connect until the volume is reset (`docker compose down -v`, which
deletes that database's accounts).

## The live deploy (task #11)

How the team repo already deploys (don't change this part):
1. Every push to `main` runs `.github/workflows/deploy.yml`. It SSHes to the server with a
   key that may only run `/usr/local/bin/cse312-deploy` (`deploy/server-deploy.sh` in the repo).
2. That script checks out the commit in `~/team.random-` and runs
   `docker compose -p cse312-main -f docker-compose.yml -f docker-compose.prod.yml up -d --build`
   with `APP_PORT=8080`. The Actions "Run workflow" button can deploy any branch to the test
   copies instead (`~/test-1` on 8081 → https://test1.cse312-horrorslop.com, `~/test-2` on 8082 →
   test2). Those already have their server nginx set up.
3. So once the Compose files are on `main`, the app runs on the server at `127.0.0.1:8080`.

What task #11 adds: the server's nginx for **cse312-horrorslop.com** still serves the old
placeholder from `/var/www/cse312-horrorslop`. Point it at the app instead. Edit
`/etc/nginx/sites-available/cse312-horrorslop.com` on the server and replace **only** the
`root`, `index` and `location / { try_files ... }` lines of the HTTPS `server` block (keep the
`listen 443 ssl` and `# managed by Certbot` lines, and the port 80 block that redirects to https):

```nginx
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;          # HTTPS ends here; the app needs to know
        proxy_set_header Upgrade $http_upgrade;            # the game's WebSocket (wss://)
        proxy_set_header Connection $cse312_connection_upgrade;
        proxy_read_timeout 1h;
        proxy_send_timeout 1h;
    }
```
(`$cse312_connection_upgrade` is already defined by the test copies' nginx file,
`/etc/nginx/sites-available/cse312-test-copies`.) Then `sudo nginx -t && sudo systemctl reload nginx`.
Keep a copy of the new file in the repo as `deploy/nginx/main.conf`, like `deploy/nginx/test-copies.conf`.

Also on the server, before the first real deploy: put a real database password in
`~/team.random-/.env` (`POSTGRES_PASSWORD=...`, any long random string; Compose reads `.env`
from the project folder; never commit it). Do it before the database is first created: changing
it later means resetting the `db_data` volume.

Check: https://cse312-horrorslop.com shows the home page; http:// redirects to the same path on
https://; register and log in (the `token` cookie has `Secure`); play a round (the game's socket
is `wss://`); `nc -z cse312-horrorslop.com 5432` fails (the database isn't reachable).

## README the graders need (project root `README.md`)

When the backend works, write a project README with these sections (graders read it):
1. **Run it:** `docker compose up --build`, then http://localhost:8080. No other steps.
   Also the link to the deployed app: https://cse312-horrorslop.com.
2. **How it's built:** the container table from docs/ARCHITECTURE.md.
3. **How the requirements are met:** Objective 1 (framework = Express; Compose; nginx reverse
   proxy; Postgres in its own container, not published; home page at `/`), Objective 2 (auth
   container behind nginx; bcrypt; RS256 JWT with `exp`; public key via read-only volume; app
   verifies without calling auth or the DB; keys on volumes so logins survive restarts;
   HttpOnly SameSite=Strict cookie; CSRF double-submit), Objective 3 (shared space = the lobby;
   real time movement/shoving/dragging; WSS through nginx; JWT checked in the handshake;
   username from the token only).
4. **Objective 4** section: Theory and Algorithms, procedural generation (randomised DFS maze,
   braiding, BFS station placement, scaling with depth and team size) + the Watcher's A* AI;
   seeded so server and browsers build identical floors; the host presses **G** in the maze to
   see the algorithms.
5. **Testing:** the host's bot buttons; `cd tests && npm install && node e2e.js`.
