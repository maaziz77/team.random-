"use strict";
// The maze world, shared by the server (which runs the game) and the browser (which draws it).
// Everything here is generated from a seed, so both sides build exactly the same shaft:
// the server only has to send the seed, never the walls.
//
//   MazeWorld(seed, teamId) -> { newWorld, appendFloor, blocked, moveActor, navigate, astar, bfs, ... }
//
// The shaft is endless and grows downward: each floor is a band of rows generated from
// (seed, team, depth) when the team reaches the floor above it.
//   1) a perfect maze by randomised depth-first search (recursive backtracker)
//   2) braiding: some dead ends are knocked through so there are loops (fewer on deeper floors)
//   3) a gate in the bottom wall, the only way down
//   4) stations (levers or plates) placed by repeated BFS so they're far from the way in, the
//      gate and each other, which makes the team split up
//   5) props and lamps in dead ends / against walls
// Pathfinding over the cell graph is A* with a Manhattan heuristic; BFS gives distance fields.
(function (root) {
  const C = 176;          // cell interior size
  const W = 34;           // wall thickness
  const P = C + W;        // cell pitch
  const BODY_R = 14;
  const GATE_COL = ["#ffd23f", "#3fa7ff", "#ff6f86", "#48e28a", "#a47cff"];
  const PROP_KEYS = ["plant", "boxes", "bookshelf", "stool", "cooler", "armchair", "coatrack"];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // same sizes as the wall panels drawn by art.js (the lever stand spot depends on them)
  function panelSize(n, lever) { return { w: Math.max(46, 16 + n * 17) + (lever ? 26 : 0), h: lever ? 44 : 26 }; }

  function MazeWorld(seed, teamId) {
    seed |= 0; teamId |= 0;
    let L = null; // the shaft

    // ---------------------------------------------------------------- tile helpers
    // The maze is a grid of cells. Between and around them is a grid of thin wall tiles, so
    // tile column k is a wall when k is even and a cell column when k is odd.
    const tpos = (k) => Math.floor(k / 2) * P + (k % 2 ? W : 0);
    const tlen = (k) => (k % 2 ? C : W);
    function tileAt(v) { const k = Math.floor(v / P); return v - k * P < W ? 2 * k : 2 * k + 1; }
    const ccx = (i) => i * P + W + C / 2;
    function cellOfXY(x, y) { return [clamp(Math.floor((x - W / 2) / P), 0, L.COLS - 1), clamp(Math.floor((y - W / 2) / P), 0, L.ROWS - 1)]; }
    const cellOf = (a) => cellOfXY(a.x, a.y);
    const cidx = (i, j) => j * L.COLS + i;

    // ---------------------------------------------------------------- the shaft
    // The maze is one endless shaft that grows downward. Each floor is a band of rows across the
    // whole width, generated when the team reaches the floor above it. The only way down is the
    // floor's gate: a doorway in its bottom wall, opened by that floor's circuit. There is no exit;
    // floors just keep getting deeper and harder until the match clock runs out.
    //
    // Everything scales with the team (1–4 players, decided by the lobby) and with depth:
    //   width       3 + team size columns (4–7)
    //   floor rows  4, growing by one every two floors, up to 8
    //   stations    1 + ceil(depth / 2), never more than the team has players
    //   light time  3.4 s, 0.2 s shorter each floor (min 1.6 s), +0.25 s per station above two
    //   loops       60% of dead ends knocked through on floor 1, fewer each floor (min 12%)
    //   the shadow  faster and sharper-eyed each floor, and a little faster on bigger teams
    function floorSpec(depth, size) {
      const need = Math.max(1, Math.min(size, 1 + Math.ceil(depth / 2)));
      return {
        depth, need,
        rows: Math.min(8, 3 + Math.ceil(depth / 2)),
        window: Math.max(1.6, 3.4 - 0.2 * (depth - 1)) + 0.25 * Math.max(0, need - 2),
        braid: Math.max(0.12, 0.6 - 0.06 * (depth - 1)),
        kind: depth % 2 === 1 ? "lever" : "plate",
      };
    }
    const floorSeed = (depth) => (seed + teamId * 104729 + depth * 7919) | 0;
    // Where each floor's way in and gate are depends only on the seed and the depth, so a spectator
    // can rebuild any team's shaft starting from any depth and land in the same place.
    const colRoll = (depth, cols) => Math.floor(mulberry32(floorSeed(depth) ^ 0x5bd1e995)() * cols);
    function entryColOf(depth, cols) { return depth <= 1 ? colRoll(0, cols) : gateColOf(depth - 1, cols); }
    function gateColOf(depth, cols) {
      const entry = entryColOf(depth, cols);
      let g = colRoll(depth, cols);
      if (cols > 2 && g === entry) g = (g + Math.ceil(cols / 2)) % cols; // make them cross the floor
      return g;
    }

    function newWorld(depth0, size) {
      const COLS = clamp(3 + size, 4, 7);
      L = {
        COLS, ROWS: 0, size, eOpen: [], sOpen: [], gates: [], floors: [], props: [], lamps: [],
        obstacles: null, solid: null, gateAt: null, edgeGate: null, runs: [], TW: 0, TH: 0,
        explored: new Uint8Array(0), worldW: COLS * P + W, worldH: W, cur: 0, seed,
      };
      L.obstacles = L.props;
      appendFloor(depth0);
      appendFloor(depth0 + 1);
      return L;
    }

    function appendFloor(depth) {
      const COLS = L.COLS, spec = floorSpec(depth, L.size), ROWS = spec.rows;
      const rnd = mulberry32(floorSeed(depth));
      const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
      const f = L.floors.length, row0 = L.ROWS;
      const entryCol = entryColOf(depth, COLS), gateCol = gateColOf(depth, COLS);

      // local grid for this floor
      const eOpen = Array.from({ length: ROWS }, () => new Array(COLS).fill(false));
      const sOpen = Array.from({ length: ROWS }, () => new Array(COLS).fill(false));
      const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
      const inside = (i, j) => i >= 0 && i < COLS && j >= 0 && j < ROWS;
      const carve = (i, j, d) => { if (d === 0) eOpen[j][i] = true; else if (d === 1) sOpen[j][i] = true; else if (d === 2) eOpen[j][i - 1] = true; else sOpen[j - 1][i] = true; };
      const isOpen = (i, j, d) => d === 0 ? i + 1 < COLS && eOpen[j][i] : d === 1 ? j + 1 < ROWS && sOpen[j][i] : d === 2 ? i > 0 && eOpen[j][i - 1] : j > 0 && sOpen[j - 1][i];

      // 1) a perfect maze (recursive backtracker / randomised DFS)
      const seen = new Uint8Array(COLS * ROWS);
      const stack = [[ri(0, COLS - 1), ri(0, ROWS - 1)]]; seen[stack[0][1] * COLS + stack[0][0]] = 1;
      while (stack.length) {
        const [i, j] = stack[stack.length - 1];
        const opts = [];
        for (let d = 0; d < 4; d++) { const ni = i + DIRS[d][0], nj = j + DIRS[d][1]; if (inside(ni, nj) && !seen[nj * COLS + ni]) opts.push([d, ni, nj]); }
        if (!opts.length) { stack.pop(); continue; }
        const [d, ni, nj] = opts[Math.floor(rnd() * opts.length)];
        carve(i, j, d); seen[nj * COLS + ni] = 1; stack.push([ni, nj]);
      }
      // 2) braiding: knock through some dead ends so there are loops to run around the shadow
      for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
        let deg = 0; for (let d = 0; d < 4; d++) if (isOpen(i, j, d)) deg++;
        if (deg !== 1 || rnd() > spec.braid) continue;
        const opts = []; for (let d = 0; d < 4; d++) { const ni = i + DIRS[d][0], nj = j + DIRS[d][1]; if (inside(ni, nj) && !isOpen(i, j, d)) opts.push(d); }
        if (opts.length) carve(i, j, opts[Math.floor(rnd() * opts.length)]);
      }
      const bfsLocal = (si, sj) => {
        const d = new Int16Array(COLS * ROWS).fill(-1), q = [[si, sj]]; d[sj * COLS + si] = 0;
        for (let h = 0; h < q.length; h++) {
          const [i, j] = q[h];
          for (let k = 0; k < 4; k++) {
            if (!isOpen(i, j, k)) continue;
            const ni = i + DIRS[k][0], nj = j + DIRS[k][1];
            if (d[nj * COLS + ni] < 0) { d[nj * COLS + ni] = d[j * COLS + i] + 1; q.push([ni, nj]); }
          }
        }
        return d;
      };

      // 3) the gate sits in the bottom wall, under the last row
      const gate = {
        f, s: f, depth, i: gateCol, j: row0 + ROWS - 1, open: false, sealed: false, anim: 0, plates: [],
        color: GATE_COL[(depth - 1) % GATE_COL.length], need: spec.need, kind: spec.kind, window: spec.window, yours: null,
      };

      // 4) stations: the first far from both the way in and the gate, the rest as far as possible
      // from those already placed, so the team has to split up. Each sits against a north wall.
      const northWall = (i, j) => j === 0 ? i !== entryCol : !sOpen[j - 1][i];
      const dg = bfsLocal(gateCol, ROWS - 1), de = bfsLocal(entryCol, 0);
      let cells = [];
      for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
        const k = j * COLS + i;
        if ((i === gateCol && j === ROWS - 1) || (i === entryCol && j === 0) || (spec.need > 1 && dg[k] < 2)) continue;
        cells.push(k);
      }
      const walled = cells.filter((k) => northWall(k % COLS, Math.floor(k / COLS)));
      if (walled.length >= spec.need + 1) cells = walled;
      const taken = new Set(), fields = [];
      for (let n = 0; n < spec.need; n++) {
        let best = -1, bs = -1e9;
        for (const k of cells) {
          if (taken.has(k)) continue;
          const score = fields.length ? Math.min(...fields.map((fd) => fd[k])) + rnd() * 1.5 : Math.min(dg[k], de[k]) + rnd() * 2;
          if (score > bs) { bs = score; best = k; }
        }
        if (best < 0) break;
        taken.add(best);
        const li = best % COLS, lj = Math.floor(best / COLS), j = row0 + lj;
        fields.push(bfsLocal(li, lj));
        const wy = j * P + W; // foot of the cell's north wall
        const st = { kind: spec.kind, i: li, j, wall: northWall(li, lj), gate: f, idx: n, occ: null, press: 0, power: 0, armed: true, pulled: 0 };
        if (spec.kind === "lever") {
          // you stand just right of the panel, next to its lever, so you never hide the lights;
          // the panel and the spot are centred in the cell together
          const reach = panelSize(spec.need, true).w / 2 + 16;
          st.px = ccx(li) - reach / 2 + (rnd() - 0.5) * 16; st.py = wy - 24;
          st.x = st.px + reach; st.y = wy + 26; st.rx = st.x; st.ry = st.y + 4;
        } else {
          st.px = ccx(li); st.py = wy - 16;
          st.x = st.px; st.y = wy + 64; st.rx = st.px; st.ry = wy + 140;
        }
        gate.plates.push(st);
      }

      // 5) where the shadow wakes up: the cell furthest from the way in
      let spawn = 0; for (let k = 0; k < de.length; k++) if (de[k] > de[spawn]) spawn = k;

      // 6) props in dead ends, lamps against north walls (never in a doorway)
      for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
        const k = j * COLS + i;
        if (taken.has(k) || (i === entryCol && j === 0) || (i === gateCol && j === ROWS - 1)) continue;
        const ds = []; for (let d = 0; d < 4; d++) if (isOpen(i, j, d)) ds.push(d);
        const gx = ccx(i), gy = ccx(row0 + j);
        if (ds.length === 1 && rnd() < 0.7) {
          const d = ds[0], bx = -DIRS[d][0], by = -DIRS[d][1];
          L.props.push({ key: PROP_KEYS[Math.floor(rnd() * PROP_KEYS.length)], x: gx + bx * (C / 2 - 40) + (by ? (rnd() - 0.5) * 60 : 0), y: gy + by * (C / 2 - 30) + (by < 0 ? 10 : 0) + (bx ? (rnd() - 0.5) * 50 : 0), s: 0.55, r: 26, f });
        } else if (ds.length >= 2 && northWall(i, j) && rnd() < 0.16) {
          const lamp = { key: "lamp", x: gx + (rnd() < 0.5 ? -1 : 1) * (C / 2 - 26), y: gy - C / 2 + 34, s: 0.42, r: 16, lamp: true, f };
          L.props.push(lamp); L.lamps.push(lamp);
        }
      }

      // 7) splice into the shaft: the previous floor's gate opens onto this floor's entry
      for (let j = 0; j < ROWS; j++) { L.eOpen.push(eOpen[j]); L.sOpen.push(sOpen[j]); }
      if (f > 0) L.sOpen[row0 - 1][L.floors[f - 1].gate.i] = true;
      L.ROWS += ROWS;
      L.gates.push(gate);
      L.floors.push({ f, depth, row0, rows: ROWS, entry: [entryCol, row0], spawn: [spawn % COLS, row0 + Math.floor(spawn / COLS)], gate, spec, canvas: null });
      rebuildTiles();
    }
    // wall tiles, gate tiles and drawing runs for the whole shaft (cheap: a few hundred rows at most)
    function rebuildTiles() {
      const COLS = L.COLS, ROWS = L.ROWS, TW = 2 * COLS + 1, TH = 2 * ROWS + 1;
      const solid = new Uint8Array(TW * TH), gateAt = new Int16Array(TW * TH).fill(-1);
      for (let ty = 0; ty < TH; ty++) for (let tx = 0; tx < TW; tx++) {
        const ex = tx % 2 === 0, ey = ty % 2 === 0;
        let s = 0;
        if (ex && ey) s = 1;
        else if (ex) { const i = tx / 2 - 1, j = (ty - 1) / 2; s = i < 0 || i >= COLS - 1 ? 1 : L.eOpen[j][i] ? 0 : 1; }
        else if (ey) { const i = (tx - 1) / 2, j = ty / 2 - 1; s = j < 0 || j >= ROWS - 1 ? 1 : L.sOpen[j][i] ? 0 : 1; }
        solid[ty * TW + tx] = s;
      }
      const edgeGate = new Int16Array(COLS * ROWS).fill(-1);
      L.gates.forEach((g, n) => {
        g.tx = 2 * g.i + 1; g.ty = 2 * (g.j + 1);
        solid[g.ty * TW + g.tx] = 0; gateAt[g.ty * TW + g.tx] = n;
        edgeGate[g.j * COLS + g.i] = n;
      });
      const floorOfRow = (j) => { for (let f = L.floors.length - 1; f >= 0; f--) if (j >= L.floors[f].row0) return L.floors[f]; return L.floors[0]; };
      const runs = [];
      for (let ty = 0; ty < TH; ty++) {
        const fl = floorOfRow(clamp(Math.floor((ty - 1) / 2), 0, ROWS - 1));
        const row = []; let a = -1;
        for (let tx = 0; tx <= TW; tx++) {
          const on = tx < TW && solid[ty * TW + tx] === 1 && gateAt[ty * TW + tx] < 0;
          if (on && a < 0) a = tx;
          if (!on && a >= 0) { row.push({ a, b: tx - 1, sec: fl.depth - 1 }); a = -1; }
        }
        runs.push(row);
      }
      const explored = new Uint8Array(COLS * ROWS); explored.set(L.explored.subarray(0, Math.min(L.explored.length, explored.length)));
      Object.assign(L, { TW, TH, solid, gateAt, edgeGate, runs, explored, worldH: ROWS * P + W });
    }

    // ---------------------------------------------------------------- collision
    function solidT(tx, ty, ghost) {
      if (ty < 0 || ty >= L.TH || tx < 0) return true;
      if (tx >= L.TW) return true;
      const k = ty * L.TW + tx, g = L.gateAt[k];
      if (g >= 0) { const gt = L.gates[g]; return !gt.open || gt.sealed; } // the shadow can't pass a shut gate either
      return L.solid[k] === 1;
    }
    // walls only (gates are bars you can see through)
    function wallT(tx, ty) {
      if (ty < 0 || ty >= L.TH || tx < 0 || tx >= L.TW) return true;
      const k = ty * L.TW + tx;
      return L.gateAt[k] < 0 && L.solid[k] === 1;
    }
    function blocked(x, y, r, ghost) {
      const tx0 = tileAt(x - r), tx1 = tileAt(x + r), ty0 = tileAt(y - r), ty1 = tileAt(y + r);
      for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
        if (!solidT(tx, ty, ghost)) continue;
        const rx = tpos(tx), ry = tpos(ty);
        const qx = clamp(x, rx, rx + tlen(tx)), qy = clamp(y, ry, ry + tlen(ty));
        if ((x - qx) ** 2 + (y - qy) ** 2 < r * r) return true;
      }
      if (!ghost) for (const p of L.obstacles) if ((x - p.x) ** 2 + (y - p.y) ** 2 < (r + p.r) ** 2) return true;
      return false;
    }
    function moveActor(a, dx, dy, ghost = false, r = BODY_R) {
      const nx = a.x + dx, ny = a.y + dy;
      if (!blocked(nx, ny, r, ghost)) { a.x = nx; a.y = ny; return true; }
      if (Math.abs(dx) > 0.01 && !blocked(nx, a.y, r, ghost)) { a.x = nx; return false; }
      if (Math.abs(dy) > 0.01 && !blocked(a.x, ny, r, ghost)) { a.y = ny; return false; }
      // nudge round a corner
      const m = Math.hypot(dx, dy) * 0.8;
      for (const s of [1, -1]) {
        if (Math.abs(dx) >= Math.abs(dy)) { if (!blocked(a.x + dx * 0.5, a.y + s * m, r, ghost)) { a.x += dx * 0.5; a.y += s * m; return false; } }
        else if (!blocked(a.x + s * m, a.y + dy * 0.5, r, ghost)) { a.x += s * m; a.y += dy * 0.5; return false; }
      }
      return false;
    }
    function lineOfSight(x1, y1, x2, y2) {
      const d = Math.hypot(x2 - x1, y2 - y1), n = Math.ceil(d / 14);
      for (let k = 1; k < n; k++) {
        const x = lerp(x1, x2, k / n), y = lerp(y1, y2, k / n);
        if (wallT(tileAt(x), tileAt(y))) return false;
      }
      return true;
    }

    // ---------------------------------------------------------------- graph search
    // gates sit on south edges (the way down to the next floor)
    function passEdge(i, j) { const g = L.edgeGate[j * L.COLS + i]; return g < 0 || (L.gates[g].open && !L.gates[g].sealed); }
    function neighbors(i, j, ghost, out) {
      out.length = 0;
      if (i + 1 < L.COLS && L.eOpen[j][i]) out.push(i + 1, j);
      if (i > 0 && L.eOpen[j][i - 1]) out.push(i - 1, j);
      if (j + 1 < L.ROWS && L.sOpen[j][i] && passEdge(i, j)) out.push(i, j + 1);
      if (j > 0 && L.sOpen[j - 1][i] && passEdge(i, j - 1)) out.push(i, j - 1);
    }
    const nbBuf = [];
    function bfs(si, sj, ghost) {
      const N = L.COLS * L.ROWS, d = new Int16Array(N).fill(-1);
      const q = [cidx(si, sj)]; d[q[0]] = 0;
      for (let h = 0; h < q.length; h++) {
        const k = q[h];
        neighbors(k % L.COLS, (k / L.COLS) | 0, ghost, nbBuf);
        for (let n = 0; n < nbBuf.length; n += 2) { const m = cidx(nbBuf[n], nbBuf[n + 1]); if (d[m] < 0) { d[m] = d[k] + 1; q.push(m); } }
      }
      return d;
    }
    const stats = { astarCalls: 0, astarExpanded: 0, lastExpanded: 0 };
    function astar(si, sj, ti, tj, ghost) {
      const COLS = L.COLS, N = COLS * L.ROWS, start = cidx(si, sj), goal = cidx(ti, tj);
      if (start === goal) return [];
      const g = new Float32Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
      const h = (k) => Math.abs((k % COLS) - ti) + Math.abs(((k / COLS) | 0) - tj);
      const open = [start]; g[start] = 0;
      const nb = [];
      let exp = 0;
      while (open.length) {
        let bi = 0, bf = g[open[0]] + h(open[0]);
        for (let q = 1; q < open.length; q++) { const f = g[open[q]] + h(open[q]); if (f < bf) { bf = f; bi = q; } }
        const k = open[bi]; open[bi] = open[open.length - 1]; open.pop();
        if (closed[k]) continue;
        closed[k] = 1; exp++;
        if (k === goal) break;
        neighbors(k % COLS, (k / COLS) | 0, ghost, nb);
        for (let q = 0; q < nb.length; q += 2) {
          const n = cidx(nb[q], nb[q + 1]);
          if (closed[n]) continue;
          const ng = g[k] + 1;
          if (ng < g[n]) { g[n] = ng; from[n] = k; open.push(n); }
        }
      }
      stats.astarCalls++; stats.astarExpanded += exp; stats.lastExpanded = exp;
      if (from[goal] < 0) return null;
      const path = [];
      for (let k = goal; k !== start; k = from[k]) path.push([k % COLS, (k / COLS) | 0]);
      return path.reverse();
    }


    // walk toward a point using A* over the cell graph when it's in another cell
    function navigate(a, gx, gy, speed, dt, ghost = false, stop = 8, r = BODY_R) {
      const d = Math.hypot(gx - a.x, gy - a.y);
      if (d <= stop) { a.moving = false; return true; }
      const [ci, cj] = cellOf(a), [ti, tj] = cellOfXY(gx, gy);
      let tx = gx, ty = gy;
      if (ci !== ti || cj !== tj) {
        a.pathT -= dt;
        const goal = cidx(ti, tj);
        if (!a.path || a.pathT <= 0 || a.pathGoal !== goal) { a.path = astar(ci, cj, ti, tj, ghost); a.pathT = 0.5; a.pathGoal = goal; }
        if (!a.path) { a.moving = false; return false; }
        while (a.path.length && a.path[0][0] === ci && a.path[0][1] === cj) a.path.shift();
        if (a.path.length) { tx = ccx(a.path[0][0]); ty = ccx(a.path[0][1]); }
      } else a.path = null;
      let dx = tx - a.x, dy = ty - a.y;
      const l = Math.hypot(dx, dy) || 1;
      dx /= l; dy /= l;
      const step = Math.min(speed * dt, d);
      const ox = a.x, oy = a.y;
      moveActor(a, dx * step, dy * step, ghost, r);
      if (Math.abs(dx) > 0.15) a.face = Math.sign(dx);
      a.moving = true; a.walk += dt;
      // unstick: if we barely moved, drop the path so it is rebuilt
      if (Math.hypot(a.x - ox, a.y - oy) < step * 0.2) {
        a.stuck += dt;
        if (a.stuck > 0.6) {
          // wedged on a corner or a prop: step back toward the middle of the cell and re-plan
          a.path = null; a.stuck = 0;
          const mx = ccx(ci) - a.x, my = ccx(cj) - a.y, ml = Math.hypot(mx, my) || 1;
          moveActor(a, (mx / ml) * 14 + rand(-4, 4), (my / ml) * 14 + rand(-4, 4), ghost, r);
        }
      }
      else a.stuck = 0;
      return false;
    }

    return {
      get L() { return L; }, newWorld, appendFloor, floorSpec,
      tpos, tlen, tileAt, ccx, cellOfXY, cellOf, cidx,
      solidT, wallT, blocked, moveActor, lineOfSight, passEdge, neighbors, bfs, astar, navigate, stats,
    };
  }

  const api = { MazeWorld, C, W, P, BODY_R, GATE_COL, PROP_KEYS, mulberry32, panelSize };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Maze = api;
})(typeof window !== "undefined" ? window : globalThis);
