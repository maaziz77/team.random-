# The auth server (`auth/`)

One file: `auth/src/server.js` (Express 4, `pg`, `bcryptjs`, `jsonwebtoken`, Node's `crypto`),
provided as a **stub** with `// TODO (task #2)` markers; it already starts and answers 501.
Listens on **port 3000**. nginx sends it `/register`, `/login`, `/logout` and nothing else.

Environment (from docker-compose.yml): `DATABASE_URL`, `PRIVATE_KEY_DIR` (default `/auth-keys`),
`PUBLIC_KEY_DIR` (default `/public-key`), `TOKEN_HOURS` (default 168 = 7 days, min 1).
`TOKEN_SECONDS = TOKEN_HOURS * 3600`.

## Rules

- Usernames: regex `^[A-Za-z0-9_]{3,16}$`. Trim the submitted value first. Unique
  **case-insensitively**, but stored and shown exactly as registered.
- Passwords: at least 8 characters, at most **72 bytes** (`Buffer.byteLength`), because bcrypt
  ignores the rest.
- bcrypt cost **12**.
- **Every SQL query is parameterised** (`$1`, `$2`). Never build SQL from strings.

## 1. Keys (at startup, before anything else)

```
privFile = PRIVATE_KEY_DIR/private.pem ; pubFile = PUBLIC_KEY_DIR/public.pem
if privFile exists: read it
else: generate RSA 2048 (crypto.generateKeyPairSync("rsa", {modulusLength: 2048})),
      export the private key as PKCS#8 PEM, write it with mode 0o600, log "auth: generated a new RSA key pair"
always: derive the public key from the private key (crypto.createPublicKey(privatePem)),
        export as SPKI PEM, write it to pubFile + ".tmp" (mode 0o644) and rename to pubFile
        (atomic, so the app never reads half a file)
```
The keys live on named volumes, so they survive restarts and so do logins.

## 2. Database (after the keys)

Retry connecting up to 30 times, 1 s apart (log `auth: waiting for the database (...)`), then:

```sql
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(16) NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower ON users (lower(username));
```
There is no admin account and no roles.

## 3. Cookies

Helper `cookie(req, name, value, maxAge, httpOnly)` builds a Set-Cookie string:
`name=encodeURIComponent(value); Path=/; Max-Age=maxAge; SameSite=Strict` plus `; HttpOnly` if
`httpOnly`, plus `; Secure` if the request came over HTTPS (first value of the
`X-Forwarded-Proto` header is `https`). Use `res.append("Set-Cookie", ...)` so several cookies
can be set. Parse incoming cookies yourself from `req.headers.cookie` (split on `;`, first `=`,
`decodeURIComponent` the value; ignore bad encodings).

- `token`: the JWT. **HttpOnly**, Max-Age = TOKEN_SECONDS.
- `csrf`: the CSRF double-submit token. **Not** HttpOnly (the app's logout form embeds it),
  Max-Age = TOKEN_SECONDS.

## 4. CSRF (double-submit)

- `csrfFor(req, res)`: take the `csrf` cookie if it matches `^[A-Za-z0-9_-]{32,64}$`, otherwise
  make a new one with `crypto.randomBytes(24).toString("base64url")`. Always (re)set the `csrf`
  cookie and return the value. Every form page embeds it as `<input type="hidden" name="csrf">`.
- `csrfOk(req)`: the `csrf` cookie and the `csrf` form field are both strings of the same
  length, at least 32, and equal by `crypto.timingSafeEqual`.

## 5. JWT

`jwt.sign({ sub: username }, privatePem, { algorithm: "RS256", expiresIn: TOKEN_SECONDS })`.
Claims: `sub` (the username exactly as registered), `iat`, `exp`. Nothing else.
`issue(req, res, username)` signs and sets the `token` cookie.

## 6. Express setup

`app.disable("x-powered-by")`; `app.set("trust proxy", "loopback, uniquelocal")`;
`express.urlencoded({ extended: false, limit: "8kb" })`. Every auth response sends
`Cache-Control: no-store`.

## 7. Routes

| Route | Behaviour |
|---|---|
| `GET /login` | 200, the login page. Note line: `?registered` → "Account made. Log in to play."; `?expired` → "Please log in again." |
| `GET /register` | 200, the register page |
| `POST /register` | fields `csrf, username, password, password2`. Checks in this order, re-rendering the register page with the error (and the username if it's valid): bad CSRF → **403** "Your form expired. Please try again."; bad username → **400** "Usernames are 3–16 letters, numbers or underscores."; bad password length → **400** "Passwords are 8–72 characters."; mismatch → **400** "The two passwords don't match."; then bcrypt hash and `INSERT INTO users (username, password_hash) VALUES ($1, $2)`; Postgres error code `23505` → **409** "That username is taken."; other DB error → **500** "Something went wrong. Please try again.". On success: `issue()` (log straight in) and **303 redirect to `/`**. |
| `POST /login` | fields `csrf, username, password`. Bad CSRF → **403** "Your form expired. Please try again."; invalid username format, empty password or password over 72 bytes → **401** "Wrong username or password."; `SELECT username, password_hash FROM users WHERE lower(username) = lower($1)`; DB error → **500**; compare with bcrypt; **if the user doesn't exist, still run `bcrypt.compare` against a dummy hash** (made once at startup from random bytes) so both cases take the same time; wrong → **401** "Wrong username or password."; right → `issue(req, res, row.username)` and **303 redirect to `/`**. |
| `POST /logout` | bad CSRF → **403** with a small page (`page("Log out", ...)` showing "That logout link expired." and a link home). Otherwise clear the token (`token` cookie with value `""` and Max-Age 0, HttpOnly) and **303 redirect to `/`**. |
| `GET /logout` | 303 redirect to `/` (logging out needs the POST with the CSRF token) |
| anything else | 404 text "Not found" |

Listen on 3000 and log `auth: listening on 3000`. Any startup error: log it and exit 1.

## 8. Page HTML (exact, the provided CSS depends on these classes)

`escapeHtml` replaces `& < > " '` with entities. Use it on **every** value you put in HTML.

```js
function page(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} – The Maze</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@500;700&family=Luckiest+Guy&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/static/style.css">
</head>
<body class="site">
  <main class="screen comic site-screen">${body}</main>
</body>
</html>`;
}
// kind: "login" | "register"
function authForm(kind, csrf, { error = "", username = "", note = "" } = {}) {
  const reg = kind === "register";
  const title = reg ? "Register" : "Log in";
  return page(title, `
    <div class="splash small">
      <a class="ribbon yellow" href="/">CSE 312 Project</a>
      <h1 class="logo"><span>${reg ? "JOIN" : "LOG"}</span><span>${reg ? "UP" : "IN"}</span></h1>
    </div>
    <form class="panel-form" method="POST" action="/${kind}" autocomplete="on">
      ${note ? `<p class="form-note">${escapeHtml(note)}</p>` : ""}
      ${error ? `<p class="form-error" role="alert">${escapeHtml(error)}</p>` : ""}
      <input type="hidden" name="csrf" value="${escapeHtml(csrf)}">
      <label>Username
        <input name="username" required minlength="3" maxlength="16" pattern="[A-Za-z0-9_]{3,16}"
          autocomplete="username" value="${escapeHtml(username)}" ${username ? "" : "autofocus"}>
      </label>
      <small class="hint">3–16 letters, numbers or _. It's shown above your character.</small>
      <label>Password
        <input name="password" type="password" required minlength="8" maxlength="72"
          autocomplete="${reg ? "new-password" : "current-password"}" ${username ? "autofocus" : ""}>
      </label>
      ${reg ? `<label>Password again
        <input name="password2" type="password" required minlength="8" maxlength="72" autocomplete="new-password">
      </label>` : ""}
      <button class="btn" type="submit"><span>${title}</span></button>
      <p class="switch">${reg ? `Have an account? <a href="/login">Log in</a>` : `New here? <a href="/register">Register</a>`}</p>
    </form>`);
}
```

The logout-error page body: `<div class="splash small"><h1 class="logo"><span>OOPS</span></h1><p class="sticker">That logout link expired. <a href="/">Back home</a></p></div>`.

## What the acceptance test checks here

Login without CSRF → 403; wrong password → 401 and no token; register without CSRF → 403;
username `<b>x</b>` → 400 and the HTML is **not** echoed back; logout without CSRF → 403;
logout with CSRF → 303 and the `token` cookie cleared; every cookie is `SameSite=Strict`;
the token has `sub` and `exp`.
