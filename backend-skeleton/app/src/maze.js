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

const MON_R = 20;
const THAW_TIME = 2.0;
const WALK_TIME = 10;
const MATCH_SECONDS = 300;
const PLAYER_SPEED = 215;
const OFFS = [[-30,-30],[30,-30],[-30,30],[30,30],[0,-48],[0,48],[-56,0],[56,0]];
const MODES = { sleep: 0, patrol: 1, search: 2, hunt: 3, leave: 4 };

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const round = (v) => Math.round(v);
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
    this.members = team.members.map((name) => this.newMember(name));
    this.thinkT = 0;
    this.monsterField = null;
    this.monster = {
      x: -5000, y: -5000, mode: "sleep", timer: Infinity, path: null, pathT: 0, pathGoal: -1,
      target: null, lastSeen: null, lost: 0, dest: null, face: 1, stuck: 0, huntT: 0,
    };
    this.phase = "play";
    this.phaseT = 0;
    this.spawnTeamAt(...this.L.floors[0].entry);
  }

  get L() { return this.k.L; }

  newMember(name) {
    return {
      name, x: 0, y: 0, face: 1, frozen: false, thaw: 0, inv: 0, moving: false, on: true, act: false,
      task: null, path: null, pathT: 0, pathGoal: -1, stuck: 0, fleeT: 0, react: 0, fleeGoal: null,
      speed: rand(184, 192), walk: 0,
    };
  }

  isBot(m) {
    const pl = this.match.session && this.match.session.players && this.match.session.players.get(m.name);
    return !!(pl && pl.bot === true);
  }

  ev(e) { this.events.push(e); }

  active() { return this.members.filter((m) => m.on === true); }

  frontierGate() { return this.L.gates.find((g) => !g.open) || null; }

  spawnTeamAt(ci, cj) {
    this.members.forEach((m, n) => {
      m.x = this.k.ccx(ci) + OFFS[n % 8][0];
      m.y = this.k.ccx(cj) + OFFS[n % 8][1];
      m.frozen = false; m.thaw = 0; m.inv = 2;
    });
  }

  placeMonster(ci, cj, sleep) {
    this.monster.x = this.k.ccx(ci);
    this.monster.y = this.k.ccx(cj) + 20;
    this.monster.mode = "sleep"; this.monster.timer = sleep;
    this.monster.path = this.monster.target = this.monster.dest = null;
    this.monster.huntT = 0;
  }

  setOnline(name, on) {
    const m = this.members.find((p) => p.name === name);
    if (!m || m.on === on) return;
    m.on = on;
    if (on) {
      const idx = this.members.indexOf(m);
      const at = this.L.floors[this.L.cur].entry;
      m.x = this.k.ccx(at[0]) + OFFS[idx % 8][0];
      m.y = this.k.ccx(at[1]) + OFFS[idx % 8][1];
      m.frozen = false; m.thaw = 0; m.inv = 2;
      this.ev({ t: "ev", e: "back", n: name });
    } else {
      m.frozen = false; m.moving = false;
      if (this.monster.target === m) {
        this.monster.target = null; this.monster.mode = "patrol"; this.monster.dest = null;
      }
    }
  }

  banishMonster() {
    if (this.monster.x > -1000) {
      this.ev({ t: "ev", e: "banish", x: round(this.monster.x), y: round(this.monster.y) });
    }
    this.monster.x = this.monster.y = -5000;
    this.monster.mode = "sleep"; this.monster.timer = Infinity;
    this.monster.path = this.monster.target = this.monster.dest = null;
    this.members.forEach((m) => {
      if (m.frozen) { m.frozen = false; m.thaw = 0; m.inv = 1.5; }
    });
  }

  belowGate(m) {
    return m.y > this.L.floors[this.L.cur + 1].row0 * P + W + BODY_R + 4;
  }

  updateWalkDown(dt) {
    if (!this.L.transit) return;
    this.L.transit.t += dt;
    const nf = this.L.floors[this.L.cur + 1];
    if (this.L.transit.t > WALK_TIME) {
      this.active().forEach((m) => {
        if (!this.belowGate(m)) {
          const n = this.members.indexOf(m);
          m.x = this.k.ccx(nf.entry[0]) + OFFS[n % 8][0];
          m.y = this.k.ccx(nf.entry[1]) + OFFS[n % 8][1];
          this.ev({ t: "ev", e: "tele", n: m.name });
        }
      });
    }
    if (this.active().every((m) => this.belowGate(m))) this.enterFloor(this.L.cur + 1);
  }

  enterFloor(f) {
    const fl = this.L.floors[f];
    this.L.cur = f; this.level = fl.depth; this.levels++; this.reachedAt = this.match.clock;
    this.members.forEach((m) => { m.frozen = false; m.thaw = 0; m.inv = 1.5; });
    this.L.transit = null;
    this.L.gates[f - 1].sealed = true;
    this.members.forEach((m, n) => {
      if (this.k.blocked(m.x, m.y, BODY_R, true)) {
        m.x = this.k.ccx(fl.entry[0]) + OFFS[n % 8][0];
        m.y = this.k.ccx(fl.entry[1]) + OFFS[n % 8][1];
      }
    });
    this.k.appendFloor(fl.depth + 1);
    this.L.props = this.L.props.filter((p) => p.f >= f - 1);
    this.L.obstacles = this.L.props;
    this.L.lamps = this.L.lamps.filter((p) => p.f >= f - 1);
    this.placeMonster(fl.spawn[0], fl.spawn[1], 6);
    this.ev({ t: "ev", e: "floor", lv: this.level, nf: this.L.floors.length });
  }

  owners(g) {
    const act = this.active();
    return g.plates.map((p) => (act[p.idx] ? act[p.idx].name : null));
  }

  pullLever(p, who) {
    const g = this.L.gates[p.gate];
    if (g.open || g.spark > 0 || p.power > 0) return false;
    p.power = 1; p.pulled = 1;
    who.face = p.px >= who.x ? 1 : -1;
    if (typeof this.noise === "function") this.noise(p.x, p.y, 5);
    this.ev({ t: "ev", e: "lever", n: who.name, g: p.gate, i: p.idx });
    return true;
  }

  leverAt(m) {
    if (m.frozen || this.phase !== "play") return null;
    const g = this.frontierGate();
    if (!g || g.kind !== "lever") return null;
    let nearest = null, nearestD = Infinity;
    g.plates.forEach((p) => {
      const d = Math.hypot(p.x - m.x, p.y - m.y);
      if (d < 64 && d < nearestD) { nearest = p; nearestD = d; }
    });
    return nearest;
  }

  updatePlates(dt) {
    const act = this.active();
    this.L.gates.forEach((g) => {
      if (g.sealed) return;
      const own = this.owners(g);
      if (g.spark > 0 && !g.open) {
        g.spark += dt / 0.8;
        if (g.spark >= 1) this.openGate(g);
      }
      g.plates.forEach((p) => {
        p.auto = !g.open && !own[p.idx];
        if (p.kind === "plate") {
          p.occ = act.find((m) => !m.frozen && Math.hypot(p.x - m.x, p.y - m.y) < 38) || null;
          p.press = clamp(p.press + (p.occ ? dt * 10 : -dt * 6), 0, 1);
          if (!g.open && !(g.spark > 0) && p.occ && p.armed) {
            p.power = 1; p.armed = false;
            if (typeof this.noise === "function") this.noise(p.x, p.y, 5);
            this.ev({ t: "ev", e: "plate", g: p.gate, i: p.idx });
          }
          if (!p.occ) p.armed = true;
        }
        if (p.auto) p.power = 1;
        else if (!(g.spark > 0)) {
          const was = p.power;
          p.power = Math.max(0, p.power - dt / g.window);
          if (was > 0 && p.power <= 0 && !g.open) {
            this.ev({ t: "ev", e: "unclick", g: p.gate, i: p.idx });
          }
        }
        p.pulled = g.open ? 1 : p.auto ? 1 : p.power;
      });
      if (!g.open && !(g.spark > 0) && g.plates.length && g.plates.every((p) => p.power > 0)) {
        g.spark = 0.001;
        this.ev({ t: "ev", e: "circuit", g: g.f });
      }
    });
  }

  openGate(g) {
    g.open = true; g.spark = 0;
    if (typeof this.noise === "function") this.noise(this.k.ccx(g.i), this.k.ccx(g.j), 12);
    this.ev({ t: "ev", e: "gate", g: g.f });
    if (g.f === this.L.cur) {
      this.banishMonster();
      this.L.transit = { t: 0 };
    }
  }

  updatePlayers(dt) {
    this.members.forEach((m) => {
      const pl = this.match.session && this.match.session.players && this.match.session.players.get(m.name);
      const on = !!(pl && (pl.ws || pl.bot));
      if (on !== m.on) this.setOnline(m.name, on);
      if (!m.on || !pl || pl.bot) return;
      const use = pl.act; pl.act = false;
      if (m.frozen || this.phase !== "play") { m.moving = false; return; }
      const inp = pl.input;
      const ix = Array.isArray(inp) ? (inp[0] || 0) : (inp && Number.isFinite(inp.x) ? inp.x : 0);
      const iy = Array.isArray(inp) ? (inp[1] || 0) : (inp && Number.isFinite(inp.y) ? inp.y : 0);
      const l = Math.hypot(ix, iy);
      m.moving = l > 0.01;
      if (m.moving) {
        const s = PLAYER_SPEED * dt / Math.max(1, l);
        this.k.moveActor(m, ix * s, iy * s);
        if (Math.abs(ix) > 0.01) m.face = Math.sign(ix);
      }
      if (use) {
        const p = this.leverAt(m);
        if (p) this.pullLever(p, m);
      }
    });
  }

  separate() {
    const act = this.active();
    for (let i = 0; i < act.length; i++) {
      const a = act[i];
      if (a.frozen) continue;
      for (let j = i + 1; j < act.length; j++) {
        const b = act[j];
        if (b.frozen) continue;
        const d = dist(a, b);
        if (d < 28) {
          const push = (28 - d) / 2;
          if (d === 0) {
            this.k.moveActor(a, -push, 0);
            this.k.moveActor(b, push, 0);
          } else {
            const dx = (b.x - a.x) / d, dy = (b.y - a.y) / d;
            this.k.moveActor(a, -dx * push, -dy * push);
            this.k.moveActor(b, dx * push, dy * push);
          }
        }
      }
    }
  }

  // TODO (task #8): noise, speeds, randomPatrolCell, sendAway, updateMonster, updateThaw
  // TODO (task #9): think, updateBot, plateBot, fleeCell
  replace(botName, name) { void botName; void name; return false; } // TODO (task #9)

  update(dt) {
    this.phaseT += dt;
    this.updatePlayers(dt);
    const act = this.active();
    if (!act.length) return;
    if (this.phase === "play") {
      if (typeof this.think === "function") this.think(dt);
      this.members.forEach((m) => {
        if (m.on && this.isBot(m) && typeof this.updateBot === "function") this.updateBot(m, dt);
      });
      this.separate();
      this.updatePlates(dt);
      if (typeof this.updateMonster === "function") this.updateMonster(dt);
      if (typeof this.updateThaw === "function") this.updateThaw(dt);
      if (this.active().every((m) => m.frozen)) {
        this.phase = "allfrozen"; this.phaseT = 0;
        this.ev({ t: "ev", e: "allfrozen" });
      }
      this.updateWalkDown(dt);
    } else if (this.phase === "allfrozen" && this.phaseT > 5) {
      const at = this.L.floors[this.L.cur].entry;
      this.spawnTeamAt(at[0], at[1]);
      this.L.gates.forEach((g) => g.plates.forEach((p) => { p.power = 0; p.armed = true; p.pulled = 0; }));
      const d = this.k.bfs(at[0], at[1], true);
      let far = 0;
      for (let i = 1; i < d.length; i++) if (d[i] > d[far]) far = i;
      this.placeMonster(far % this.L.COLS, (far / this.L.COLS) | 0, 3);
      this.phase = "play"; this.phaseT = 0;
      this.ev({ t: "ev", e: "again" });
    }
    this.members.forEach((m) => { m.inv = Math.max(0, m.inv - dt); });
  }

  snapshot() {
    const gates = [];
    for (let i = Math.max(0, this.L.cur - 1); i < this.L.gates.length; i++) {
      const g = this.L.gates[i];
      gates.push({
        i,
        o: g.open ? 1 : 0,
        s: g.sealed ? 1 : 0,
        sp: round2(g.spark || 0),
        ow: this.owners(g),
        p: g.plates.map((p) => [round3(p.power), round2(p.press), p.occ ? 1 : 0, round2(p.pulled), p.auto ? 1 : 0]),
      });
    }
    return {
      t: "M",
      tm: this.id,
      cur: this.L.cur,
      nf: this.L.floors.length,
      lv: this.level,
      ph: this.phase,
      pt: round1(this.phaseT),
      tr: this.L.transit ? round1(this.L.transit.t) : -1,
      ml: Math.max(0, round1(this.match.left)),
      m: this.members.map((m) => [
        m.name, round(m.x), round(m.y), m.face,
        (m.frozen ? 1 : 0) | (m.moving ? 2 : 0) | (m.inv > 0 ? 4 : 0) | (m.on ? 8 : 0),
        round2(m.thaw),
      ]),
      mon: [
        round(this.monster.x), round(this.monster.y),
        MODES[this.monster.mode] || 0, this.monster.face,
        this.monster.target ? this.monster.target.name : null,
      ],
      g: gates,
    };
  }
}

class MazeMatch {
  constructor(session, teams) {
    this.session = session;
    this.seed = (Math.random() * 2 ** 31) | 0;
    this.teams = teams.map((t) => new TeamSim(this, t, this.seed));
    this.left = (session.matchMinutes || 5) * 60;
    this.clock = 0;
    this.over = false;
    this.boardT = 0;
  }

  // TODO (task #9): replaceMember
  clampTeam(n) { return clamp(Number.isInteger(n) ? n : 0, 0, this.teams.length - 1); }

  memberGone(name) { this.teams.forEach((team) => team.setOnline(name, false)); }

  replaceMember(botName, name) { void botName; void name; return false; }

  update(dt) {
    if (this.over) return;
    this.clock += dt; this.left -= dt;
    this.teams.forEach((team) => team.update(dt));
    if (this.left <= 0) { this.left = 0; this.over = true; }
  }

  snapshot(team) { return this.teams[this.clampTeam(team)].snapshot(); }

  drainEvents() {
    const out = [];
    this.teams.forEach((team) => {
      team.events.forEach((event) => out.push([team.id, event]));
      team.events = [];
    });
    return out;
  }

  boardDue() {
    this.boardT -= 1 / 30;
    if (this.boardT > 0) return false;
    this.boardT = 0.5;
    return true;
  }

  ranked() {
    return this.teams.slice().sort((a, b) =>
      b.levels - a.levels ||
      a.reachedAt - b.reachedAt ||
      a.id - b.id
    );
  }

  board() {
    return {
      t: "board",
      ml: Math.max(0, round(this.left)),
      teams: this.ranked().map((t) => ({
        id: t.id, name: t.name, color: t.color,
        members: t.members.map((m) => m.name),
        level: t.level, levels: t.levels,
      })),
    };
  }

  intro(p) {
    return {
      t: "mintro",
      seed: this.seed,
      you: p.team,
      ml: this.left,
      teams: this.teams.map((t) => ({
        id: t.id, name: t.name, color: t.color, size: t.size,
        members: t.members.map((m) => m.name),
      })),
    };
  }

  results() { return { t: "over", board: this.board().teams }; }
}

module.exports = { MazeMatch, MATCH_SECONDS };