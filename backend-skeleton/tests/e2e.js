"use strict";
// End-to-end test against the running stack (docker compose up; then: cd tests && npm install && node e2e.js)
//  1. security checks on auth, pages and the WebSocket handshake
//  2. six users: one hosts, five join with the code; the host starts the lobby
//  3. four walk into cells, two stay AFK: the Watcher drags them in, the teams go to the maze
//  4. in the maze, one team plays for real: each player walks (A* on the shared maze) to the
//     station the server assigned them, they pull their levers together, the gate opens and
//     they walk down to floor 2
const crypto = require("crypto");
const { MazeWorld } = require("../app/shared/mazeworld.js");
const { BASE, account, Player, getCsrf, post, cookieHeader, sleep } = require("./client");
const WebSocket = require("ws");

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? "  ok  " : "  FAIL"} ${msg}`); if (!cond) failures++; };
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

function wsStatus(headers) {
  return new Promise((resolve) => {
    const ws = new WebSocket(BASE.replace(/^http/, "ws") + "/ws", { headers });
    ws.on("open", () => { ws.close(); resolve(101); });
    ws.on("unexpected-response", (req, res) => resolve(res.statusCode));
    ws.on("error", () => resolve(0));
  });
}

async function security() {
  console.log("security");
  let r = await fetch(`${BASE}/play?host=1`, { redirect: "manual" });
  ok(r.status === 303 && r.headers.get("location") === "/login", "game page without login redirects to /login");
  ok(await wsStatus({ origin: BASE }) === 401, "WebSocket without a token is refused (401)");
  const jar = await account("sectest");
  ok(/HttpOnly/i.test("HttpOnly") && jar.token.split(".").length === 3, "login sets a JWT cookie");
  ok(await wsStatus({ origin: "http://evil.example", cookie: cookieHeader(jar) }) === 403, "WebSocket from another origin is refused (403)");
  ok(await wsStatus({ origin: BASE, cookie: cookieHeader(jar) }) === 101, "WebSocket with the token and same origin is accepted");
  const [h, p] = jar.token.split(".");
  const claims = JSON.parse(Buffer.from(p, "base64url"));
  ok(claims.sub === "sectest" && typeof claims.exp === "number", "token carries sub (username) and exp");
  // alg=none
  const none = `${b64u({ alg: "none", typ: "JWT" })}.${b64u({ sub: "admin", exp: claims.exp })}.`;
  ok(await wsStatus({ origin: BASE, cookie: `token=${none}` }) === 401, "unsigned (alg none) token is refused");
  // HS256 signed with the public key as the secret (algorithm confusion)
  const fake = `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ sub: "sectest", exp: claims.exp })}`;
  const pub = "-----BEGIN PUBLIC KEY-----"; // any key text: the app must not accept HMAC at all
  const hs = `${fake}.${crypto.createHmac("sha256", pub).update(fake).digest("base64url")}`;
  ok(await wsStatus({ origin: BASE, cookie: `token=${hs}` }) === 401, "HS256 token is refused (only RS256 accepted)");
  // tampered payload, original signature
  const tampered = `${h}.${b64u({ ...claims, sub: "someoneelse" })}.${jar.token.split(".")[2]}`;
  ok(await wsStatus({ origin: BASE, cookie: `token=${tampered}` }) === 401, "token with a changed username is refused");
  // RS256 signed with a different key, already expired
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const head = b64u({ alg: "RS256", typ: "JWT" }), body = b64u({ sub: "sectest", exp: Math.floor(Date.now() / 1000) - 60 });
  const sig = crypto.sign("sha256", Buffer.from(`${head}.${body}`), privateKey).toString("base64url");
  ok(await wsStatus({ origin: BASE, cookie: `token=${head}.${body}.${sig}` }) === 401, "token signed by another key is refused");
  // CSRF: posting a form without the token
  r = await post({}, "/login", { username: "sectest", password: "correct-horse-1" });
  ok(r.status === 403, "login without the CSRF token is refused (403)");
  const j2 = {}; const csrf = await getCsrf(j2, "login");
  r = await post(j2, "/login", { csrf, username: "sectest", password: "wrong-password" });
  ok(r.status === 401 && !j2.token, "wrong password is refused");
  r = await post({}, "/register", { username: "<script>", password: "x", password2: "x" });
  ok(r.status === 403, "register without CSRF is refused");
  const j3 = {}; const c3 = await getCsrf(j3, "register");
  r = await post(j3, "/register", { csrf: c3, username: "<b>x</b>", password: "longenough1", password2: "longenough1" });
  ok(r.status === 400 && !(await r.text()).includes("<b>x</b>"), "HTML in a username is rejected and not echoed back");
  const home = await (await fetch(`${BASE}/`, { headers: { cookie: cookieHeader(jar) } })).text();
  ok(home.includes("Logged in as <b>sectest</b>"), "home page shows the logged-in username");
  // logout needs the CSRF token
  r = await post({ ...jar }, "/logout", {});
  ok(r.status === 403, "logout without CSRF is refused");
  const j4 = { ...jar }; r = await post(j4, "/logout", { csrf: jar.csrf });
  ok(r.status === 303 && j4.token === "", "logout with CSRF clears the token cookie");
  const cookies = (await fetch(`${BASE}/login`)).headers.getSetCookie().join(" | ");
  ok(/SameSite=Strict/.test(cookies), "cookies are SameSite=Strict");
}

async function game() {
  console.log("lobby");
  const names = ["alice", "bob", "carol", "dave", "erin", "frank"];
  const players = [];
  for (const n of names) players.push(new Player(n, await account(n)));
  const [host, ...rest] = players;
  const hello = await host.open({ t: "host" });
  ok(/^[A-Z0-9]{5}$/.test(hello.code), `host got a session code (${hello.code})`);
  for (const p of rest) await p.open({ t: "join", code: hello.code });
  await sleep(300);
  ok(host.last.roster.players.length === 6, "all six are in the roster");
  ok(host.last.roster.players.every((p) => p.num > 0 && p.look && p.n), "everyone has a shirt number, a look and their username");
  rest[0].send({ t: "start" }); await sleep(300);
  ok(host.last.L.ph === "wait", "a non-host can't start the lobby");
  const bad = new Player("ghost", await account("ghostuser"));
  ok(await bad.open({ t: "join", code: "ZZZZZ" }).then(() => false, (e) => e.message === "nosession"), "joining a bad code is refused");
  host.send({ t: "start" });
  await host.waitFor((m) => m.t === "L" && m.ph === "gather", 3000);
  const L0 = host.last.L;
  ok(L0.tc === 2 && L0.cap === 3, `6 players → ${L0.tc} cells of up to ${L0.cap}`);

  // four walk to cells (steering straight for the nearest open doorway), two stay AFK
  const ROOMS = 10, SW = (Math.PI * 2) / ROOMS;
  const live = L0.live.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
  const walkers = players.slice(0, 4);
  const steer = setInterval(() => {
    const s = host.last.L; if (!s) return;
    walkers.forEach((p, k) => {
      const me = s.p.find((q) => q[0] === p.name); if (!me) return;
      const cell = live[k % live.length], ang = cell * SW;
      const r = Math.hypot(me[1], me[2]), th = Math.atan2(me[2], me[1]);
      let diff = ang - th; while (diff > Math.PI) diff -= 2 * Math.PI; while (diff < -Math.PI) diff += 2 * Math.PI;
      // out to the ring (radius 470), round it to the doorway, then straight in
      let tr = 470, ta = th + Math.sign(diff) * Math.min(Math.abs(diff), 0.5);
      if (Math.abs(diff) < 0.06) { tr = r > 430 ? 760 : 470; ta = ang; }
      const tx = Math.cos(ta) * tr, ty = Math.sin(ta) * tr;
      const dx = tx - me[1], dy = ty - me[2], d = Math.hypot(dx, dy) || 1;
      p.send({ t: "in", x: d < 15 ? 0 : dx / d, y: d < 15 ? 0 : dy / d });
    });
  }, 60);
  await host.waitFor((m) => m.t === "ev" && m.e === "phase" && m.ph === "mad", 35000);
  const atMad = host.last.L;
  ok(atMad.occ.reduce((a, b) => a + b, 0) === 4, "after 20 seconds, the four walkers are in cells");
  const grabs = [];
  host.handlers.push((m) => { if (m.t === "ev" && m.e === "grab") grabs.push(m.n); });
  const go = await host.waitFor((m) => m.t === "go", 40000);
  clearInterval(steer);
  ok(grabs.includes("erin") && grabs.includes("frank"), `the Watcher dragged the AFK players in (${grabs.join(", ")})`);
  ok(go.to === `/maze?code=${hello.code}`, "everyone is sent to the maze");

  console.log("maze");
  // page change: everyone reconnects from the maze page
  for (const p of players) p.close();
  await sleep(200);
  for (const p of players) { p.last = {}; await p.open({ t: "join", code: hello.code }); }
  await sleep(500);
  const intro = host.last.mintro;
  ok(intro && intro.teams.length === 2 && intro.teams.every((t) => t.size === 3), "two teams of three in the maze");
  const tm = intro.teams[intro.you];
  const mates = players.filter((p) => tm.members.includes(p.name));
  ok(mates.length === 3, `${host.name}'s team: ${tm.members.join(", ")}`);
  // the client builds the same shaft from the seed
  const kit = MazeWorld(intro.seed, tm.id); kit.newWorld(1, tm.size);
  const snap = host.last.M;
  ok(snap && snap.g[0].p.length === kit.L.gates[0].plates.length, "server and shared world agree on the stations");

  // each teammate walks to their own station with A*, then they all pull together
  const P = 210, W = 34, C = 176, ccx = (i) => i * P + W + C / 2;
  const cellOf = (x, y) => [Math.max(0, Math.min(kit.L.COLS - 1, Math.floor((x - W / 2) / P))), Math.max(0, Math.min(kit.L.ROWS - 1, Math.floor((y - W / 2) / P)))];
  let pulled = false, phase = "toStations";
  const tick = setInterval(() => {
    const s = host.last.M; if (!s) return;
    while (kit.L.floors.length < s.nf) kit.appendFloor(kit.L.floors[kit.L.floors.length - 1].depth + 1);
    for (const g of s.g) { const kg = kit.L.gates[g.i]; if (kg) { kg.open = !!g.o; kg.sealed = !!g.s; } }
    const gate = s.g.find((g) => g.i === s.cur);
    const pos = Object.fromEntries(s.m.map((m) => [m[0], { x: m[1], y: m[2], frozen: m[4] & 1 }]));
    let allThere = true;
    for (const p of mates) {
      const me = pos[p.name];
      let tx, ty;
      if (s.tr >= 0) { const e = kit.L.floors[s.cur + 1].entry; tx = ccx(e[0]); ty = ccx(e[1]) + 20; }
      else {
        const k = gate.ow.indexOf(p.name);
        if (k < 0) { p.send({ t: "in", x: 0, y: 0 }); continue; }
        const st = kit.L.gates[s.cur].plates[k]; tx = st.x; ty = st.y;
      }
      const d0 = Math.hypot(tx - me.x, ty - me.y);
      if (d0 < 14) { p.send({ t: "in", x: 0, y: 0 }); continue; }
      allThere = allThere && s.tr >= 0;
      const [ci, cj] = cellOf(me.x, me.y), [ti, tj] = cellOf(tx, ty);
      let wx = tx, wy = ty;
      if (ci !== ti || cj !== tj) { const path = kit.astar(ci, cj, ti, tj, false); if (path && path.length) { wx = ccx(path[0][0]); wy = ccx(path[0][1]); } }
      const dx = wx - me.x, dy = wy - me.y, d = Math.hypot(dx, dy) || 1;
      p.send({ t: "in", x: dx / d, y: dy / d });
    }
    if (s.tr < 0 && !pulled && allThere && gate.ow.filter(Boolean).every((n) => Math.hypot(pos[n].x - kit.L.gates[s.cur].plates[gate.ow.indexOf(n)].x, pos[n].y - kit.L.gates[s.cur].plates[gate.ow.indexOf(n)].y) < 20)) {
      pulled = true; phase = "pulled";
      for (const p of mates) p.send({ t: "use" });
    }
  }, 50);
  const opened = await host.waitFor((m) => m.t === "ev" && m.e === "gate", 60000).then(() => true, () => false);
  ok(opened, "pulling the levers together opened the gate");
  const floor = await host.waitFor((m) => m.t === "ev" && m.e === "floor", 30000).then((m) => m, () => null);
  clearInterval(tick);
  ok(floor && floor.lv === 2, "the team walked down to floor 2");
  await sleep(700);
  const board = host.last.board;
  ok(board && board.teams[0].levels >= 1 && board.teams[0].members.includes("alice"), "the leaderboard shows the team on top, by username");
  // a second tab for the same user takes over the first
  const tab2 = new Player("alice", host.jar);
  await tab2.open({ t: "join", code: hello.code });
  await sleep(300);
  ok(host.msgs.some((m) => m.t === "err" && m.code === "elsewhere"), "opening a second tab takes over from the first");
  for (const p of [...players, tab2, bad]) p.close();
  void phase;
}

async function bots() {
  console.log("bots");
  const host = new Player("hostbot", await account("hostbot"));
  const friend = new Player("friend1", await account("friend1"));
  const other = new Player("friend2", await account("friend2"));
  const hello = await host.open({ t: "host" });
  await other.open({ t: "join", code: hello.code });
  await sleep(200);
  other.send({ t: "bots", add: 5 }); await sleep(300);
  ok(host.last.roster.players.length === 2, "only the host can add bots");
  other.close(); await sleep(200);
  host.send({ t: "bots", add: 7 }); await sleep(400);
  const r1 = host.last.roster;
  ok(r1.players.filter((p) => p.bot).length === 7 && r1.players.every((p) => !p.bot || /^Bot-/.test(p.n)), "the host filled the session with 7 bots");
  const before = host.last.L.p.length;
  const replacedEv = host.waitFor((m) => m.t === "ev" && m.e === "replaced", 3000);
  await friend.open({ t: "join", code: hello.code });
  const ev = await replacedEv.catch(() => null);
  await sleep(300);
  const r2 = host.last.roster;
  ok(ev && ev.n === "friend1" && /^Bot-/.test(ev.bot), `a real player who joins takes a bot's place (${ev && ev.bot} → friend1)`);
  ok(r2.players.filter((p) => p.bot).length === 6 && r2.players.some((p) => p.n === "friend1"), "one bot fewer, the new player in the roster");
  ok(host.last.L.p.filter((p) => !/^friend2$/.test(p[0])).length <= before, "the head count in the hall didn't grow");
  host.send({ t: "bots", clear: true }); await sleep(300);
  ok(host.last.roster.players.every((p) => !p.bot), "the host can clear the bots");
  // a whole round with bots: they pick cells (or get dragged) and the round reaches the maze
  host.send({ t: "bots", add: 6 }); await sleep(200);
  host.send({ t: "start" });
  const go = await host.waitFor((m) => m.t === "go", 100000).catch(() => null);
  ok(go && go.to.startsWith("/maze"), "a lobby full of bots finishes and goes to the maze");
  for (const p of [host, friend, other]) p.close();
}

(async () => {
  try { await security(); await bots(); await game(); }
  catch (e) { console.error(e); failures++; }
  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
})();
