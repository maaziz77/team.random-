"use strict";
// The auth server (task #2). nginx sends it /register, /login and /logout and nothing else; the
// app container never sees these requests. Spec: auth/README.md and docs/SECURITY.md.
//
// - Accounts live in Postgres (bcrypt password hashes, parameterised queries only).
// - On login it signs a JWT with RS256 using a private key that only this container can read.
//   The matching public key goes on a volume the app mounts read-only, so the app can verify
//   tokens on its own: no call back to this server, no database lookup.
// - The token travels in an HttpOnly, SameSite=Strict cookie and expires (the "exp" claim and
//   the cookie's Max-Age agree).
// - Forms are protected against cross-site request forgery with a double-submit token: a
//   random value in a SameSite=Strict cookie that must match a hidden field in the form.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

const PORT = 3000;
const PRIVATE_DIR = process.env.PRIVATE_KEY_DIR || "/auth-keys";
const PUBLIC_DIR = process.env.PUBLIC_KEY_DIR || "/public-key";
const TOKEN_HOURS = Math.max(1, parseInt(process.env.TOKEN_HOURS, 10) || 168);
const TOKEN_SECONDS = TOKEN_HOURS * 3600;

const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;
const PASSWORD_MIN = 8, PASSWORD_MAX = 72; // bcrypt only uses the first 72 bytes
const BCRYPT_COST = 12;

// ------------------------------------------------------------------ 1. keys
// Generated once and kept on named volumes, so tokens (and logins) survive restarts.
function loadKeys() {
  const privFile = path.join(PRIVATE_DIR, "private.pem");
  const pubFile = path.join(PUBLIC_DIR, "public.pem");
  let privatePem;
  if (fs.existsSync(privFile)) {
    privatePem = fs.readFileSync(privFile, "utf8");
  } else {
    const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    privatePem = privateKey.export({ type: "pkcs8", format: "pem" });
    fs.writeFileSync(privFile, privatePem, { mode: 0o600 });
    console.log("auth: generated a new RSA key pair");
  }
  // Always (re)write the public half from the private key, so the two can never disagree.
  // Write to a temp file and rename it, so the app never reads half a file.
  const publicPem = crypto.createPublicKey(privatePem).export({ type: "spki", format: "pem" });
  const tmp = pubFile + ".tmp";
  fs.writeFileSync(tmp, publicPem, { mode: 0o644 });
  fs.renameSync(tmp, pubFile);
  return { privatePem };
}

// ------------------------------------------------------------------ 2. database
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function initDb() {
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id            SERIAL PRIMARY KEY,
          username      VARCHAR(16) NOT NULL,
          password_hash TEXT NOT NULL,
          created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
      // unique regardless of case, but stored and shown exactly as registered
      await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower ON users (lower(username))");
      return;
    } catch (e) {
      if (attempt >= 30) throw e;
      console.log(`auth: waiting for the database (${e.code || e.message})`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

// ------------------------------------------------------------------ helpers
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
    if (!k) continue;
    try { out[k] = decodeURIComponent(v); } catch { /* bad encoding: ignore this cookie */ }
  }
  return out;
}

// nginx sets X-Forwarded-Proto; behind the deploy's HTTPS proxy its first value is "https"
const isHttps = (req) => String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";

// ------------------------------------------------------------------ 3. cookies
function cookie(req, name, value, maxAge, httpOnly) {
  return [
    `${name}=${encodeURIComponent(value)}`, "Path=/", `Max-Age=${maxAge}`, "SameSite=Strict",
    httpOnly ? "HttpOnly" : null, isHttps(req) ? "Secure" : null,
  ].filter(Boolean).join("; ");
}

// ------------------------------------------------------------------ 4. CSRF (double-submit)
// Reuse the token already in the browser if it looks right, otherwise make one. The cookie is
// not HttpOnly (the app's pages embed it in their logout form); it's useless to another site.
function csrfFor(req, res) {
  let t = parseCookies(req.headers.cookie).csrf;
  if (!t || !/^[A-Za-z0-9_-]{32,64}$/.test(t)) t = crypto.randomBytes(24).toString("base64url");
  res.append("Set-Cookie", cookie(req, "csrf", t, TOKEN_SECONDS, false));
  return t;
}
function csrfOk(req) {
  const a = parseCookies(req.headers.cookie).csrf;
  const b = req.body && req.body.csrf;
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length || a.length < 32) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
function noStore(res) { res.set("Cache-Control", "no-store"); }

// ------------------------------------------------------------------ 8. page HTML
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

const field = (req, name) => (req.body && typeof req.body[name] === "string" ? req.body[name] : "");

// ------------------------------------------------------------------ the server
async function main() {
  const { privatePem } = loadKeys();
  await initDb();

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", "loopback, uniquelocal");
  app.use(express.urlencoded({ extended: false, limit: "8kb" }));
  app.use((req, res, next) => { noStore(res); next(); }); // every auth response

  // 5. JWT: sub (the username exactly as registered), iat, exp. Nothing else.
  function issue(req, res, username) {
    const token = jwt.sign({ sub: username }, privatePem, { algorithm: "RS256", expiresIn: TOKEN_SECONDS });
    res.append("Set-Cookie", cookie(req, "token", token, TOKEN_SECONDS, true));
  }

  // a fixed hash to compare against when the username doesn't exist, so both cases take as long
  const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString("hex"), BCRYPT_COST);

  app.get("/login", (req, res) => {
    const note = req.query.registered !== undefined ? "Account made. Log in to play."
      : req.query.expired !== undefined ? "Please log in again." : "";
    res.type("html").send(authForm("login", csrfFor(req, res), { note }));
  });

  app.get("/register", (req, res) => {
    res.type("html").send(authForm("register", csrfFor(req, res)));
  });

  app.post("/register", async (req, res) => {
    const username = field(req, "username").trim();
    const password = field(req, "password");
    const password2 = field(req, "password2");
    const again = (error, status = 400) => res.status(status).type("html").send(
      authForm("register", csrfFor(req, res), { error, username: USERNAME_RE.test(username) ? username : "" }));

    if (!csrfOk(req)) return again("Your form expired. Please try again.", 403);
    if (!USERNAME_RE.test(username)) return again("Usernames are 3–16 letters, numbers or underscores.");
    if (password.length < PASSWORD_MIN || Buffer.byteLength(password) > PASSWORD_MAX) return again("Passwords are 8–72 characters.");
    if (password !== password2) return again("The two passwords don't match.");
    try {
      const hash = await bcrypt.hash(password, BCRYPT_COST);
      await pool.query("INSERT INTO users (username, password_hash) VALUES ($1, $2)", [username, hash]);
    } catch (e) {
      if (e.code === "23505") return again("That username is taken.", 409);
      console.error("auth: register failed", e.message);
      return again("Something went wrong. Please try again.", 500);
    }
    issue(req, res, username); // registered: log straight in
    res.redirect(303, "/");
  });

  app.post("/login", async (req, res) => {
    const username = field(req, "username").trim();
    const password = field(req, "password");
    const again = (error, status = 401) => res.status(status).type("html").send(
      authForm("login", csrfFor(req, res), { error, username: USERNAME_RE.test(username) ? username : "" }));

    if (!csrfOk(req)) return again("Your form expired. Please try again.", 403);
    if (!USERNAME_RE.test(username) || !password || Buffer.byteLength(password) > PASSWORD_MAX) {
      return again("Wrong username or password.");
    }
    let row = null;
    try {
      const r = await pool.query("SELECT username, password_hash FROM users WHERE lower(username) = lower($1)", [username]);
      row = r.rows[0] || null;
    } catch (e) {
      console.error("auth: login failed", e.message);
      return again("Something went wrong. Please try again.", 500);
    }
    const ok = await bcrypt.compare(password, row ? row.password_hash : DUMMY_HASH);
    if (!row || !ok) return again("Wrong username or password.");
    issue(req, res, row.username); // the name exactly as registered
    res.redirect(303, "/");
  });

  app.post("/logout", (req, res) => {
    if (!csrfOk(req)) {
      return res.status(403).type("html").send(page("Log out",
        `<div class="splash small"><h1 class="logo"><span>OOPS</span></h1><p class="sticker">That logout link expired. <a href="/">Back home</a></p></div>`));
    }
    res.append("Set-Cookie", cookie(req, "token", "", 0, true));
    res.redirect(303, "/");
  });

  // logging out takes a POST with the CSRF token
  app.get("/logout", (req, res) => res.redirect(303, "/"));

  app.use((req, res) => res.status(404).type("text").send("Not found"));
  app.listen(PORT, () => console.log(`auth: listening on ${PORT}`));
}

main().catch((e) => { console.error(e); process.exit(1); });
