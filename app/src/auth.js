"use strict";
// Verifying login tokens in the app (task #3). Spec: app/src/README.md ("auth.js").
// The app never calls the auth server and never uses a database to decide who someone is:
// only the RS256 signature, checked with the auth server's public key from the shared volume.
const fs = require("fs");
const jwt = require("jsonwebtoken");

const KEY_FILE = process.env.PUBLIC_KEY_FILE || "/public-key/public.pem";
const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;

let publicKey = null;

// The auth server writes the key when it starts; wait for it rather than failing.
async function loadPublicKey() {
  for (let attempt = 1; ; attempt++) {
    try {
      const pem = fs.readFileSync(KEY_FILE, "utf8");
      if (pem.includes("PUBLIC KEY")) { publicKey = pem; return publicKey; }
    } catch { /* not there yet */ }
    if (attempt % 5 === 1) console.log(`app: waiting for the auth server's public key at ${KEY_FILE}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

// Same parser as the auth server: split on ";", first "=", decode safely.
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

// The claims of a valid token, or null for a missing, forged, expired or wrongly signed one.
// Only RS256 is accepted, so "none" tokens and HMAC tokens (signed with the public key used as a
// secret) are refused. jsonwebtoken checks exp itself; a token without one is refused too.
function claimsFromToken(token) {
  if (!publicKey || typeof token !== "string" || token.length > 4096) return null;
  try {
    const claims = jwt.verify(token, publicKey, { algorithms: ["RS256"] });
    if (typeof claims.exp !== "number") return null;
    if (typeof claims.sub !== "string" || !USERNAME_RE.test(claims.sub)) return null;
    return claims;
  } catch {
    return null;
  }
}

const userFromToken = (token) => { const c = claimsFromToken(token); return c ? c.sub : null; };
const claimsFromRequest = (req) => claimsFromToken(parseCookies(req.headers.cookie).token);
const userFromRequest = (req) => userFromToken(parseCookies(req.headers.cookie).token);

module.exports = { loadPublicKey, userFromToken, userFromRequest, claimsFromRequest, parseCookies };
