"use strict";
// Fill a session with simulated players (real accounts, real WebSockets), e.g. to try the game
// with friends who aren't there, or to load-test before a presentation:
//   node load.js CODE [count=8] [prefix=bot]
//   node load.js NEW [count]      the first bot hosts a new session, prints its code, and starts it
//                                 once everyone has joined (a full lobby → maze → lobby cycle)
// In the lobby they mill about and, after a while, most walk into a cell (some stay AFK so the
// Watcher has someone to drag). In the maze they wander. They follow the session to the maze and
// back like a browser would. Prints message rates every 5 s. Ctrl+C to stop.
const { account, Player, sleep } = require("./client");

let code = (process.argv[2] || "").toUpperCase();
const hosting = code === "NEW";
const count = Math.max(1, Math.min(60, parseInt(process.argv[3], 10) || 8));
const prefix = (process.argv[4] || "bot").replace(/[^A-Za-z0-9_]/g, "").slice(0, 10) || "bot";
if (!hosting && !/^[A-Z0-9]{5}$/.test(code)) { console.log("usage: node load.js CODE [count] [prefix]"); process.exit(1); }

const SW = (Math.PI * 2) / 10;
let msgs = 0, bytes = 0, joined = 0;
const bots = {};

async function bot(i) {
  const name = `${prefix}${i}`;
  const p = new Player(name, await account(name));
  const afk = Math.random() < 0.2, joinAt = 1 + Math.random() * 13; // seconds into the 20 s to pick a cell
  let stage = "lobby", wander = { x: 0, y: 0, t: 0 };
  const connect = async (first) => { p.last = {}; const h = await p.open(first || { t: "join", code }); if (first) code = h.code; };
  p.handlers.push((m) => {
    msgs++; bytes += JSON.stringify(m).length;
    if (m.t === "go") { stage = m.to.startsWith("/maze") ? "maze" : "lobby"; p.close(); setTimeout(connect, 300 + Math.random() * 700); }
  });
  await connect(hosting && i === 1 ? { t: "host" } : null);
  if (hosting && i === 1) { console.log(`hosting session ${code}`); bots.host = p; }
  joined++;
  setInterval(() => {
    if (stage === "lobby") {
      const s = p.last.L; if (!s) return;
      const me = s.p.find((q) => q[0] === name); if (!me) return;
      const live = s.live.map((v, k) => (v ? k : -1)).filter((k) => k >= 0);
      const gathering = s.ph === "gather" || s.ph === "allin";
      if (gathering && !afk && 20 - s.tl > joinAt && live.length) {
        // head for the emptiest open cell: out to the ring, round it, then in
        const cell = live.reduce((a, b) => (s.occ[b] < s.occ[a] ? b : a));
        const r = Math.hypot(me[1], me[2]), th = Math.atan2(me[2], me[1]);
        let diff = cell * SW - th; while (diff > Math.PI) diff -= 2 * Math.PI; while (diff < -Math.PI) diff += 2 * Math.PI;
        let tr = 470, ta = th + Math.sign(diff) * Math.min(Math.abs(diff), 0.5);
        if (Math.abs(diff) < 0.06 || r > 590) { tr = r > 430 ? 760 : 470; ta = cell * SW; }
        const dx = Math.cos(ta) * tr - me[1], dy = Math.sin(ta) * tr - me[2], d = Math.hypot(dx, dy) || 1;
        p.send({ t: "in", x: d < 15 ? 0 : dx / d, y: d < 15 ? 0 : dy / d });
        return;
      }
      if (Math.random() < 0.01) p.send({ t: "shove" });
    }
    // wander
    if ((wander.t -= 0.1) <= 0) { const a = Math.random() * Math.PI * 2; wander = { x: Math.cos(a), y: Math.sin(a), t: 0.5 + Math.random() * 2 }; if (Math.random() < 0.3) wander.x = wander.y = 0; }
    p.send({ t: "in", x: afk && stage === "lobby" ? 0 : wander.x, y: afk && stage === "lobby" ? 0 : wander.y });
    if (stage === "maze" && Math.random() < 0.05) p.send({ t: "use" });
  }, 100);
}

(async () => {
  if (hosting) { await bot(1); }
  for (let i = hosting ? 2 : 1; i <= count; i++) { bot(i).catch((e) => console.log(`bot ${i}: ${e.message}`)); await sleep(150); }
  if (hosting) {
    while (joined < count) await sleep(200);
    await sleep(1000);
    bots.host.send({ t: "start" });
    console.log(`all ${count} joined; started`);
    let lastPh = "";
    setInterval(() => { const L = bots.host.last.L, M = bots.host.last.board; const ph = L ? L.ph : M ? "maze" : "?"; if (ph !== lastPh) { console.log(`phase: ${ph}${L && L.tc ? ` (${L.tc} cells of up to ${L.cap})` : ""}`); lastPh = ph; } }, 500);
  }
  setInterval(() => { console.log(`${count} bots: ${(msgs / 5).toFixed(0)} msgs/s, ${(bytes / 5 / 1024).toFixed(1)} KB/s received`); msgs = 0; bytes = 0; }, 5000);
})();
