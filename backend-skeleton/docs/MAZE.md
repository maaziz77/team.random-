# The maze simulation (`app/src/maze.js`)

Exports `{ MazeMatch, MATCH_SECONDS }`. One `MazeMatch` per session while its stage is `maze`
or `results`; it owns one `TeamSim` per team. Each team plays its **own endless shaft** generated
by the provided `app/shared/mazeworld.js` (read app/shared/README.md first). Teams don't meet
each other; the leaderboard compares them.

```js
const { MazeWorld, C, W, P, BODY_R } = require("../shared/mazeworld");
const MON_R = 20;          // the Watcher's collision radius
const THAW_TIME = 2.0;     // seconds of company to thaw someone
const WALK_TIME = 10;      // seconds to walk down through an open gate before stragglers are teleported
const MATCH_SECONDS = 300; // default (the session's matchMinutes overrides it)
const PLAYER_SPEED = 215;
const OFFS = [[-30,-30],[30,-30],[-30,30],[30,30],[0,-48],[0,48],[-56,0],[56,0]]; // spawn offsets by member index
const MODES = { sleep: 0, patrol: 1, search: 2, hunt: 3, leave: 4 };
```

## How a floor works (game rules)

- Each floor's **gate** (a doorway in its bottom wall) is the only way down. It opens when every
  **station** on the floor is lit at the same moment: **levers** on odd floors (press E next to
  one), **pressure plates** on even floors (step onto it). A lit station stays lit for the
  floor's `window` seconds, then goes dark. A lever can only be pulled when dark; a plate re-arms
  only after everyone steps off.
- Station *n* belongs to the *n*-th **online** member of the team (that's the arrow each client
  shows). Stations with no owner (fewer online players than stations) hold themselves lit
  (`auto`), so a team never gets stuck. Anyone may pull any lever.
- When all are lit, the gate "sparks" for 0.8 s, then opens. The Watcher vanishes from that
  floor, frozen players thaw, and the team has **10 s** (`WALK_TIME`) to walk down past the gate;
  stragglers are teleported. The next floor starts only when every online member is fully
  through, and only then is the gate behind them sealed (so nobody is ever shut in the doorway).
- The **Watcher** wakes 6 s after the team arrives (none on floor 1), patrols, investigates
  noises (levers, plates, gates), hunts anyone it can see, freezes whoever it touches, then
  backs off for 5 s. A frozen player thaws after 2 s with a teammate next to them. If every
  online member is frozen: 5 s penalty, then everyone restarts at the top of the floor, stations
  reset, the Watcher moved far away.
- Members who are offline are hidden and ignored; when they come back they appear at the top of
  the current floor.

## class TeamSim

```js
constructor(match, team /* {id, name, color, members:[names]} */, seed) {
  this.match = match; id = team.id; name = team.name; color = team.color;
  size = team.members.length;
  this.k = MazeWorld(seed, team.id); this.k.newWorld(1, size);   // the shaft, floors 1 and 2
  level = 1; levels = 0; reachedAt = 0;
  members = team.members.map(name => newMember(name));
  thinkT = 0; monsterField = null;
  monster = { x: -5000, y: -5000, mode: "sleep", timer: Infinity, path: null, pathT: 0, pathGoal: -1,
              target: null, lastSeen: null, lost: 0, dest: null, face: 1, stuck: 0, huntT: 0 };
  phase = "play"; phaseT = 0; events = [];
  spawnTeamAt(...L.floors[0].entry);        // floor 1: no Watcher (it stays at -5000)
}
get L() { return this.k.L }
newMember(name) = { name, x: 0, y: 0, face: 1, frozen: false, thaw: 0, inv: 0, moving: false, on: true, act: false,
                    task: null, path: null, pathT: 0, pathGoal: -1, stuck: 0, fleeT: 0, react: 0, fleeGoal: null,
                    speed: rand(184, 192), walk: 0 }     // the last line is the bot brain (docs/BOTS.md)
isBot(m): the session player with that name exists and has bot === true
ev(e): events.push(e)
active(): members with on === true
frontierGate(): the first gate in L.gates that isn't open (or null)
spawnTeamAt(ci, cj): member n → x = k.ccx(ci) + OFFS[n % 8][0], y = k.ccx(cj) + OFFS[n % 8][1]; frozen = false; thaw = 0; inv = 2
placeMonster(ci, cj, sleep): x = k.ccx(ci); y = k.ccx(cj) + 20; mode = "sleep"; timer = sleep; path = target = dest = null; huntT = 0
```

### Players coming and going

```js
setOnline(name, on):     // called from updatePlayers when the session player's ws/bot status changes
  m = the member; if none or m.on === on: return; m.on = on;
  if (on) { put m at the current floor's entry + OFFS[index]; frozen = false; thaw = 0; inv = 2; ev({t:"ev", e:"back", n: name}) }
  else { frozen = false; moving = false; if (monster.target === m) { monster.target = null; mode = "patrol"; dest = null } }
replace(botName, name):  // a real player takes over a bot's character
  m = member named botName; if none return false; m.name = name; m.task = null; m.path = null; m.fleeT = 0; m.moving = false; return true
```

### Walking down

```js
banishMonster():
  if (monster.x > -1000) ev({ t:"ev", e:"banish", x: round(monster.x), y: round(monster.y) });
  monster.x = monster.y = -5000; mode = "sleep"; timer = Infinity; path = target = dest = null;
  every frozen member: frozen = false; thaw = 0; inv = 1.5;
belowGate(m) = m.y > L.floors[L.cur + 1].row0 * P + W + BODY_R + 4      // fully past the doorway
updateWalkDown(dt):
  if (!L.transit) return; L.transit.t += dt; nf = L.floors[L.cur + 1];
  if (L.transit.t > WALK_TIME) for each online member n not belowGate: move to nf.entry + OFFS[n]; ev({t:"ev", e:"tele", n})
  if (every online member is belowGate) enterFloor(L.cur + 1)
enterFloor(f):
  fl = L.floors[f]; L.cur = f; level = fl.depth; levels++; reachedAt = match.clock;
  every member: frozen = false; thaw = 0; inv = 1.5;
  L.transit = null; L.gates[f - 1].sealed = true;
  // safety net: anyone the shut gate would overlap goes to the entry
  every member n with k.blocked(m.x, m.y, BODY_R, true): move to fl.entry + OFFS[n];
  k.appendFloor(fl.depth + 1);                                  // keep one floor ready below
  L.props = L.props.filter(p => p.f >= f - 1); L.obstacles = L.props; L.lamps = L.lamps.filter(p => p.f >= f - 1);
  placeMonster(fl.spawn[0], fl.spawn[1], 6);
  ev({ t:"ev", e:"floor", lv: level, nf: L.floors.length });
```

### Stations and gates

```js
owners(g): act = active(); return g.plates.map(p => act[p.idx] ? act[p.idx].name : null)
pullLever(p, who):
  g = L.gates[p.gate]; if (g.open || g.spark > 0 || p.power > 0) return false;
  p.power = 1; p.pulled = 1; who.face = p.px >= who.x ? 1 : -1;
  noise(p.x, p.y, 5); ev({ t:"ev", e:"lever", n: who.name, g: p.gate, i: p.idx }); return true
leverAt(m): the nearest station of the frontier gate (only if its kind is "lever") within 64 px of
  (m.x, m.y) measured to (p.x, p.y); null if m is frozen, phase isn't "play", or none
updatePlates(dt):
  act = active();
  for each gate g that isn't sealed:
    own = owners(g);
    if (g.spark > 0 && !g.open) { g.spark += dt / 0.8; if (g.spark >= 1) openGate(g) }
    for each station p of g:
      p.auto = !g.open && !own[p.idx];
      if (p.kind === "plate") {
        p.occ = the first online, unfrozen member within 38 px of (p.x, p.y), else null;
        p.press = clamp(p.press + (p.occ ? dt*10 : -dt*6), 0, 1);
        if (!g.open && !(g.spark > 0) && p.occ && p.armed) { p.power = 1; p.armed = false; noise(p.x, p.y, 5); ev({t:"ev", e:"plate", g: p.gate, i: p.idx}) }
        if (!p.occ) p.armed = true;
      }
      if (p.auto) p.power = 1;                     // nobody to man it: holds itself lit
      else if (!(g.spark > 0)) { was = p.power; p.power = max(0, p.power - dt / g.window);
             if (was > 0 && p.power <= 0 && !g.open) ev({t:"ev", e:"unclick", g: p.gate, i: p.idx}) }
      p.pulled = g.open ? 1 : p.auto ? 1 : p.power;
    if (!g.open && !(g.spark > 0) && g.plates.length && every station power > 0) { g.spark = 0.001; ev({t:"ev", e:"circuit", g: g.f}) }
openGate(g):
  g.open = true; g.spark = 0; noise(k.ccx(g.i), k.ccx(g.j), 12); ev({t:"ev", e:"gate", g: g.f});
  if (g.f === L.cur) { banishMonster(); L.transit = { t: 0 } }
```

### The Watcher (AI)

```js
noise(x, y, radius):    // it hears it if it's within `radius` cells by BFS
  if (mode not in [sleep, patrol, search] or monster.x < -1000) return;
  d = k.bfs(...k.cellOf(monster), true)[k.cidx(...k.cellOfXY(x, y))];
  if (d >= 0 && d <= radius) { mode = "search"; dest = {x, y}; path = null }
speeds():                // deeper = faster and sharper-eyed; bigger team = wanders faster
  q = max(0, level - 2); sf = 1 + 0.06 * max(0, size - 2);
  return { patrol: (85 + 6q) * sf, search: (135 + 7q) * sf, hunt: min(228, 172 + 9q), leave: 150, vision: min(620, 380 + 30q) }
randomPatrolCell():      // a random cell on the current floor at least 300 px away (30 tries), else the floor's entry
sendAway(secs):
  mode = "leave"; timer = secs; target = null; huntT = 0;
  d = k.bfs(...k.cellOf(monster), true); candidates = cells with 5 <= d <= 9; q = random candidate (or 0);
  dest = { x: k.ccx(q % L.COLS), y: k.ccx((q / L.COLS) | 0) }; path = null
updateMonster(dt):
  S = speeds(); act = active();
  if (mode === "sleep") { timer -= dt; if (timer <= 0) { mode = "patrol"; dest = null } return }
  if (mode !== "leave") {
    seen = nearest online member, not frozen, inv <= 0, closer than S.vision, with k.lineOfSight(M.x, M.y-30, m.x, m.y-30);
    if (seen) { if (mode !== "hunt") { huntT = 0; ev({t:"ev", e:"spotted", n: seen.name}) }
                mode = "hunt"; target = seen; lastSeen = {x: seen.x, y: seen.y}; lost = 0 }
    else if (mode === "hunt") { lost += dt;
                if (target && !target.frozen && lost < 0.5) lastSeen = {x: target.x, y: target.y};
                if (lost > 2.2) { mode = "search"; dest = lastSeen; path = null } }
  }
  if (mode === "hunt") { huntT += dt; if (huntT > 6.5) { sendAway(4); ev({t:"ev", e:"gaveup"}) } }   // a chase tires it out
  if (mode === "hunt") {
    t = target;
    if (!t || t.frozen || !t.on) { mode = "patrol"; dest = null }
    else if (dist(M, t) < 230 && k.lineOfSight(M.x, M.y, t.x, t.y)) { path = null; k.navigate(M, t.x, t.y, S.hunt, dt, true, 0, MON_R) }
    else k.navigate(M, lastSeen.x, lastSeen.y, S.hunt, dt, true, 4, MON_R)
  } else if (mode === "search") {
    if (!dest || k.navigate(M, dest.x, dest.y, S.search, dt, true, 30, MON_R)) { mode = "patrol"; dest = null }
  } else if (mode === "patrol") {
    if (!dest) dest = randomPatrolCell();
    if (k.navigate(M, dest.x, dest.y, S.patrol, dt, true, 30, MON_R)) dest = null
  } else if (mode === "leave") {
    timer -= dt; if (dest) k.navigate(M, dest.x, dest.y, S.leave, dt, true, 30, MON_R); if (timer <= 0) { mode = "patrol"; dest = null }
  }
  // touch = freeze, then back off so a rescue is possible
  if (mode !== "leave") for the first online member m not frozen, inv <= 0 and within 46 px:
    m.frozen = true; m.thaw = 0; m.moving = false; ev({t:"ev", e:"freeze", n: m.name}); sendAway(5); break
updateThaw(dt):
  for each online frozen member f: helper = another online unfrozen member within 64 px;
    f.thaw = helper ? f.thaw + dt / THAW_TIME : max(0, f.thaw - dt * 0.25);
    if (f.thaw >= 1) { frozen = false; thaw = 0; inv = 1.8; ev({t:"ev", e:"thaw", n: f.name}) }
```

### Players' input and the tick

```js
updatePlayers(dt):
  for each member m:
    pl = match.session.players.get(m.name); on = !!(pl && (pl.ws || pl.bot));
    if (on !== m.on) setOnline(m.name, on);
    if (!m.on || !pl || pl.bot) continue;                  // bots are moved by their brain
    use = pl.act; pl.act = false;
    if (m.frozen || phase !== "play") { m.moving = false; continue }
    (ix, iy) = pl.input; l = hypot(ix, iy); m.moving = l > 0.01;
    if (m.moving) { s = PLAYER_SPEED * dt / Math.max(1, l); k.moveActor(m, ix*s, iy*s); if (Math.abs(ix) > 0.01) m.face = Math.sign(ix) }
    if (use) { p = leverAt(m); if (p) pullLever(p, m) }
separate():   // online members closer than 28 px are pushed apart by (28-d)/2 each (frozen ones don't move), using k.moveActor
update(dt):
  phaseT += dt; updatePlayers(dt);
  act = active(); if (!act.length) return;                  // nobody online: the shaft waits
  if (phase === "play") {
    think(dt); for each online bot member: updateBot(m, dt);     // docs/BOTS.md
    separate(); updatePlates(dt); updateMonster(dt); updateThaw(dt);
    if (every online member is frozen) { phase = "allfrozen"; phaseT = 0; ev({t:"ev", e:"allfrozen"}) }
    updateWalkDown(dt);
  } else if (phase === "allfrozen" && phaseT > 5) {
    at = L.floors[L.cur].entry; spawnTeamAt(at[0], at[1]);
    every station of every gate: power = 0; armed = true; pulled = 0;
    d = k.bfs(at[0], at[1], true); far = the cell index with the largest d;
    placeMonster(far % L.COLS, (far / L.COLS) | 0, 3);
    phase = "play"; phaseT = 0; ev({t:"ev", e:"again"});
  }
  every member: inv = max(0, inv - dt);
```

### snapshot(): the `M` message

```js
gates = for i from max(0, L.cur - 1) to L.gates.length - 1:
  { i, o: g.open ? 1 : 0, s: g.sealed ? 1 : 0, sp: round2(g.spark || 0), ow: owners(g),
    p: g.plates.map(p => [round3(p.power), round2(p.press), p.occ ? 1 : 0, round2(p.pulled), p.auto ? 1 : 0]) }
return { t: "M", tm: id, cur: L.cur, nf: L.floors.length, lv: level, ph: phase, pt: round1(phaseT),
  tr: L.transit ? round1(L.transit.t) : -1, ml: Math.max(0, round1(match.left)),
  m: members.map(m => [m.name, round(m.x), round(m.y), m.face, (m.frozen?1:0)|(m.moving?2:0)|(m.inv>0?4:0)|(m.on?8:0), round2(m.thaw)]),
  mon: [round(M.x), round(M.y), MODES[M.mode] || 0, M.face, M.target ? M.target.name : null], g: gates }
```

## class MazeMatch

```js
constructor(session, teams):
  this.session = session; seed = (Math.random() * 2**31) | 0;
  this.teams = teams.map(t => new TeamSim(this, t, seed));
  left = (session.matchMinutes || 5) * 60; clock = 0; over = false; boardT = 0;
clampTeam(n): clamp(Number.isInteger(n) ? n : 0, 0, teams.length - 1)
memberGone(name): every team: setOnline(name, false)
replaceMember(botName, name): the first team whose replace() returns true
update(dt): if (over) return; clock += dt; left -= dt; every team update(dt); if (left <= 0) { left = 0; over = true }
snapshot(team): teams[team].snapshot()
drainEvents(): [[teamId, event], ...] from every team, then clear each team's events
boardDue(): boardT -= 1/30; if (boardT > 0) return false; boardT = 0.5; return true
ranked(): teams sorted by levels desc, then reachedAt asc, then id asc
board(): { t: "board", ml: max(0, round(left)), teams: ranked().map(t => ({ id, name, color, members: t.members.map(m => m.name), level, levels })) }
intro(p): { t: "mintro", seed, you: p.team, ml: left, teams: teams.map(t => ({ id, name, color, size, members: names })) }
results(): { t: "over", board: board().teams }
```
