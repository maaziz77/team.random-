"use strict";
// ============================================================================================
// STUB: the lobby simulation (task #5) and the lobby bots' brain (task #6).
// Spec: docs/LOBBY.md (and docs/BOTS.md for the bot part). Keep the class, method and export
// names: sessions.js calls them.
// ============================================================================================

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

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

const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
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

class LobbySim {
  constructor(session) {
    this.session = session;
    this.people = new Map();
    this.phase = "wait";
    this.events = [];
    this.done = false; this.teams = null;
    this.doors = [];
    for (let s = 0; s < ROOMS; s++) this.doors.push({ open: 0, target: 0, live: false, flash: 0 });
    this.phaseT = 0; this.gatherLeft = GATHER; this.teamCount = 0; this.cap = MAX_TEAM;
    this.carouselAngle = 0; this.carouselSpeed = CAROUSEL_SPEED; this.occ = new Array(ROOMS).fill(0);
    this.watcher = { x: 0, y: 0, vx: 0, vy: 0, mode: "home", pause: 0, scale: 1, carry: null, dest: null };
  }

  // ---- people
  addPerson(p) {
    if (this.people.has(p.name)) return;
    let x, y;
    do { [x, y] = fromPolar(rand(PED_R + 30, CAROUSEL_R - 24), rand(0, Math.PI * 2)); } while (!this.valid(x, y));
    this.people.set(p.name, {
      p, name: p.name, x, y, vx: 0, vy: 0, face: 1,
      stun: 0, shoveT: 0, shoveCd: 0, shoveDir: [1, 0], carried: false,
      // bot brain (docs/BOTS.md)
      goal: -1, wp: null, wpRoom: -1, wanderT: 0, joinAt: rand(3, GATHER * 0.7),
      afk: !!p.bot && Math.random() < BOT_AFK,
      speed: p.bot ? rand(150, 185) : SPEED,
    });
    if (this.teamCount && this.phase !== "wait") this.ensureRoom();
  }
  removePerson(name) {
    const w = this.watcher;
    if (w.carry && w.carry.name === name) { w.carry = null; w.dest = null; }
    this.people.delete(name);
  }
  isCarried(name) { const a = this.people.get(name); return !!(a && a.carried); }
  // a real player takes over a bot's spot (same position, same cell)
  replacePerson(botName, p) {
    const a = this.people.get(botName);
    if (!a) { this.addPerson(p); return; }
    this.people.delete(botName);
    a.p = p; a.name = p.name; a.afk = false; a.speed = SPEED;
    this.people.set(p.name, a);
  }

  // ---- geometry
  valid(x, y, rad = BODY_R) {
    const [r, th] = polar(x, y);
    if (r < PED_R + rad) return false;
    if (r <= R - rad) return true;                                   // the hall
    const s = sectorOf(th), phi = sectorPhi(th, s);
    if (r < R + WALL + rad) return this.doors[s].open > 0.55 && Math.abs(phi) * R <= DOOR_HALF - rad * 0.7; // the doorway
    if (r > R + WALL + DEPTH - rad) return false;                     // back wall
    return (SW / 2 - Math.abs(phi)) * r >= RWALL / 2 + rad;           // inside the cell, clear of its side walls
  }
  // a full or closed cell turns people away; once the Watcher is mad (or sealing), nobody walks out
  crossing(a, nx, ny) {
    const from = cellOf(a.x, a.y), to = cellOf(nx, ny);
    if (from === to) return false;
    if (to >= 0 && (!this.doors[to].live || this.occ[to] >= this.cap)) return true;
    return from >= 0 && (this.phase === "mad" || this.phase === "seal");
  }
  // try the full move, then each axis, then slide along the circle
  moveActor(a, dx, dy) {
    const ok = (x, y) => this.valid(x, y) && !this.crossing(a, x, y);
    if (ok(a.x + dx, a.y + dy)) { a.x += dx; a.y += dy; return; }
    if (ok(a.x + dx, a.y)) { a.x += dx; return; }
    if (ok(a.x, a.y + dy)) { a.y += dy; return; }
    const [r, th] = polar(a.x, a.y), step = Math.hypot(dx, dy) / Math.max(r, 1);
    for (const s of [1, -1]) {
      const [tx, ty] = fromPolar(r, th + s * step);
      if ((tx - a.x) * dx + (ty - a.y) * dy > 0 && ok(tx, ty)) { a.x = tx; a.y = ty; return; }
    }
  }
  countCells() {
    this.occ = new Array(ROOMS).fill(0);
    for (const a of this.people.values()) {
      if (a.carried) continue;
      const s = cellOf(a.x, a.y);
      if (s >= 0) this.occ[s]++;
    }
  }
  inCells() { return [...this.people.values()].filter((a) => !a.carried && cellOf(a.x, a.y) >= 0); }
  outsiders() { return [...this.people.values()].filter((a) => !a.carried && cellOf(a.x, a.y) < 0); }

  // ---- starting and phases
  start() {                                   // host only (checked by the session)
    if (this.phase !== "wait" || !this.people.size) return;
    const plan = planLobby(this.people.size); this.teamCount = plan.teams; this.cap = plan.cap;
    // open plan.teams cells spread evenly round the ring, starting at a random one
    const off = Math.floor(Math.random() * ROOMS), set = new Set();
    for (let q = 0; q < plan.teams; q++) set.add((off + Math.round(q * ROOMS / plan.teams)) % ROOMS);
    this.doors.forEach((d, s) => { d.live = set.has(s); d.target = d.live ? 1 : 0; });
    this.gatherLeft = GATHER; this.setPhase("gather");
  }
  // someone joined late: open another cell (random closed one), or let cells hold one more
  ensureRoom() {
    while (this.teamCount * this.cap < this.people.size) {
      const closed = [];
      this.doors.forEach((d, s) => { if (!d.live) closed.push(s); });
      if (closed.length && this.teamCount < ROOMS) {
        const d = this.doors[pick(closed)];
        d.live = true; d.target = 1; this.teamCount++;
      } else this.cap++;
    }
  }
  setPhase(ph) {
    this.phase = ph; this.phaseT = 0;
    if (ph === "mad") { this.watcher.mode = "drag"; this.watcher.pause = 1.1; }
    if (ph === "seal") {
      this.watcher.mode = "home"; this.watcher.carry = null;
      for (const a of this.people.values()) a.carried = false;
      for (const d of this.doors) d.target = 0;
      // anyone standing in a doorway steps inside before it shuts
      for (const a of this.people.values()) {
        const s = cellOf(a.x, a.y), [r, th] = polar(a.x, a.y);
        if (s >= 0 && r < R + WALL + BODY_R + 4) { [a.x, a.y] = fromPolar(R + WALL + BODY_R + 6, th); a.vx = a.vy = 0; }
      }
    }
    this.events.push({ t: "ev", e: "phase", ph });
  }
  drainEvents() { const e = this.events; this.events = []; return e; }

  // ---- shoving (Space)
  shove(a, dx, dy) {
    if (a.shoveCd > 0 || a.stun > 0 || a.carried) return;
    const l = Math.hypot(dx, dy) || 1;
    a.shoveDir = [dx / l, dy / l]; a.shoveT = 0.16; a.shoveCd = 1.1; a.face = dx >= 0 ? 1 : -1;
    const [sx, sy] = a.shoveDir, hit = [];
    for (const o of this.people.values()) {
      if (o === a || o.carried) continue;
      const ox = o.x - a.x, oy = o.y - a.y, od = Math.hypot(ox, oy);
      if (od < 58 && (ox * sx + oy * sy) / (od || 1) > 0.3) { o.vx = sx * 560; o.vy = sy * 560; o.stun = 0.45; hit.push(o.name); }
    }
    this.events.push({ t: "ev", e: "shove", n: a.name, f: a.face, hit });
  }

  // ---- the Watcher (dragging stragglers)
  emptiestCell() {
    const live = [];
    this.doors.forEach((d, s) => { if (d.live) live.push(s); });
    const least = Math.min(...live.map((s) => this.occ[s]));
    return pick(live.filter((s) => this.occ[s] === least));
  }
  updateWatcher(dt) {
    const w = this.watcher;
    if (w.mode === "home") {
      const k = clamp(dt * 2, 0, 1);
      w.x = lerp(w.x, 0, k); w.y = lerp(w.y, 0, k); w.scale = lerp(w.scale, 1, dt * 3);
      return;
    }
    w.scale = lerp(w.scale, 1.25, dt * 2);
    const hold = () => { if (w.carry) { w.carry.x = w.x; w.carry.y = w.y + 34; } };
    if (w.pause > 0) { w.pause -= dt; hold(); return; }
    let tx, ty;
    if (!w.carry) {
      const prey = this.outsiders();
      if (!prey.length) return;
      
      let best = prey[0];
      for (const a of prey) if (Math.hypot(a.x - w.x, a.y - w.y) < Math.hypot(best.x - w.x, best.y - w.y)) best = a;
      tx = best.x; ty = best.y - 34;
      if (Math.hypot(tx - w.x, ty - w.y) < 40) {                           // grab
        w.carry = best; best.carried = true; best.vx = best.vy = 0; best.stun = 0; best.shoveT = 0;
        const s = this.emptiestCell(), [dx, dy] = roomSpot(s);
        w.dest = { x: dx, y: dy, s };
        w.pause = 0.3; this.events.push({ t: "ev", e: "grab", n: best.name, cell: s }); hold(); return;
      }
    } else {
      tx = w.dest.x; ty = w.dest.y - 34;
      if (Math.hypot(tx - w.x, ty - w.y) < 18) {                           // drop
        const a = w.carry;
        a.x = w.dest.x; a.y = w.dest.y; a.carried = false; a.vx = a.vy = 0; a.stun = 0.5;
        this.doors[w.dest.s].flash = 0.8;
        this.events.push({ t: "ev", e: "drop", n: a.name, cell: w.dest.s, x: Math.round(a.x), y: Math.round(a.y) });
        w.carry = null; w.pause = 0.2; return;
      }
    }
    // fly straight there (over walls), faster the more people are left to fetch
    const speed = 620 + 70 * Math.min(8, this.outsiders().length);
    const d = Math.hypot(tx - w.x, ty - w.y), v = Math.min(speed, d / dt);
    const k = clamp(dt * 6, 0, 1);
    w.vx = lerp(w.vx, ((tx - w.x) / d) * v, k); w.vy = lerp(w.vy, ((ty - w.y) / d) * v, k);
    w.x += w.vx * dt; w.y += w.vy * dt; hold();
  }

  // ---- every cell with people becomes a team
  finish() {
    this.countCells();
    const teams = [], placed = new Set();
    this.doors.forEach((d, s) => {
      if (!d.live) return;
      const members = [...this.people.values()].filter((a) => cellOf(a.x, a.y) === s).map((a) => a.name);
      if (!members.length) return;
      for (const n of members) placed.add(n);
      teams.push({ id: teams.length, cell: s, name: `Cell ${s + 1}`, color: CELL_COLORS[s], members });
    });
    for (const a of this.people.values()) {
      if (placed.has(a.name)) continue;
      if (!teams.length) teams.push({ id: 0, cell: 0, name: "Cell 1", color: CELL_COLORS[0], members: [] });
      let small = teams[0];
      for (const t of teams) if (t.members.length < small.members.length) small = t;
      small.members.push(a.name);
    }
    this.teams = teams.filter((t) => t.members.length).map((t, i) => ({ ...t, id: i }));
    this.done = true; this.phase = "done";
  }

  // ---- the bot brain (docs/BOTS.md)
  // unit vector to the target, pushed away from the pedestal: [vx, vy, d]
  steerTo(a, tx, ty, speed) {
    const d = Math.hypot(tx - a.x, ty - a.y);
    let dx = (tx - a.x) / (d || 1), dy = (ty - a.y) / (d || 1);
    const r = Math.hypot(a.x, a.y);
    if (r < PED_R + 70) { dx += a.x / r * 0.9; dy += a.y / r * 0.9; }
    const l = Math.hypot(dx, dy) || 1;
    return [dx / l * speed, dy / l * speed, d];
  }
  wanderVel(a, dt, mul = 1) {
    a.wanderT -= dt;
    if (!a.wp || a.wpRoom !== -1 || a.wanderT <= 0) {
      a.wanderT = rand(1.5, 4); a.wp = fromPolar(rand(PED_R + 50, R - 60), rand(0, Math.PI * 2)); a.wpRoom = -1;
    }
    const [vx, vy, d] = this.steerTo(a, a.wp[0], a.wp[1], a.speed * 0.55 * mul);
    return d < 14 ? [0, 0] : [vx, vy];
  }
  roomOf(a) { const [r, th] = polar(a.x, a.y); return r > R + WALL * 0.5 ? sectorOf(th) : -1; }
  navToRoom(a, s) {
    const here = this.roomOf(a);
    if (here === s) {
      if (!a.wp || a.wpRoom !== s) { a.wp = roomSpot(s); a.wpRoom = s; }
      const [vx, vy, d] = this.steerTo(a, a.wp[0], a.wp[1], a.speed);
      return d < 10 ? [0, 0] : [vx, vy];
    }
    if (here >= 0) return this.steerTo(a, ...doorPoint(here, R - 40), a.speed);          // leave the wrong cell first
    const o = doorPoint(s, R - 34);
    if (Math.hypot(a.x - o[0], a.y - o[1]) < 36 || Math.hypot(a.x, a.y) > R - 40) {
      return this.steerTo(a, ...doorPoint(s, R + WALL + 60), a.speed);                   // go through
    }
    return this.steerTo(a, o[0], o[1], a.speed);                                          // go to the doorway
  }
  // a live cell with room (counting bots on their way), biased to near ones
  chooseCell(a, heading) {
    let best = -1, bestScore = Infinity;
    this.doors.forEach((d, s) => {
      if (!d.live || this.occ[s] + heading[s] >= this.cap) return;
      const [dx, dy] = doorPoint(s, R);
      const score = Math.hypot(a.x - dx, a.y - dy) + rand(0, 420);
      if (score < bestScore) { bestScore = score; best = s; }
    });
    return best;
  }
  botVel(a, dt, heading) {
    if (this.phase === "wait") return this.wanderVel(a, dt, 0.8);
    const here = cellOf(a.x, a.y);
    if (here >= 0) { a.goal = here; return this.navToRoom(a, here); }          // in a cell: settle in, stay
    if (a.afk) return this.phase === "mad" ? [0, 0] : this.wanderVel(a, dt, 0.35);
    if (GATHER - this.gatherLeft < a.joinAt && this.phase === "gather") return this.wanderVel(a, dt, 1);
    if (a.goal < 0 || this.occ[a.goal] >= this.cap) {
      if (a.goal >= 0) heading[a.goal]--;
      a.goal = this.chooseCell(a, heading); a.wp = null;
      if (a.goal >= 0) heading[a.goal]++;
    }
    return a.goal >= 0 ? this.navToRoom(a, a.goal) : this.wanderVel(a, dt, 1);
  }

  // ---- one tick of the simulation
  update(dt) {
    this.phaseT += dt; this.countCells();
    const everyone = [...this.people.values()];
    const allIn = everyone.length > 0 && everyone.every((a) => !a.carried && cellOf(a.x, a.y) >= 0);
    if (this.phase === "gather") {
      this.gatherLeft -= dt;
      if (allIn) this.setPhase("allin"); else if (this.gatherLeft <= 0) this.setPhase("mad");
    } else if (this.phase === "allin") {
      if (!allIn) this.setPhase("gather"); else if (this.phaseT >= ALLIN_T) this.setPhase("seal");
    } else if (this.phase === "mad") {
      if (!this.watcher.carry && !this.outsiders().length && this.phaseT > 1.2) this.setPhase("seal");
    } else if (this.phase === "seal" && this.phaseT >= SEAL_T) { this.finish(); return; }

    this.carouselSpeed = lerp(this.carouselSpeed, this.phase === "seal" ? 0 : CAROUSEL_SPEED, clamp(dt * 1.5, 0, 1));
    this.carouselAngle = (this.carouselAngle + this.carouselSpeed * dt) % (Math.PI * 2);
    for (const d of this.doors) {
      d.open = clamp(d.open + Math.sign(d.target - d.open) * dt * (d.target ? 3 : 7), 0, 1);
      d.flash = Math.max(0, d.flash - dt);
    }

    const heading = new Array(ROOMS).fill(0);
    for (const a of everyone) if (a.p.bot && a.goal >= 0 && cellOf(a.x, a.y) !== a.goal) heading[a.goal]++;

    for (const a of everyone) {
      const pl = a.p;
      if (a.carried) { pl.shove = false; continue; }
      a.shoveCd -= dt; a.stun -= dt;
      let vx = 0, vy = 0;
      if (a.shoveT > 0) { a.shoveT -= dt; vx = a.shoveDir[0] * 430; vy = a.shoveDir[1] * 430; }
      else if (a.stun > 0) { vx = a.vx; vy = a.vy; }
      else if (this.phase !== "seal" && pl.bot) [vx, vy] = this.botVel(a, dt, heading);
      else if (this.phase !== "seal") {
        const ix = pl.input.x, iy = pl.input.y, l = Math.hypot(ix, iy);
        if (l > 0.01) { vx = ix / Math.max(1, l) * SPEED; vy = iy / Math.max(1, l) * SPEED; a.lastDir = [ix / l, iy / l]; }
        if (pl.shove) { const d = a.lastDir || [a.face, 0]; this.shove(a, d[0], d[1]); }
      }
      pl.shove = false;
      // the spinning floor carries whoever stands on it
      if (Math.hypot(a.x, a.y) < CAROUSEL_R && this.carouselSpeed > 0.01) { vx += -a.y * this.carouselSpeed; vy += a.x * this.carouselSpeed; }
      if (a.stun > 0) { a.vx *= 1 - dt * 5; a.vy *= 1 - dt * 5; }
      else { const k = clamp(dt * 14, 0, 1); a.vx = lerp(a.vx, vx, k); a.vy = lerp(a.vy, vy, k); }
      this.moveActor(a, a.vx * dt, a.vy * dt);
      if (Math.abs(a.vx) > 20) a.face = a.vx > 0 ? 1 : -1;
    }

    // personal space: push overlapping pairs apart (never through a full cell's door)
    for (let i = 0; i < everyone.length; i++) {
      const a = everyone[i];
      if (a.carried) continue;
      for (let j = i + 1; j < everyone.length; j++) {
        const b = everyone[j];
        if (b.carried) continue;
        const d = Math.hypot(b.x - a.x, b.y - a.y), m = 2 * BODY_R;
        if (d < m && d > 0.01) {
          const p = (m - d) / 2, ux = (b.x - a.x) / d, uy = (b.y - a.y) / d;
          const ax = a.x - ux * p, ay = a.y - uy * p, bx = b.x + ux * p, by = b.y + uy * p;
          if (this.valid(ax, ay) && !this.crossing(a, ax, ay)) { a.x = ax; a.y = ay; }
          if (this.valid(bx, by) && !this.crossing(b, bx, by)) { b.x = bx; b.y = by; }
        }
      }
    }

    this.updateWatcher(dt);
  }

  // ---- the "L" snapshot (docs/PROTOCOL.md)
  snapshot() {
    const r1 = (v) => Math.round(v * 10) / 10, r2 = (v) => Math.round(v * 100) / 100, r3 = (v) => Math.round(v * 1000) / 1000;
    const w = this.watcher;
    return {
      t: "L", ph: this.phase, tl: Math.max(0, r1(this.gatherLeft)), pt: r1(this.phaseT),
      ca: r3(this.carouselAngle), cs: r2(this.carouselSpeed), cap: this.cap, tc: this.teamCount,
      live: this.doors.map((d) => (d.live ? 1 : 0)), occ: this.occ, dr: this.doors.map((d) => Math.round(d.open * 100)),
      fl: this.doors.map((d) => Math.round(d.flash * 10)),
      w: [Math.round(w.x), Math.round(w.y), w.mode === "drag" ? 1 : 0, Math.round(w.scale * 100), w.carry ? w.carry.name : null],
      p: [...this.people.values()].map((a) => [a.name, Math.round(a.x), Math.round(a.y), (a.carried ? 1 : 0) | (a.stun > 0 ? 2 : 0), a.face]),
    };
  }
}

module.exports = { LobbySim, planLobby };
