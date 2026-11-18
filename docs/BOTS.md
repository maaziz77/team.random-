# Bots

Bots are players the server controls. The host adds them in the lobby (`{t:"bots", add}`) to
test alone or make up numbers. They are ordinary entries in `session.players` with
`bot: true`, no socket, a name like `Bot-Ada` (a `-` can't appear in a real username), a shirt
number and a look. A real player who joins a session that has bots **takes a bot's place**
(docs/SESSIONS.md → `replaceBot`). They are never AFK-removed and never keep a session alive.

## In the lobby (`LobbySim`)

Each bot person has `goal` (the cell it's heading for, −1 none), `wp`/`wpRoom` (a waypoint and
which cell it belongs to, −1 = the hall), `wanderT`, `joinAt` (seconds into `gather` when it
starts heading for a cell), `afk` (15% of bots never pick a cell, so the Watcher has someone to
drag), `speed` (150–185).

```js
steerTo(a, tx, ty, speed):        // unit vector to the target, pushed away from the pedestal
  (dx, dy) = normalise(target - a); r = radius(a);
  if (r < PED_R + 70) { dx += a.x / r * 0.9; dy += a.y / r * 0.9 }
  return [unit(dx, dy) * speed, distance]            // [vx, vy, d]
wanderVel(a, dt, mul = 1):
  a.wanderT -= dt;
  if (!a.wp || a.wpRoom !== -1 || a.wanderT <= 0) { a.wanderT = rand(1.5, 4); a.wp = fromPolar(rand(PED_R + 50, R - 60), rand(0, 2π)); a.wpRoom = -1 }
  [vx, vy, d] = steerTo(a, a.wp, a.speed * 0.55 * mul); return d < 14 ? [0, 0] : [vx, vy]
roomOf(a): radius > R + WALL*0.5 ? sectorOf(angle) : -1
navToRoom(a, s):
  here = roomOf(a);
  if (here === s) { if (!a.wp || a.wpRoom !== s) { a.wp = roomSpot(s); a.wpRoom = s }  [vx,vy,d] = steerTo(a, a.wp, a.speed); return d < 10 ? [0,0] : [vx,vy] }
  if (here >= 0) return steerTo(a, doorPoint(here, R - 40), a.speed)          // leave the wrong cell first
  o = doorPoint(s, R - 34);
  if (distance(a, o) < 36 || radius(a) > R - 40) return steerTo(a, doorPoint(s, R + WALL + 60), a.speed)   // go through
  return steerTo(a, o, a.speed)                                                // go to the doorway
chooseCell(a, heading):            // a live cell with room (counting bots on their way), biased to near ones
  best = -1; for each live cell s with occ[s] + heading[s] < cap: score = distance(a, doorPoint(s, R)) + rand(0, 420); keep the lowest; return best
botVel(a, dt, heading):
  if (phase === "wait") return wanderVel(a, dt, 0.8);
  here = cellOf(a.x, a.y);
  if (here >= 0) { a.goal = here; return navToRoom(a, here) }          // in a cell: settle in, stay
  if (a.afk) return phase === "mad" ? [0, 0] : wanderVel(a, dt, 0.35);
  if (GATHER - gatherLeft < a.joinAt && phase === "gather") return wanderVel(a, dt, 1);
  if (a.goal < 0 || occ[a.goal] >= cap) {
    if (a.goal >= 0) heading[a.goal]--;
    a.goal = chooseCell(a, heading); a.wp = null;
    if (a.goal >= 0) heading[a.goal]++;
  }
  return a.goal >= 0 ? navToRoom(a, a.goal) : wanderVel(a, dt, 1)
```
`heading` is rebuilt every tick in `update()` (docs/LOBBY.md). Bots never shove.

## In the maze (`TeamSim`)

Bots go to **their own station** (the one `owners(g)` assigns them), wait there, and act when
someone else's light goes green (a short human-like reaction delay), so a team with a real
player follows that player's lead. If **no** station on the circuit belongs to a real player,
one bot counts the others in once they're all ready. Bots flee the Watcher and thaw frozen
teammates. All movement uses `k.navigate` (A* + steering) from the shared module.

```js
think(dt):                          // every 0.3 s: hand out jobs
  thinkT -= dt; if (thinkT > 0) return; thinkT = 0.3;
  monsterField = monster.x > -1000 ? k.bfs(...k.cellOf(monster), true) : null;
  bots = online, unfrozen bot members; if none return;
  if (L.transit) { each bot without a "down" task: task = { kind: "down", spot: OFFS[members.indexOf(b) % 8] }; return }
  g = frontierGate(); own = g ? owners(g) : [];
  free = set of bots with fleeT <= 0;
  // rescue first: for each online frozen member f that is safe to reach
  //   (dist(monster, f) > 330 or monster mode is "leave" or "sleep"):
  //   the nearest free bot (a bot already reviving f counts as 600 px nearer) gets { kind: "revive", who: f }
  //   (keep its existing task object if it was already reviving f); remove it from free
  // then every free bot that owns a station of g gets { kind: "plate", plate: thatStation } (keep the existing
  //   task object if it's the same station); remove it from free
  // everyone left in free without a "follow" task: { kind: "follow" }
  // count-in: if g exists, isn't open and isn't sparking:
  //   humanOwner = some owner name belongs to a non-bot member
  //   holders = for each station, the bot whose task is that station's plate task
  //   ready = !humanOwner && every holder exists with task.stage === "ready" && every station has power <= 0 or auto
  //   g.count = ready ? (g.count || 0) + 0.3 : 0;  if (g.count > 0.9) { holders[0].task.go = true; g.count = 0 }

updateBot(b, dt):
  if (b.frozen) { b.moving = false; return }
  md = dist(b, monster); awake = mode not "sleep"/"leave";
  threat = awake && b.inv <= 0 && ((mode === "hunt" && monster.target === b && md < 450) || md < 240);
  if (threat && b.fleeT <= 0) { b.react += dt; if (b.react > 0.22) { b.fleeT = 1.6; b.fleeGoal = null; b.react = 0; b.path = null } }
  else if (!threat) b.react = 0;
  if (b.fleeT > 0) {
    b.fleeT -= dt;
    if (!b.fleeGoal || Math.random() < dt * 2.5) b.fleeGoal = fleeCell(b);
    if (b.fleeGoal) k.navigate(b, k.ccx(b.fleeGoal[0]), k.ccx(b.fleeGoal[1]), b.speed, dt);
    if (threat && b.fleeT < 0.3) b.fleeT = 0.6;
    return
  }
  t = b.task || { kind: "follow" };
  plate  → plateBot(b, t, dt)
  down   → e = L.floors[L.cur + 1].entry; k.navigate(b, k.ccx(e[0]) + t.spot[0], k.ccx(e[1]) + t.spot[1], b.speed, dt, false, 10)
  revive → k.navigate(b, t.who.x + (b.x < t.who.x ? -30 : 30), t.who.y + 4, b.speed, dt, false, 10)
  follow → lead = the nearest online, unfrozen non-bot member; g = frontierGate();
           goal = lead ? (lead.x, lead.y) : g ? (k.ccx(g.i), k.ccx(g.j) - 40) : (b.x, b.y);
           if (distance > 150 || !k.lineOfSight(b, goal)) k.navigate(b, goal, b.speed, dt, false, 110) else b.moving = false

plateBot(b, t, dt):                 // stages: goto → ready → press → (plates: back →) ready
  p = t.plate; g = L.gates[p.gate];
  if (!t.stage) t.stage = "goto";
  if (t.stage === "press") {
    if (p.kind === "lever") { pullLever(p, b); t.stage = "ready"; return }
    k.navigate(b, p.x, p.y, b.speed, dt, false, 6); if (p.occ === b) t.stage = "back"; return
  }
  if (t.stage === "back") { if (k.navigate(b, p.rx, p.ry, b.speed, dt, false, 8)) t.stage = "ready"; return }
  if (k.navigate(b, p.rx, p.ry, b.speed, dt, false, 12)) t.stage = "ready";
  else if (distance(b, (p.rx, p.ry)) > 40) t.stage = "goto";
  if (t.stage !== "ready") return;
  b.face = (p.kind === "lever" ? p.px : p.x) >= b.x ? 1 : -1;
  if (g.open || g.spark > 0) return;
  othersLive = some other station of g that isn't auto has power > 0.04;
  if ((othersLive && p.power <= 0) || t.go) {
    t.wait = (t.wait === undefined ? rand(0.15, 0.55) : t.wait) - dt;
    if (t.wait <= 0) { t.stage = "press"; t.wait = undefined; t.go = false }
  } else t.wait = undefined

fleeCell(b):                        // the reachable cell within 5 steps that is furthest (in steps) from the Watcher
  if (!monsterField) return null;
  mine = k.bfs(...k.cellOf(b), false); best = null;
  for each cell q with 0 <= mine[q] <= 5: md = monsterField[q] < 0 ? 30 : monsterField[q]; score = md*3 - mine[q] + Math.random(); keep the highest
  return [q % L.COLS, (q / L.COLS) | 0]
```
(`k.navigate` returns true when it has arrived within `stop` px; it sets `moving`, `face`,
`path`, `stuck` on the object you pass, which is why members carry those fields.)
