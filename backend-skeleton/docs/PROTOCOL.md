# WebSocket protocol

One endpoint: `/ws` (ws:// on HTTP, wss:// on HTTPS). Every message is a **JSON text frame**
with a string field `t` (the type). The server ignores binary frames, unparseable JSON, non
objects and unknown types. The username is **never** sent by the client: it comes from the JWT
checked in the handshake (app/README.md).

Abbreviated field names are deliberate (small messages at 30 Hz). Use exactly these names.

## Limits (server)

- `maxPayload` 4096 bytes.
- Rate limit: a budget of **120 messages per second** per connection, refilled every second.
  Each message spends 1. While the budget is below 0, ignore messages; below **-60**, close with
  code **4008** "too fast".
- If the first message (`host`/`join`) hasn't arrived within **10 s**, close with **4001** "no join".
- Ping every **20 s**; terminate connections that didn't answer the previous ping (`ws.ping()` /
  `"pong"` event with an `isAlive` flag).

## Client → server

| `t` | Fields | When / rules |
|---|---|---|
| `host` | – | first message from `/play?host=1`: create a session, become its host |
| `join` | `code` (string) | first message from `/play?code=X` and `/maze?code=X`; upper-case it; also used on every reconnect |
| `in` | `x`, `y` (numbers −1..1) | movement intent (held keys). Sent on change and every 250 ms. Non-finite → 0; clamp to [−1, 1]. Store as `player.input = {x, y}` |
| `shove` | – | lobby: set `player.shove = true` (one-shot, consumed by the lobby tick) |
| `use` | – | maze: set `player.act = true` (one-shot, "pull the lever here") |
| `start` | – | host only, lobby stage: `lobby.start()` |
| `length` | `min` (2, 3, 4 or 5) | host only, lobby stage, lobby phase `wait`: set the match length in minutes; mark roster changed |
| `bots` | `add` (integer) **or** `clear: true` | host only, lobby stage, lobby phase `wait`: add `clamp(add, 1, 40)` bots (never past 40 players), or remove all bots |
| `watch` | `team` (integer) | maze: which team a spectator watches (`player.watch = team`) |
| `ping` | `c` | reply `{t:"pong", c}` |

Messages from a connection that has been replaced (another tab took over) are ignored.

## Server → client

### Connection and session

| `t` | Fields | Sent |
|---|---|---|
| `hello` | `code`, `you` (your username), `num` (your shirt number), `host` (host's username), `stage` (`"lobby"`, `"maze"` or `"results"`) | right after a successful host/join (and every reconnect) |
| `roster` | `host`, `max` (40), `minutes` (match length), `players`: array of `{n, num, look, on, bot, team}` | right after `hello`, and to everyone whenever the roster changes (join, leave, connect, disconnect, host change, bots, length) |
| `err` | `code`: `"nosession"`, `"full"` or `"elsewhere"` | `nosession`/`full` then close with 4004/4005; `elsewhere` to the **old** connection when the same user connects again, then close it with **4000** |
| `go` | `to`: `"/maze?code=CODE"` or `"/play?code=CODE"` | broadcast when the stage changes; clients navigate there |
| `pong` | `c` | reply to `ping` |

`players[i]`: `n` username, `num` shirt number, `look` outfit object (src/look.js), `on`
connected (bots always `true`), `bot` boolean, `team` team id in the maze or −1.

### Lobby stage

**`L`: lobby snapshot, broadcast to everyone in the session every tick (30 Hz):**

```js
{
  t: "L",
  ph,            // phase: "wait" | "gather" | "allin" | "mad" | "seal" | "done"
  tl,            // gather time left, seconds, 1 decimal, >= 0
  pt,            // seconds in the current phase, 1 decimal
  ca,            // carousel angle, radians, 3 decimals (kept in [0, 2π))
  cs,            // carousel speed, rad/s, 2 decimals
  cap,           // max people per cell
  tc,            // number of open cells (teams)
  live,          // 10 numbers 1/0: which cells are open
  occ,           // 10 numbers: people in each cell
  dr,            // 10 numbers: door open amount × 100, rounded
  fl,            // 10 numbers: door flash time × 10, rounded
  w,             // the Watcher: [x, y, mode (1 = dragging, 0 = home), scale × 100, name of the person it carries or null]
  p,             // people: array of [name, x, y, flags, face]; flags bit 1 = carried, bit 2 = stunned; face 1 | -1
}
```
Positions are rounded to integers.

**`ev` events (broadcast to the session):**

| `e` | Fields | Meaning |
|---|---|---|
| `phase` | `ph` | the lobby phase changed |
| `shove` | `n` (who), `f` (face), `hit` (array of names pushed) | someone shoved |
| `grab` | `n`, `cell` | the Watcher grabbed someone, heading for that cell |
| `drop` | `n`, `cell`, `x`, `y` | the Watcher dropped them in the cell |
| `replaced` | `bot`, `n` | real player `n` took over bot `bot` (sent in either stage) |

### Maze stage

On every (re)connect while the stage is `maze` or `results`, after `hello` and `roster`, send:

**`mintro`:** `{ t:"mintro", seed, you, ml, teams }` where `seed` is the match seed (int),
`you` is your team id (−1 = spectator), `ml` seconds left, and `teams` is an array of
`{ id, name, color, size, members: [usernames] }` in team-id order.

**`M`: maze snapshot, every tick, per team.** Each connected player gets the snapshot of their
own team, or (spectators, team −1) of `clampTeam(player.watch)`. Build each team's snapshot
once per tick (`JSON.stringify` once) and send that string to everyone who needs it.

```js
{
  t: "M",
  tm,     // team id
  cur,    // index of the floor the team is on (L.cur)
  nf,     // number of floors generated so far (L.floors.length)
  lv,     // depth of the current floor (1 = top)
  ph,     // "play" | "allfrozen"
  pt,     // seconds in that phase, 1 decimal
  tr,     // walking-down time since the gate opened, 1 decimal, or -1
  ml,     // match seconds left, 1 decimal, >= 0
  m,      // members, in team order: [name, x, y, face, flags, thaw]
          //   flags: 1 frozen | 2 moving | 4 invulnerable | 8 online ; thaw 0..1, 2 decimals
  mon,    // the Watcher: [x, y, mode, face, targetName|null]; mode 0 sleep, 1 patrol, 2 search, 3 hunt, 4 leave
  g,      // gates from index max(0, cur-1) to the last: [{ i, o, s, sp, ow, p }]
          //   i index, o open 1/0, s sealed 1/0, sp spark (0..1, 2 decimals), ow owner names per station (null = nobody),
          //   p: per station [power (3 decimals), press (2 dec.), occupied 1/0, pulled (2 dec.), auto 1/0]
}
```

**`board`:** every **0.5 s**, broadcast to everyone:
`{ t:"board", ml (whole seconds left), teams: ranked [{ id, name, color, members: [names], level, levels }] }`.
Ranking: most `levels` (floors cleared) first, then earliest `reachedAt`, then lowest id.

**`over`:** once, when the clock hits 0: `{ t:"over", board: <the board's teams array> }`.
14 s later: `{t:"go", to:"/play?code=CODE"}`.

**`ev` events** go only to the clients that receive that team's `M` snapshot:

| `e` | Fields | Meaning |
|---|---|---|
| `lever` | `n`, `g` (gate index), `i` (station index) | `n` pulled a lever |
| `plate` | `g`, `i` | a plate fired |
| `unclick` | `g`, `i` | a station's light ran out |
| `circuit` | `g` | all lights green: the gate is charging |
| `gate` | `g` | the gate opened |
| `banish` | `x`, `y` | the Watcher vanished from the floor (gate opened) |
| `freeze` | `n` | `n` was frozen |
| `thaw` | `n` | `n` was thawed |
| `spotted` | `n` | the Watcher started hunting `n` |
| `gaveup` | – | the Watcher gave up a chase |
| `tele` | `n` | `n` was teleported down (too slow) |
| `floor` | `lv`, `nf` | the team entered floor `lv`; `nf` floors now exist |
| `allfrozen` | – | everyone on the team is frozen (5 s penalty) |
| `again` | – | penalty over, back to the top of the floor |
| `back` | `n` | a disconnected player came back |
