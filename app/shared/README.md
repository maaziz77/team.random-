# `app/shared/mazeworld.js` (from the frontend zip, added by task #7; never edit)

The seeded maze generator, collision and pathfinding. The **browser** loads it from
`/shared/mazeworld.js` to draw the walls; the **server** `require`s it to run the game. Because
every floor is generated from (match seed, team id, depth) with a seeded PRNG, both sides build
identical shafts: the server only ever sends the seed.

```js
const { MazeWorld, C, W, P, BODY_R, GATE_COL, PROP_KEYS, mulberry32, panelSize } = require("../shared/mazeworld");
// C = 176 cell interior, W = 34 wall thickness, P = 210 cell pitch, BODY_R = 14
const k = MazeWorld(seed, teamId);   // one per team
k.newWorld(1, teamSize);             // builds floors 1 and 2; k.L is the shaft
k.appendFloor(depth);                // generate the next floor (always call with lastFloor.depth + 1)
```

**Call order matters for determinism**: the server must call `newWorld(1, size)` once and then
`appendFloor(L.floors[L.floors.length-1].depth + 1)` exactly when the team enters a floor
(docs/MAZE.md → `enterFloor`). The browser replays the same calls from `cur`/`nf` in snapshots.

## `k.L` (the shaft)

| Field | Meaning |
|---|---|
| `COLS`, `ROWS` | grid size in cells (`COLS = clamp(3 + teamSize, 4, 7)`; rows grow as floors are added) |
| `size` | team size it was built for |
| `floors[]` | `{ f, depth, row0, rows, entry: [col, row], spawn: [col, row], gate, spec }` (`spec`: `{depth, need, rows, window, braid, kind}`) |
| `gates[]` | one per floor: `{ f, depth, i, j, tx, ty, open, sealed, plates: [stations], color, need, kind, window }`; add `spark` yourself (starts undefined → treat as 0) |
| `cur` | index of the floor the team is on (you update it) |
| `transit` | not set by the module: the server sets `L.transit = { t }` while walking down |
| `props`, `lamps`, `obstacles` | decoration; `obstacles` (= props) also block movement |

A **station** (`gate.plates[n]`): `{ kind: "lever"|"plate", i, j, wall, gate (index), idx (n),
occ: null, press: 0, power: 0, armed: true, pulled: 0, px, py (light panel position), x, y
(lever stand spot / plate centre), rx, ry (where a bot waits) }`.

## Functions on `k`

| Function | Use |
|---|---|
| `ccx(i)` | centre coordinate of cell column/row `i` (works for x and y) |
| `cellOf(obj)`, `cellOfXY(x, y)` | `[col, row]` of a position |
| `cidx(i, j)` | flat cell index `j * COLS + i` |
| `blocked(x, y, r, ghost)` | true if a circle overlaps a wall/shut gate (ghost = ignore props) |
| `moveActor(obj, dx, dy, ghost = false, r = BODY_R)` | move with collision and corner-sliding; mutates `obj.x/y` |
| `lineOfSight(x1, y1, x2, y2)` | no wall between (gates don't block sight) |
| `bfs(i, j, ghost)` | Int16Array of steps from cell (i, j) to every cell (−1 unreachable); shut/sealed gates block |
| `astar(si, sj, ti, tj, ghost)` | path `[[i, j], ...]` (empty if same cell, null if unreachable); Manhattan heuristic |
| `navigate(obj, gx, gy, speed, dt, ghost = false, stop = 8, r = BODY_R)` | walk toward a point using A* between cells (re-planned every 0.5 s), un-sticks itself; returns true when within `stop` px. Uses/sets `obj.path, pathT, pathGoal, stuck, moving, face, walk` |
| `neighbors(i, j, ghost, out)` | open neighbouring cells |
| `floorSpec(depth, size)` | the floor's parameters |

Floor parameters (`floorSpec`): `need = max(1, min(size, 1 + ceil(depth/2)))` stations;
`rows = min(8, 3 + ceil(depth/2))`; light `window = max(1.6, 3.4 − 0.2(depth−1)) + 0.25·max(0, need−2)` s;
`braid = max(0.12, 0.6 − 0.06(depth−1))`; `kind` = lever on odd depths, plate on even.
