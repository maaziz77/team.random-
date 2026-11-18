"use strict";
// The game's WebSocket. ws:// locally, wss:// when the page is served over HTTPS.
// The browser sends its login cookie with the handshake; the server checks the JWT there and
// takes the username from it, so nothing here ever says who we are.
const Net = (() => {
  const handlers = {};
  let ws = null, first = null, closedForGood = false, tries = 0, outbox = [];

  function on(type, fn) { handlers[type] = fn; }
  function send(msg) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
  }
  function connect(hello) {
    first = hello;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => { tries = 0; send(first); for (const m of outbox) send(m); outbox = []; };
    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === "hello" && m.code) first = { t: "join", code: m.code }; // reconnects rejoin, never re-host
      if (m.t === "err") {
        closedForGood = true;
        if (m.code === "nosession") { location.replace("/?err=nosession"); return; }
        if (m.code === "full") { location.replace("/?err=full"); return; }
      }
      if (m.t === "go") { closedForGood = true; location.replace(m.to); return; }
      const h = handlers[m.t]; if (h) h(m);
    };
    ws.onclose = (e) => {
      if (closedForGood || e.code === 4000) { if (handlers.lost) handlers.lost(e.code === 4000 ? "elsewhere" : "closed"); return; }
      // dropped: check we're still logged in, then try again
      fetch("/me", { credentials: "same-origin" }).then((r) => {
        if (r.status === 401) { location.replace("/login?expired=1"); return; }
        if (handlers.lost) handlers.lost("retry");
        setTimeout(() => connect(first), Math.min(4000, 400 * ++tries));
      }).catch(() => setTimeout(() => connect(first), 1500));
    };
  }
  // the first message for this page: host a new session or join one by code
  function start() {
    const q = new URLSearchParams(location.search);
    const code = (q.get("code") || "").toUpperCase();
    if (code) connect({ t: "join", code });
    else if (q.get("host")) connect({ t: "host" });
    else location.replace("/");
  }
  return { on, send, connect, start };
})();

// keyboard → movement intent, sent when it changes (and every 250 ms as a keep-alive)
const Input = (() => {
  const keys = new Set();
  let last = "", lastT = 0;
  addEventListener("keydown", (e) => {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
    keys.add(e.code);
    if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
  });
  addEventListener("keyup", (e) => keys.delete(e.code));
  addEventListener("blur", () => keys.clear());
  function axis() {
    let x = 0, y = 0;
    if (keys.has("KeyA") || keys.has("ArrowLeft")) x -= 1;
    if (keys.has("KeyD") || keys.has("ArrowRight")) x += 1;
    if (keys.has("KeyW") || keys.has("ArrowUp")) y -= 1;
    if (keys.has("KeyS") || keys.has("ArrowDown")) y += 1;
    return { x, y };
  }
  function tick(now) {
    const a = axis(), s = `${a.x},${a.y}`;
    if (s !== last || now - lastT > 250) { Net.send({ t: "in", x: a.x, y: a.y }); last = s; lastT = now; }
  }
  return { keys, axis, tick };
})();

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Start screens (class "fit") scale themselves down to fit the window, so the button is always
// on screen without scrolling, whatever the window size or the number of cards.
const Fit = (() => {
  function fitAll() {
    for (const scr of document.querySelectorAll(".screen.fit")) {
      const inner = scr.querySelector(".fit-inner");
      if (!inner || scr.classList.contains("hidden")) continue;
      inner.style.transform = ""; inner.style.marginBottom = ""; inner.style.marginTop = "";
      const cs = getComputedStyle(scr);
      const availH = scr.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - 12;
      const availW = scr.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const h = inner.scrollHeight, w = inner.scrollWidth;
      const s = Math.min(1, availH / h, availW / w);
      // scale from the top, give back the space it no longer uses, and centre what's left
      if (s < 1) { inner.style.transform = `scale(${s})`; inner.style.marginBottom = `${-(1 - s) * h}px`; }
      inner.style.marginTop = `${Math.max(0, (availH - h * s) / 2) + 6}px`;
    }
  }
  addEventListener("resize", fitAll);
  addEventListener("load", fitAll);
  document.fonts && document.fonts.ready.then(fitAll);
  // refit when the content changes (team cards arriving, text filled in)
  const mo = new MutationObserver(() => requestAnimationFrame(fitAll));
  addEventListener("DOMContentLoaded", () => { for (const el of document.querySelectorAll(".screen.fit .fit-inner")) mo.observe(el, { childList: true, subtree: true, characterData: true }); fitAll(); });
  return { fitAll };
})();
