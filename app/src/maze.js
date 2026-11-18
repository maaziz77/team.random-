"use strict";
// ============================================================================================
// STUB: the maze match. Spec: docs/MAZE.md (and docs/BOTS.md).
//   task #7: TeamSim players, stations, gates, walking down, floors + MazeMatch (clock, board)
//   task #8: the Watcher (noise, speeds, sendAway, updateMonster, updateThaw, the penalty)
//   task #9: maze bots (think, updateBot, plateBot, fleeCell, replace)
// Keep the class, method and export names: sessions.js calls them. This file can be built and
// tested on its own with a fake session object before sessions.js exists.
// ============================================================================================
const { MazeWorld, C, W, P, BODY_R } = require("../shared/mazeworld"); // see app/shared/README.md

// TODO (task #7): MON_R, THAW_TIME, WALK_TIME, PLAYER_SPEED, OFFS, MODES (docs/MAZE.md)
const MON_R = 20;
const THAW_TIME = 2.0;
const WALK_TIME = 10;
const MATCH_SECONDS = 300;
const PLAYER_SPEED = 215;
const OFFS = [[-30,-30],[30,-30],[-30,30],[30,30],[0,-48],[0,48],[-56,0],[56,0]];
const MODES = { sleep: 0, patrol: 1, search: 2, hunt: 3, leave: 4 };

// Local helpers
const rand  = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist  = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const round  = (v) => Math.round(v);
const round1 = (v) => Math.round(v * 10) / 10;
const round2 = (v) => Math.round(v * 100) / 100;
const round3 = (v) => Math.round(v * 1000) / 1000;

class TeamSim {
  constructor(match, team, seed) {
    this.match = match; this.id = team.id; this.name = team.name; this.color = team.color;
    this.size = team.members.length; this.level = 1; this.levels = 0; this.reachedAt = 0;
    this.events = [];

    this.k = MazeWorld(seed, team.id);
    this.k.newWorld(1, this.size);
    this.members = team.members.map(name => this.newMember(name));
    this.thinkT = 0;
    this.monsterField = null;
    this.monster = {
      x: -5000, y: -5000, mode: "sleep", timer: Infinity,
      path: null, pathT: 0, pathGoal: -1,
      target: null, lastSeen: null, lost: 0, dest: null, face: 1, stuck: 0, huntT: 0
    };
    this.phase = "play"; this.phaseT = 0;
    const at = this.L.floors[0].entry;
    this.spawnTeamAt(at[0], at[1]); // floor 1: no Watcher (it stays at -5000)
  }

  get L() { return this.k.L; }

  newMember(name) {
    return {
      name, x: 0, y: 0, face: 1, frozen: false, thaw: 0, inv: 0,
      moving: false, on: true, act: false,
      task: null, path: null, pathT: 0, pathGoal: -1, stuck: 0,
      fleeT: 0, react: 0, fleeGoal: null,
      speed: rand(184, 192), walk: 0
    };
  }

  isBot(m) {
    const pl = this.match.session.players.get(m.name);
    return !!(pl && pl.bot);
  }

  ev(e) { this.events.push(e); }

  active() { return this.members.filter(m => m.on); }

  frontierGate() {
    for (const g of this.L.gates) {
      if (!g.open) return g;
    }
    return null;
  }

  spawnTeamAt(ci, cj) {
    this.members.forEach((m, n) => {
      m.x = this.k.ccx(ci) + OFFS[n % 8][0];
      m.y = this.k.ccx(cj) + OFFS[n % 8][1];
      m.frozen = false; m.thaw = 0; m.inv = 2;
    });
  }

  placeMonster(ci, cj, sleep) {
    const M = this.monster;
    M.x = this.k.ccx(ci); M.y = this.k.ccx(cj) + 20;
    M.mode = "sleep"; M.timer = sleep;
    M.path = null; M.target = null; M.dest = null; M.huntT = 0;
  }

  // ---- Players coming and going ----

  setOnline(name, on) {
    const m = this.members.find(x => x.name === name);
    if (!m || m.on === on) return;
    m.on = on;
    if (on) {
      const idx = this.members.indexOf(m);
      const fl = this.L.floors[this.L.cur];
      m.x = this.k.ccx(fl.entry[0]) + OFFS[idx % 8][0];
      m.y = this.k.ccx(fl.entry[1]) + OFFS[idx % 8][1];
      m.frozen = false; m.thaw = 0; m.inv = 2;
      this.ev({ t: "ev", e: "back", n: name });
    } else {
      m.frozen = false; m.moving = false;
      if (this.monster.target === m) {
        this.monster.target = null; this.monster.mode = "patrol"; this.monster.dest = null;
      }
    }
  }

  replace(botName, name) {
    const m = this.members.find(x => x.name === botName);
    if (!m) return false;
    m.name = name; m.task = null; m.path = null; m.fleeT = 0; m.moving = false;
    return true;
  }

  // ---- Walking down ----

  banishMonster() {
    const M = this.monster;
    if (M.x > -1000) this.ev({ t: "ev", e: "banish", x: round(M.x), y: round(M.y) });
    M.x = -5000; M.y = -5000; M.mode = "sleep"; M.timer = Infinity;
    M.path = null; M.target = null; M.dest = null;
    for (const m of this.members) {
      if (m.frozen) { m.frozen = false; m.thaw = 0; m.inv = 1.5; }
    }
  }

  belowGate(m) {
    return m.y > this.L.floors[this.L.cur + 1].row0 * P + W + BODY_R + 4;
  }

  updateWalkDown(dt) {
    if (!this.L.transit) return;
    this.L.transit.t += dt;
    const nf = this.L.floors[this.L.cur + 1];
    if (this.L.transit.t > WALK_TIME) {
      this.members.forEach((m, n) => {
        if (m.on && !this.belowGate(m)) {
          m.x = this.k.ccx(nf.entry[0]) + OFFS[n % 8][0];
          m.y = this.k.ccx(nf.entry[1]) + OFFS[n % 8][1];
          this.ev({ t: "ev", e: "tele", n: m.name });
        }
      });
    }
    const act = this.active();
    if (act.length > 0 && act.every(m => this.belowGate(m))) {
      this.enterFloor(this.L.cur + 1);
    }
  }

  enterFloor(f) {
    const fl = this.L.floors[f];
    this.L.cur = f; this.level = fl.depth; this.levels++; this.reachedAt = this.match.clock;
    this.members.forEach(m => { m.frozen = false; m.thaw = 0; m.inv = 1.5; });
    this.L.transit = null;
    this.L.gates[f - 1].sealed = true;
    // safety net: anyone the shut gate would overlap goes to the entry
    this.members.forEach((m, n) => {
      if (this.k.blocked(m.x, m.y, BODY_R, true)) {
        m.x = this.k.ccx(fl.entry[0]) + OFFS[n % 8][0];
        m.y = this.k.ccx(fl.entry[1]) + OFFS[n % 8][1];
      }
    });
    this.k.appendFloor(fl.depth + 1); // keep one floor ready below
    this.L.props = this.L.props.filter(p => p.f >= f - 1);
    this.L.obstacles = this.L.props;
    this.L.lamps = this.L.lamps.filter(p => p.f >= f - 1);
    this.placeMonster(fl.spawn[0], fl.spawn[1], 6);
    this.ev({ t: "ev", e: "floor", lv: this.level, nf: this.L.floors.length });
  }

  // ---- Stations and gates ----

  owners(g) {
    const act = this.active();
    return g.plates.map(p => (act[p.idx] ? act[p.idx].name : null));
  }

  pullLever(p, who) {
    const g = this.L.gates[p.gate];
    if (g.open || (g.spark || 0) > 0 || p.power > 0) return false;
    p.power = 1; p.pulled = 1;
    who.face = p.px >= who.x ? 1 : -1;
    this.noise(p.x, p.y, 5);
    this.ev({ t: "ev", e: "lever", n: who.name, g: p.gate, i: p.idx });
    return true;
  }

  leverAt(m) {
    if (m.frozen || this.phase !== "play") return null;
    const g = this.frontierGate();
    if (!g || g.kind !== "lever") return null;
    let best = null; let bd = Infinity;
    for (const p of g.plates) {
      const d = Math.hypot(p.x - m.x, p.y - m.y);
      if (d <= 64 && d < bd) { bd = d; best = p; }
    }
    return best;
  }

  updatePlates(dt) {
    const act = this.active();
    for (const g of this.L.gates) {
      if (g.sealed) continue;
      const own = this.owners(g);
      if ((g.spark || 0) > 0 && !g.open) {
        g.spark += dt / 0.8;
        if (g.spark >= 1) this.openGate(g);
      }
      for (const p of g.plates) {
        p.auto = !g.open && !own[p.idx];
        if (p.kind === "plate") {
          p.occ = act.find(m => !m.frozen && Math.hypot(p.x - m.x, p.y - m.y) <= 38) || null;
          p.press = clamp(p.press + (p.occ ? dt * 10 : -dt * 6), 0, 1);
          if (!g.open && !((g.spark || 0) > 0) && p.occ && p.armed) {
            p.power = 1; p.armed = false;
            this.noise(p.x, p.y, 5);
            this.ev({ t: "ev", e: "plate", g: p.gate, i: p.idx });
          }
          if (!p.occ) p.armed = true;
        }
        if (p.auto) {
          p.power = 1;
        } else if (!((g.spark || 0) > 0)) {
          const was = p.power;
          p.power = Math.max(0, p.power - dt / g.window);
          if (was > 0 && p.power <= 0 && !g.open) {
            this.ev({ t: "ev", e: "unclick", g: p.gate, i: p.idx });
          }
        }
        p.pulled = g.open ? 1 : (p.auto ? 1 : p.power);
      }
      if (!g.open && !((g.spark || 0) > 0) && g.plates.length > 0 && g.plates.every(p => p.power > 0)) {
        g.spark = 0.001;
        this.ev({ t: "ev", e: "circuit", g: g.f });
      }
    }
  }

  openGate(g) {
    g.open = true; g.spark = 0;
    this.noise(this.k.ccx(g.i), this.k.ccx(g.j), 12);
    this.ev({ t: "ev", e: "gate", g: g.f });
    if (g.f === this.L.cur) {
      this.banishMonster();
      this.L.transit = { t: 0 };
    }
  }

  // ---- The Watcher (AI) ---- (task #8 — stubs here, implemented in task #8)

  noise(x, y, radius) {
    const M = this.monster;
    if (!["sleep", "patrol", "search"].includes(M.mode) || M.x < -1000) return;
    const d = this.k.bfs(...this.k.cellOf(M), true);
    const idx = this.k.cidx(...this.k.cellOfXY(x, y));
    if (d[idx] >= 0 && d[idx] <= radius) {
      M.mode = "search"; M.dest = { x, y }; M.path = null;
    }
  }

  speeds() {
    const q = Math.max(0, this.level - 2);
    const sf = 1 + 0.06 * Math.max(0, this.size - 2);
    return {
      patrol: (85 + 6 * q) * sf,
      search: (135 + 7 * q) * sf,
      hunt: Math.min(228, 172 + 9 * q),
      leave: 150,
      vision: Math.min(620, 380 + 30 * q)
    };
  }

  randomPatrolCell() {
    const k = this.k; const L = this.L; const M = this.monster;
    const [mi, mj] = k.cellOf(M);
    for (let tries = 0; tries < 30; tries++) {
      const ci = Math.floor(Math.random() * L.COLS);
      const cj = Math.floor(Math.random() * L.ROWS);
      const x = k.ccx(ci); const y = k.ccx(cj);
      if (Math.hypot(x - M.x, y - M.y) >= 300) return { x, y };
    }
    return { x: k.ccx(L.floors[L.cur].entry[0]), y: k.ccx(L.floors[L.cur].entry[1]) };
  }

  sendAway(secs) {
    const M = this.monster;
    M.mode = "leave"; M.timer = secs; M.target = null; M.huntT = 0;
    const d = this.k.bfs(...this.k.cellOf(M), true);
    const candidates = [];
    for (let q = 0; q < d.length; q++) {
      if (d[q] >= 5 && d[q] <= 9) candidates.push(q);
    }
    const q = candidates.length > 0 ? candidates[Math.floor(Math.random() * candidates.length)] : 0;
    M.dest = { x: this.k.ccx(q % this.L.COLS), y: this.k.ccx((q / this.L.COLS) | 0) };
    M.path = null;
  }

  updateMonster(dt) {
    const M = this.monster; const k = this.k;
    const S = this.speeds(); const act = this.active();
    if (M.mode === "sleep") { M.timer -= dt; if (M.timer <= 0) { M.mode = "patrol"; M.dest = null; } return; }
    if (M.mode !== "leave") {
      // find seen player
      let seen = null;
      for (const m of act) {
        if (m.frozen || m.inv > 0) continue;
        const d = dist(M, m);
        if (d < S.vision && k.lineOfSight(M.x, M.y - 30, m.x, m.y - 30)) {
          if (!seen || d < dist(M, seen)) seen = m;
        }
      }
      if (seen) {
        if (M.mode !== "hunt") { M.huntT = 0; this.ev({ t: "ev", e: "spotted", n: seen.name }); }
        M.mode = "hunt"; M.target = seen; M.lastSeen = { x: seen.x, y: seen.y }; M.lost = 0;
      } else if (M.mode === "hunt") {
        M.lost += dt;
        if (M.target && !M.target.frozen && M.lost < 0.5) M.lastSeen = { x: M.target.x, y: M.target.y };
        if (M.lost > 2.2) { M.mode = "search"; M.dest = M.lastSeen; M.path = null; }
      }
    }
    if (M.mode === "hunt") {
      M.huntT += dt;
      if (M.huntT > 6.5) { this.sendAway(4); this.ev({ t: "ev", e: "gaveup" }); }
    }
    if (M.mode === "hunt") {
      const t = M.target;
      if (!t || t.frozen || !t.on) { M.mode = "patrol"; M.dest = null; }
      else if (dist(M, t) < 230 && k.lineOfSight(M.x, M.y, t.x, t.y)) {
        M.path = null; k.navigate(M, t.x, t.y, S.hunt, dt, true, 0, MON_R);
      } else {
        k.navigate(M, M.lastSeen.x, M.lastSeen.y, S.hunt, dt, true, 4, MON_R);
      }
    } else if (M.mode === "search") {
      if (!M.dest || k.navigate(M, M.dest.x, M.dest.y, S.search, dt, true, 30, MON_R)) {
        M.mode = "patrol"; M.dest = null;
      }
    } else if (M.mode === "patrol") {
      if (!M.dest) M.dest = this.randomPatrolCell();
      if (k.navigate(M, M.dest.x, M.dest.y, S.patrol, dt, true, 30, MON_R)) M.dest = null;
    } else if (M.mode === "leave") {
      M.timer -= dt;
      if (M.dest) k.navigate(M, M.dest.x, M.dest.y, S.leave, dt, true, 30, MON_R);
      if (M.timer <= 0) { M.mode = "patrol"; M.dest = null; }
    }
    // touch = freeze, then back off
    if (M.mode !== "leave") {
      for (const m of act) {
        if (m.frozen || m.inv > 0) continue;
        if (dist(M, m) < 46) {
          m.frozen = true; m.thaw = 0; m.moving = false;
          this.ev({ t: "ev", e: "freeze", n: m.name });
          this.sendAway(5);
          break;
        }
      }
    }
  }

  updateThaw(dt) {
    for (const f of this.members) {
      if (!f.on || !f.frozen) continue;
      const helper = this.members.find(m => m !== f && m.on && !m.frozen && dist(m, f) <= 64);
      f.thaw = helper ? f.thaw + dt / THAW_TIME : Math.max(0, f.thaw - dt * 0.25);
      if (f.thaw >= 1) {
        f.frozen = false; f.thaw = 0; f.inv = 1.8;
        this.ev({ t: "ev", e: "thaw", n: f.name });
      }
    }
  }

  // ---- Bots (task #9) ----

  think(dt) {
    this.thinkT -= dt; if (this.thinkT > 0) return; this.thinkT = 0.3;
    const M = this.monster;
    this.monsterField = M.x > -1000 ? this.k.bfs(...this.k.cellOf(M), true) : null;
    const bots = this.members.filter(m => m.on && !m.frozen && this.isBot(m));
    if (!bots.length) return;
    if (this.L.transit) {
      bots.forEach(b => {
        if (!b.task || b.task.kind !== "down") {
          b.task = { kind: "down", spot: OFFS[this.members.indexOf(b) % 8] };
        }
      });
      return;
    }
    const g = this.frontierGate(); const own = g ? this.owners(g) : [];
    let free = new Set(bots);
    // rescue first
    const frozen = this.members.filter(m => m.on && m.frozen);
    for (const f of frozen) {
      const md = dist(M, f);
      const safe = md > 330 || M.mode === "leave" || M.mode === "sleep";
      if (!safe) continue;
      let nearest = null; let bd = Infinity;
      for (const b of free) {
        let d = dist(b, f);
        if (b.task && b.task.kind === "revive" && b.task.who === f) d -= 600;
        if (d < bd) { bd = d; nearest = b; }
      }
      if (nearest) {
        const existing = (nearest.task && nearest.task.kind === "revive" && nearest.task.who === f) ? nearest.task : { kind: "revive", who: f };
        nearest.task = existing;
        free.delete(nearest);
      }
    }
    // assign plate tasks
    if (g) {
      for (const b of [...free]) {
        const idx = this.members.indexOf(b);
        const plate = g.plates.find(p => p.idx === own.indexOf(b.name));
        if (plate) {
          const existing = (b.task && b.task.kind === "plate" && b.task.plate === plate) ? b.task : { kind: "plate", plate };
          b.task = existing;
          free.delete(b);
        }
      }
    }
    // follow for the rest
    for (const b of free) {
      if (!b.task || b.task.kind !== "follow") b.task = { kind: "follow" };
    }
    // count-in
    if (g && !g.open && !((g.spark || 0) > 0)) {
      const humanOwner = own.some(name => name && this.members.find(m => m.name === name && !this.isBot(m)));
      const holders = g.plates.map(p => bots.find(b => b.task && b.task.kind === "plate" && b.task.plate === p));
      const ready = !humanOwner && holders.every(h => h && h.task.stage === "ready") &&
        g.plates.every(p => p.power <= 0 || p.auto);
      g.count = ready ? (g.count || 0) + 0.3 : 0;
      if (g.count > 0.9 && holders[0]) { holders[0].task.go = true; g.count = 0; }
    }
  }

  updateBot(b, dt) {
    if (b.frozen) { b.moving = false; return; }
    const M = this.monster;
    const md = dist(b, M);
    const awake = M.mode !== "sleep" && M.mode !== "leave";
    const threat = awake && b.inv <= 0 && ((M.mode === "hunt" && M.target === b && md < 450) || md < 240);
    if (threat && b.fleeT <= 0) {
      b.react += dt;
      if (b.react > 0.22) { b.fleeT = 1.6; b.fleeGoal = null; b.react = 0; b.path = null; }
    } else if (!threat) { b.react = 0; }
    if (b.fleeT > 0) {
      b.fleeT -= dt;
      if (!b.fleeGoal || Math.random() < dt * 2.5) b.fleeGoal = this.fleeCell(b);
      if (b.fleeGoal) this.k.navigate(b, this.k.ccx(b.fleeGoal[0]), this.k.ccx(b.fleeGoal[1]), b.speed, dt);
      if (threat && b.fleeT < 0.3) b.fleeT = 0.6;
      return;
    }
    const t = b.task || { kind: "follow" };
    if (t.kind === "plate") {
      this.plateBot(b, t, dt);
    } else if (t.kind === "down") {
      const e = this.L.floors[this.L.cur + 1].entry;
      this.k.navigate(b, this.k.ccx(e[0]) + t.spot[0], this.k.ccx(e[1]) + t.spot[1], b.speed, dt, false, 10);
    } else if (t.kind === "revive") {
      this.k.navigate(b, t.who.x + (b.x < t.who.x ? -30 : 30), t.who.y + 4, b.speed, dt, false, 10);
    } else { // follow
      const lead = this.members.find(m => m.on && !m.frozen && !this.isBot(m));
      const g = this.frontierGate();
      let gx, gy;
      if (lead) { gx = lead.x; gy = lead.y; }
      else if (g) { gx = this.k.ccx(g.i); gy = this.k.ccx(g.j) - 40; }
      else { gx = b.x; gy = b.y; }
      if (Math.hypot(gx - b.x, gy - b.y) > 150 || !this.k.lineOfSight(b.x, b.y, gx, gy)) {
        this.k.navigate(b, gx, gy, b.speed, dt, false, 110);
      } else { b.moving = false; }
    }
  }

  plateBot(b, t, dt) {
    const p = t.plate; const g = this.L.gates[p.gate];
    if (!t.stage) t.stage = "goto";
    if (t.stage === "press") {
      if (p.kind === "lever") { this.pullLever(p, b); t.stage = "ready"; return; }
      this.k.navigate(b, p.x, p.y, b.speed, dt, false, 6);
      if (p.occ === b) t.stage = "back";
      return;
    }
    if (t.stage === "back") {
      if (this.k.navigate(b, p.rx, p.ry, b.speed, dt, false, 8)) t.stage = "ready";
      return;
    }
    if (this.k.navigate(b, p.rx, p.ry, b.speed, dt, false, 12)) t.stage = "ready";
    else if (Math.hypot(b.x - p.rx, b.y - p.ry) > 40) t.stage = "goto";
    if (t.stage !== "ready") return;
    b.face = (p.kind === "lever" ? p.px : p.x) >= b.x ? 1 : -1;
    if (g.open || (g.spark || 0) > 0) return;
    const othersLive = g.plates.some(q => q !== p && !q.auto && q.power > 0.04);
    if ((othersLive && p.power <= 0) || t.go) {
      t.wait = (t.wait === undefined ? rand(0.15, 0.55) : t.wait) - dt;
      if (t.wait <= 0) { t.stage = "press"; t.wait = undefined; t.go = false; }
    } else { t.wait = undefined; }
  }

  fleeCell(b) {
    if (!this.monsterField) return null;
    const mine = this.k.bfs(...this.k.cellOf(b), false);
    let best = null; let bestScore = -Infinity;
    for (let q = 0; q < mine.length; q++) {
      if (mine[q] < 0 || mine[q] > 5) continue;
      const md = this.monsterField[q] < 0 ? 30 : this.monsterField[q];
      const score = md * 3 - mine[q] + Math.random();
      if (score > bestScore) { bestScore = score; best = q; }
    }
    if (best === null) return null;
    return [best % this.L.COLS, (best / this.L.COLS) | 0];
  }

  // ---- Players' input and the tick ----

  updatePlayers(dt) {
    for (const m of this.members) {
      const pl = this.match.session.players.get(m.name);
      const on = !!(pl && (pl.ws || pl.bot));
      if (on !== m.on) this.setOnline(m.name, on);
      if (!m.on || !pl || pl.bot) continue; // bots are moved by their brain
      const use = pl.act; pl.act = false;
      if (m.frozen || this.phase !== "play") { m.moving = false; continue; }
      const ix = pl.input ? pl.input.x : 0;
      const iy = pl.input ? pl.input.y : 0;
      const l = Math.hypot(ix, iy); m.moving = l > 0.01;
      if (m.moving) {
        const s = PLAYER_SPEED * dt / Math.max(1, l);
        this.k.moveActor(m, ix * s, iy * s);
        if (Math.abs(ix) > 0.01) m.face = Math.sign(ix);
      }
      if (use) { const p = this.leverAt(m); if (p) this.pullLever(p, m); }
    }
  }

  separate() {
    const online = this.members.filter(m => m.on);
    for (let i = 0; i < online.length; i++) {
      for (let j = i + 1; j < online.length; j++) {
        const a = online[i]; const b = online[j];
        const d = dist(a, b);
        if (d < 28 && d > 0) {
          const push = (28 - d) / 2;
          const dx = (a.x - b.x) / d * push;
          const dy = (a.y - b.y) / d * push;
          if (!a.frozen) this.k.moveActor(a, dx, dy);
          if (!b.frozen) this.k.moveActor(b, -dx, -dy);
        }
      }
    }
  }

  update(dt) {
    this.phaseT += dt;
    this.updatePlayers(dt);
    const act = this.active();
    if (!act.length) return; // nobody online: the shaft waits
    if (this.phase === "play") {
      this.think(dt);
      for (const m of this.members) {
        if (m.on && this.isBot(m)) this.updateBot(m, dt);
      }
      this.separate();
      this.updatePlates(dt);
      this.updateMonster(dt);
      this.updateThaw(dt);
      if (act.every(m => m.frozen)) {
        this.phase = "allfrozen"; this.phaseT = 0;
        this.ev({ t: "ev", e: "allfrozen" });
      }
      this.updateWalkDown(dt);
    } else if (this.phase === "allfrozen" && this.phaseT > 5) {
      const at = this.L.floors[this.L.cur].entry;
      this.spawnTeamAt(at[0], at[1]);
      for (const g of this.L.gates) {
        for (const p of g.plates) { p.power = 0; p.armed = true; p.pulled = 0; }
      }
      const d = this.k.bfs(at[0], at[1], true);
      let far = 0; let farD = -1;
      for (let q = 0; q < d.length; q++) { if (d[q] > farD) { farD = d[q]; far = q; } }
      this.placeMonster(far % this.L.COLS, (far / this.L.COLS) | 0, 3);
      this.phase = "play"; this.phaseT = 0;
      this.ev({ t: "ev", e: "again" });
    }
    for (const m of this.members) m.inv = Math.max(0, m.inv - dt);
  }

  // ---- snapshot(): the M message ----

  snapshot() {
    const L = this.L; const M = this.monster;
    const gates = [];
    for (let i = Math.max(0, L.cur - 1); i < L.gates.length; i++) {
      const g = L.gates[i];
      gates.push({
        i,
        o: g.open ? 1 : 0,
        s: g.sealed ? 1 : 0,
        sp: round2(g.spark || 0),
        ow: this.owners(g),
        p: g.plates.map(p => [round3(p.power), round2(p.press), p.occ ? 1 : 0, round2(p.pulled), p.auto ? 1 : 0])
      });
    }
    return {
      t: "M", tm: this.id, cur: L.cur, nf: L.floors.length, lv: this.level,
      ph: this.phase, pt: round1(this.phaseT),
      tr: L.transit ? round1(L.transit.t) : -1,
      ml: Math.max(0, round1(this.match.left)),
      m: this.members.map(m => [
        m.name, round(m.x), round(m.y), m.face,
        (m.frozen ? 1 : 0) | (m.moving ? 2 : 0) | (m.inv > 0 ? 4 : 0) | (m.on ? 8 : 0),
        round2(m.thaw)
      ]),
      mon: [round(M.x), round(M.y), MODES[M.mode] || 0, M.face, M.target ? M.target.name : null],
      g: gates
    };
  }
}

class MazeMatch {
  constructor(session, teams) {
    this.session = session;
    this.seed = (Math.random() * 2 ** 31) | 0;
    this.teams = teams.map((t) => new TeamSim(this, t, this.seed));
    this.left = (session.matchMinutes || MATCH_SECONDS / 60) * 60;
    this.clock = 0; this.over = false; this.boardT = 0;
  }

  clampTeam(n) {
    return clamp(Number.isInteger(n) ? n : 0, 0, this.teams.length - 1);
  }

  memberGone(name) {
    for (const t of this.teams) t.setOnline(name, false);
  }

  replaceMember(botName, name) {
    for (const t of this.teams) {
      if (t.replace(botName, name)) return;
    }
  }

  update(dt) {
    if (this.over) return;
    this.clock += dt; this.left -= dt;
    for (const t of this.teams) t.update(dt);
    if (this.left <= 0) { this.left = 0; this.over = true; }
  }

  snapshot(team) { return this.teams[team].snapshot(); }

  drainEvents() {
    const out = [];
    for (const t of this.teams) {
      for (const e of t.events) out.push([t.id, e]);
      t.events = [];
    }
    return out;
  }

  boardDue() {
    this.boardT -= 1 / 30;
    if (this.boardT > 0) return false;
    this.boardT = 0.5; return true;
  }

  ranked() {
    return [...this.teams].sort((a, b) => {
      if (b.levels !== a.levels) return b.levels - a.levels;
      if (a.reachedAt !== b.reachedAt) return a.reachedAt - b.reachedAt;
      return a.id - b.id;
    });
  }

  board() {
    return {
      t: "board",
      ml: Math.max(0, Math.round(this.left)),
      teams: this.ranked().map(t => ({
        id: t.id, name: t.name, color: t.color,
        members: t.members.map(m => m.name),
        level: t.level, levels: t.levels
      }))
    };
  }

  intro(p) {
    return {
      t: "mintro", seed: this.seed, you: p.team, ml: this.left,
      teams: this.teams.map(t => ({
        id: t.id, name: t.name, color: t.color,
        size: t.size, members: t.members.map(m => m.name)
      }))
    };
  }

  results() { return { t: "over", board: this.board().teams }; }
}

module.exports = { MazeMatch, MATCH_SECONDS };
