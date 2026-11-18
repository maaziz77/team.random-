"use strict";
// Test helpers: register / log in through the real HTTP endpoints (with the CSRF token),
// then open the game WebSocket with the login cookie, exactly like a browser would.
// Used by tests/e2e.js and tests/load.js. Needs `ws` (cd tests && npm install).
const WebSocket = require("ws");
const BASE = process.env.BASE || "http://localhost:8080";

function cookiesFrom(res, jar) {
  for (const c of res.headers.getSetCookie ? res.headers.getSetCookie() : []) {
    const [kv] = c.split(";"); const i = kv.indexOf("=");
    jar[kv.slice(0, i)] = kv.slice(i + 1);
  }
}
const cookieHeader = (jar) => Object.entries(jar).filter(([, v]) => v !== "").map(([k, v]) => `${k}=${v}`).join("; ");

async function getCsrf(jar, page) {
  const r = await fetch(`${BASE}/${page}`, { headers: { cookie: cookieHeader(jar) }, redirect: "manual" });
  cookiesFrom(r, jar);
  const html = await r.text();
  const m = html.match(/name="csrf" value="([^"]+)"/);
  return m ? m[1] : null;
}
async function post(jar, path, fields) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST", redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader(jar) },
    body: new URLSearchParams(fields).toString(),
  });
  cookiesFrom(r, jar);
  return r;
}
// register (or log in if the name exists); returns the cookie jar
async function account(username, password = "correct-horse-1") {
  const jar = {};
  let csrf = await getCsrf(jar, "register");
  let r = await post(jar, "/register", { csrf, username, password, password2: password });
  if (r.status === 409) {
    csrf = await getCsrf(jar, "login");
    r = await post(jar, "/login", { csrf, username, password });
  }
  if (!jar.token) throw new Error(`no token for ${username} (HTTP ${r.status})`);
  return jar;
}

class Player {
  constructor(name, jar) { this.name = name; this.jar = jar; this.msgs = []; this.last = {}; this.handlers = []; }
  open(first) {
    return new Promise((resolve, reject) => {
      const url = BASE.replace(/^http/, "ws") + "/ws";
      this.ws = new WebSocket(url, { headers: { cookie: cookieHeader(this.jar), origin: BASE } });
      this.ws.on("open", () => { this.ws.send(JSON.stringify(first)); });
      this.ws.on("message", (d) => {
        const m = JSON.parse(d.toString());
        this.last[m.t] = m;
        if (m.t === "ev" || m.t === "hello" || m.t === "go" || m.t === "err" || m.t === "mintro" || m.t === "over") this.msgs.push(m);
        if (m.t === "hello") resolve(m);
        if (m.t === "err") reject(new Error(m.code));
        for (const h of this.handlers) h(m);
      });
      this.ws.on("unexpected-response", (req, res) => reject(new Error(`handshake ${res.statusCode}`)));
      this.ws.on("error", reject);
    });
  }
  send(m) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  close() { try { this.ws.close(); } catch { /* */ } }
  waitFor(pred, ms = 10000) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timeout waiting (${this.name})`)), ms);
      const h = (m) => { if (pred(m)) { clearTimeout(t); this.handlers = this.handlers.filter((x) => x !== h); resolve(m); } };
      this.handlers.push(h);
    });
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
module.exports = { BASE, account, Player, getCsrf, post, cookieHeader, sleep };
