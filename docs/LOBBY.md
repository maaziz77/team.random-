# The lobby simulation (`app/src/lobby.js`)

Exports `{ LobbySim, planLobby }`. One `LobbySim` per session while the session's stage is
`lobby`. Coordinates: the hall's centre is (0, 0), x right, y down, units are pixels at zoom 1
(the frontend draws with exactly these sizes, so they must match).

## The place

- A round **hall** of radius `R = 560` with a **pedestal** (radius 78) in the middle you can't
  stand on, and a **carousel** (radius 340) that spins and carries whoever stands on it.
- **Ten cells** around the outside, one per sector of angle `SW = 2π/10`; cell `s` is centred
  on angle `s·SW`. Between the hall and a cell is a **ring wall** (thickness 36) with a
  **doorway** (half-width 52) in the middle of each sector; doors slide open/shut. A cell is
  250 deep, and cells are separated by walls 26 thick.

## Constants and helpers

```js
const ROOMS = 10, R = 560, WALL = 36, DEPTH = 250, RWALL = 26, DOOR_HALF = 52;
const CAROUSEL_R = 340, PED_R = 78, SW = (Math.PI * 2) / ROOMS, BODY_R = 13;
const ZONE_R = R - BODY_R - 2;  // past this radius you count as in (or stepping into) a cell
const GATHER = 20;              // seconds to pick a cell after the host presses Start
const ALLIN_T = 8.2;            // everyone's in → doors slam after 8.2 s (timed to the music on the client)
const SEAL_T = 2.6;             // doors shut → teams formed after 2.6 s
const MAX_TEAM = 4;
const BOT_AFK = 0.15;           // share of bots that never pick a cell
const SPEED = 205;              // player speed px/s
const CAROUSEL_SPEED = 0.42;    // rad/s
const CELL_COLORS = ["#ffd23f", "#3fa7ff", "#ff6f86", "#43c47a", "#9b6bff", "#ffb000", "#1fae95", "#ff7a3d", "#5b7bff", "#c98b5a"];

const wrap = (a) => { while (a > Math.PI) a -= 2*Math.PI; while (a < -Math.PI) a += 2*Math.PI; return a; };
const polar = (x, y) => [Math.hypot(x, y), Math.atan2(y, x)];
const sectorOf = (th) => ((Math.round(th / SW) % ROOMS) + ROOMS) % ROOMS;
const sectorPhi = (th, s) => wrap(th - s * SW);
const fromPolar = (r, th) => [Math.cos(th) * r, Math.sin(th) * r];
const doorPoint = (s, r) => fromPolar(r, s * SW);
function cellOf(x, y) { const [r, th] = polar(x, y); return r > ZONE_R ? sectorOf(th) : -1; }
// a random standing spot inside cell s
function roomSpot(s) {
  const r = rand(R + WALL + 55, R + WALL + DEPTH - 45);
  const maxPhi = SW / 2 - (RWALL / 2 + BODY_R + 12) / r;
  return fromPolar(r, s * SW + rand(-maxPhi, maxPhi) * 0.85);
}
// teams of up to MAX_TEAM: just enough cells for everyone, each holding an even share
function planLobby(n) {
  const teams = clamp(Math.ceil(n / MAX_TEAM), 1, ROOMS);
  return { teams, cap: Math.ceil(n / teams) };
}
```
(16 players → 4 cells of 4; 10 → 3 cells of up to 4; 5 → 2 cells of up to 3; 1–4 → 1 cell.)

## Phases

`wait` → (host presses Start) → `gather` (20 s) → `allin` (everyone in a cell; 8.2 s) or `mad`
(time's up; the Watcher drags stragglers in) → `seal` (2.6 s) → `done` (teams made).
`allin` falls back to `gather` if anyone steps out.

## State (constructor(session))

```js
session; people = new Map();   // name → person (insertion order = draw order)
doors = 10 × { open: 0, target: 0, live: false, flash: 0 };
phase = "wait"; phaseT = 0; gatherLeft = GATHER; teamCount = 0; cap = MAX_TEAM;
carouselAngle = 0; carouselSpeed = CAROUSEL_SPEED; occ = [10 zeros];
watcher = { x: 0, y: 0, vx: 0, vy: 0, mode: "home", pause: 0, scale: 1, carry: null, dest: null };
events = []; done = false; teams = null;
```

A **person**:
```js
{ p /* the session's player object */, name: p.name, x, y, vx: 0, vy: 0, face: 1,
  stun: 0, shoveT: 0, shoveCd: 0, shoveDir: [1, 0], carried: false,
  // bot brain (docs/BOTS.md)
  goal: -1, wp: null, wpRoom: -1, wanderT: 0, joinAt: rand(3, GATHER * 0.7),
  afk: !!p.bot && Math.random() < BOT_AFK, speed: p.bot ? rand(150, 185) : SPEED }
```

## People

- `addPerson(p)`: ignore if already there. Spawn at a random valid point on the carousel:
  repeat `fromPolar(rand(PED_R + 30, CAROUSEL_R - 24), rand(0, 2π))` until `valid()`. If cells
  are already open (`teamCount && phase !== "wait"`), call `ensureRoom()`.
- `isCarried(name)`.
- `replacePerson(botName, p)`: a real player takes over a bot: if the bot isn't there,
  `addPerson(p)`; else delete it from the map, set `a.p = p, a.name = p.name, a.afk = false,
  a.speed = SPEED` and re-insert under the new name (same position, same cell).
- `removePerson(name)`: if the Watcher carries them, drop that (`carry = dest = null`); delete.

## Geometry

```js
valid(x, y, rad = BODY_R) {
  const [r, th] = polar(x, y);
  if (r < PED_R + rad) return false;
  if (r <= R - rad) return true;                                   // the hall
  const s = sectorOf(th), phi = sectorPhi(th, s);
  if (r < R + WALL + rad) return doors[s].open > 0.55 && Math.abs(phi) * R <= DOOR_HALF - rad * 0.7; // the doorway
  if (r > R + WALL + DEPTH - rad) return false;                     // back wall
  return (SW / 2 - Math.abs(phi)) * r >= RWALL / 2 + rad;           // inside the cell, clear of its side walls
}
// a full or closed cell turns people away; once the Watcher is mad (or sealing), nobody walks out
crossing(a, nx, ny) {
  const from = cellOf(a.x, a.y), to = cellOf(nx, ny);
  if (from === to) return false;
  if (to >= 0 && (!doors[to].live || occ[to] >= cap)) return true;
  return from >= 0 && (phase === "mad" || phase === "seal");
}
moveActor(a, dx, dy) {           // try the full move, then each axis, then slide along the circle
  const ok = (x, y) => valid(x, y) && !crossing(a, x, y);
  if (ok(a.x+dx, a.y+dy)) { move both; return }
  if (ok(a.x+dx, a.y)) { a.x += dx; return }
  if (ok(a.x, a.y+dy)) { a.y += dy; return }
  const [r, th] = polar(a.x, a.y), step = Math.hypot(dx, dy) / Math.max(r, 1);
  for (const s of [1, -1]) { const [tx, ty] = fromPolar(r, th + s*step);
    if ((tx-a.x)*dx + (ty-a.y)*dy > 0 && ok(tx, ty)) { a.x = tx; a.y = ty; return } }
}
countCells(): occ = zeros; each non-carried person with cellOf >= 0 adds 1 to occ[cell]
outsiders(): non-carried people with cellOf < 0
```

## Starting and phases

```js
start() {                                   // host only (checked by the session)
  if (phase !== "wait" || !people.size) return;
  const plan = planLobby(people.size); teamCount = plan.teams; cap = plan.cap;
  // open plan.teams cells spread evenly round the ring, starting at a random one
  const off = randomInt(0..9), set = new Set();
  for (let q = 0; q < plan.teams; q++) set.add((off + Math.round(q * ROOMS / plan.teams)) % ROOMS);
  doors.forEach((d, s) => { d.live = set.has(s); d.target = d.live ? 1 : 0; });
  gatherLeft = GATHER; setPhase("gather");
}
// someone joined late: open another cell (random closed one), or let cells hold one more
ensureRoom() { while (teamCount * cap < people.size) { if a closed cell exists and teamCount < ROOMS: open a random closed one (live, target 1), teamCount++; else cap++ } }
setPhase(ph) {
  phase = ph; phaseT = 0;
  if (ph === "mad") { watcher.mode = "drag"; watcher.pause = 1.1; }
  if (ph === "seal") {
    watcher.mode = "home"; watcher.carry = null; everyone.carried = false;
    every door target = 0;
    // anyone standing in a doorway steps inside before it shuts
    for each person: s = cellOf, [r, th] = polar; if (s >= 0 && r < R + WALL + BODY_R + 4) { put at fromPolar(R + WALL + BODY_R + 6, th); vx = vy = 0 }
  }
  events.push({ t: "ev", e: "phase", ph });
}
drainEvents(): return events and reset to []
```

## Shoving (Space)

```js
shove(a, dx, dy) {
  if (a.shoveCd > 0 || a.stun > 0 || a.carried) return;
  a.shoveDir = normalise(dx, dy); a.shoveT = 0.16; a.shoveCd = 1.1; a.face = dx >= 0 ? 1 : -1;
  hit = [];
  for each other non-carried person o: offset (ox, oy), od = length;
    if (od < 58 && (ox*shoveDir.x + oy*shoveDir.y) / (od || 1) > 0.3) { o.vx = shoveDir.x*560; o.vy = shoveDir.y*560; o.stun = 0.45; hit.push(o.name) }
  events.push({ t: "ev", e: "shove", n: a.name, f: a.face, hit });
}
```

## The Watcher (dragging stragglers)

```js
emptiestCell(): among live cells, the ones with the smallest occ; pick one at random
updateWatcher(dt) {
  if (mode === "home") { x,y lerp toward (0,0) by clamp(dt*2,0,1); scale = lerp(scale, 1, dt*3); return }
  scale = lerp(scale, 1.25, dt*2);
  hold = () => { if (carry) { carry.x = x; carry.y = y + 34 } };
  if (pause > 0) { pause -= dt; hold(); return }
  if (!carry) {
    prey = outsiders(); if none: return;
    best = the nearest prey to (x, y); target = (best.x, best.y - 34);
    if (distance to target < 40) {                          // grab
      carry = best; best.carried = true; best.vx = best.vy = 0; best.stun = 0; best.shoveT = 0;
      s = emptiestCell(); [dx, dy] = roomSpot(s); dest = { x: dx, y: dy, s };
      pause = 0.3; events.push({ t:"ev", e:"grab", n: best.name, cell: s }); hold(); return
    }
  } else {
    target = (dest.x, dest.y - 34);
    if (distance to target < 18) {                          // drop
      a = carry; a.x = dest.x; a.y = dest.y; a.carried = false; a.vx = a.vy = 0; a.stun = 0.5;
      doors[dest.s].flash = 0.8;
      events.push({ t:"ev", e:"drop", n: a.name, cell: dest.s, x: round(a.x), y: round(a.y) });
      carry = null; pause = 0.2; return
    }
  }
  // fly straight there (over walls), faster the more people are left to fetch
  speed = 620 + 70 * Math.min(8, outsiders().length);
  d = distance to target; v = Math.min(speed, d / dt);
  vx = lerp(vx, dirX * v, clamp(dt*6, 0, 1)); vy = lerp(vy, dirY * v, clamp(dt*6, 0, 1));
  x += vx*dt; y += vy*dt; hold();
}
```

## update(dt): one tick

```js
phaseT += dt; countCells();
everyone = [...people.values()];
allIn = everyone.length > 0 && everyone.every(a => !a.carried && cellOf(a.x, a.y) >= 0);
if (phase === "gather") { gatherLeft -= dt; if (allIn) setPhase("allin"); else if (gatherLeft <= 0) setPhase("mad"); }
else if (phase === "allin") { if (!allIn) setPhase("gather"); else if (phaseT >= ALLIN_T) setPhase("seal"); }
else if (phase === "mad") { if (!watcher.carry && !outsiders().length && phaseT > 1.2) setPhase("seal"); }
else if (phase === "seal" && phaseT >= SEAL_T) { finish(); return; }

carouselSpeed = lerp(carouselSpeed, phase === "seal" ? 0 : CAROUSEL_SPEED, clamp(dt*1.5, 0, 1));
carouselAngle = (carouselAngle + carouselSpeed*dt) % (2π);
each door: open = clamp(open + sign(target - open) * dt * (target ? 3 : 7), 0, 1); flash = max(0, flash - dt);

heading = 10 zeros; for each bot person with goal >= 0 that isn't in its goal cell yet: heading[goal]++   (docs/BOTS.md)

for each person a (pl = a.p):
  if (a.carried) { pl.shove = false; continue }
  a.shoveCd -= dt; a.stun -= dt;
  vx = vy = 0;
  if (a.shoveT > 0) { a.shoveT -= dt; v = shoveDir * 430 }
  else if (a.stun > 0) { v = (a.vx, a.vy) }
  else if (phase !== "seal" && pl.bot) v = botVel(a, dt, heading)            // docs/BOTS.md
  else if (phase !== "seal") {
    (ix, iy) = pl.input; l = hypot(ix, iy);
    if (l > 0.01) { v = (ix, iy) / Math.max(1, l) * SPEED; a.lastDir = (ix, iy) / l }
    if (pl.shove) { d = a.lastDir || [a.face, 0]; shove(a, d[0], d[1]) }
  }
  pl.shove = false;
  // the spinning floor carries whoever stands on it
  if (radius(a) < CAROUSEL_R && carouselSpeed > 0.01) { vx += -a.y * carouselSpeed; vy += a.x * carouselSpeed }
  if (a.stun > 0) { a.vx *= 1 - dt*5; a.vy *= 1 - dt*5 }
  else { a.vx = lerp(a.vx, vx, clamp(dt*14,0,1)); a.vy = lerp(a.vy, vy, clamp(dt*14,0,1)) }
  moveActor(a, a.vx*dt, a.vy*dt);
  if (Math.abs(a.vx) > 20) a.face = a.vx > 0 ? 1 : -1;

// personal space: push overlapping pairs apart (never through a full cell's door)
for each pair (a, b), neither carried: d = distance; m = 2*BODY_R;
  if (d < m && d > 0.01) { p = (m-d)/2; u = unit vector a→b;
    if (valid(a - u*p) && !crossing(a, a - u*p)) a -= u*p;
    if (valid(b + u*p) && !crossing(b, b + u*p)) b += u*p; }

updateWatcher(dt);
```

## finish(): every cell with people becomes a team

```js
countCells(); teams = [];
for each live cell s (in index order): members = names of people with cellOf === s; if any:
  teams.push({ id: teams.length, cell: s, name: `Cell ${s + 1}`, color: CELL_COLORS[s], members });
anyone not placed: add to the team with the fewest members (if there are no teams, make
  { id: 0, cell: 0, name: "Cell 1", color: CELL_COLORS[0], members: [] } first);
this.teams = teams with members, re-numbered id = index; done = true; phase = "done";
```

## snapshot(): the `L` message (docs/PROTOCOL.md)

```js
{ t: "L", ph: phase, tl: Math.max(0, round1(gatherLeft)), pt: round1(phaseT),
  ca: round3(carouselAngle), cs: round2(carouselSpeed), cap, tc: teamCount,
  live: doors.map(d => d.live ? 1 : 0), occ, dr: doors.map(d => Math.round(d.open * 100)),
  fl: doors.map(d => Math.round(d.flash * 10)),
  w: [round(watcher.x), round(watcher.y), watcher.mode === "drag" ? 1 : 0, Math.round(watcher.scale * 100), watcher.carry ? watcher.carry.name : null],
  p: [...people.values()].map(a => [a.name, round(a.x), round(a.y), (a.carried ? 1 : 0) | (a.stun > 0 ? 2 : 0), a.face]) }
```
(`round1(v) = Math.round(v*10)/10`, etc.)
