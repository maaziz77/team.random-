# Sessions (`app/src/sessions.js`)

Exports `connect(ws, username)`, `start()` and `sessions` (the Map).

## Constants

```js
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I
const MAX_PLAYERS = 40;
const TICK_HZ = 30;
const LOBBY_GRACE = 15;      // s a disconnected player keeps their place in the lobby
const EMPTY_LIFETIME = 120;  // s a session with no connected humans survives
const RESULTS_TIME = 14;     // s on the results screen before going back to the lobby
const BOT_NAMES = ["Ada", "Bea", "Cal", "Dot", "Eli", "Fay", "Gus", "Hal", "Ivy", "Jo", "Kit", "Lou", "Max", "Ned", "Oz", "Pip",
  "Quin", "Rex", "Sid", "Tia", "Uma", "Vic", "Wes", "Xan", "Yui", "Zed", "Ari", "Bo", "Cy", "Di", "Ed", "Flo", "Gil", "Hux", "Ike", "Jem", "Kai", "Lev", "Mo", "Nia"];
const sessions = new Map();   // code → Session
const sessionOf = new Map();  // username → the Session they're in (one session per user)
const send = (ws, msg) => { if (ws && ws.readyState === 1) ws.send(typeof msg === "string" ? msg : JSON.stringify(msg)); };
```
`newCode()`: 5 random chars from CODE_CHARS, retried until unused.

## The player object

```js
{ name, bot: false|true, num, look: makeLook(), ws: null, offFor: 0, input: { x: 0, y: 0 },
  act: false, shove: false, team: -1, watch: 0 }
```
`num` = the lowest positive integer not used by anyone in the session (`freeNum()`).
`ws` is the live socket or null. Bots never have a socket; they count as online.

## class Session

Fields: `code` (newCode), `host` (username), `players` (Map name → player, insertion order
matters: it's the roster order), `stage` ("lobby" | "maze" | "results"), `matchMinutes = 5`,
`lobby = new LobbySim(this)`, `match = null`, `emptyFor = 0`, `stageT = 0`, `rosterChanged`.
Register in `sessions` on construction.

Helpers: `connected()` = players with a ws (humans only); `bots()`; `humans()`.

### Players

- `newPlayer(name, bot)`: the object above with `num = freeNum()`.
- `addPlayer(name)`: if already a member, return it. Otherwise: if the session has bots,
  `p = replaceBot(name)`; if that returned null (or there are no bots), create
  `newPlayer(name, false)`, add to `players`, and if `stage === "lobby"` call
  `lobby.addPerson(p)`. Mark roster changed. In all cases `sessionOf.set(name, this)`; return p.
- `replaceBot(name)`: pick the bot to replace:
  - maze/results stage with a match: only bots with `team >= 0`; if none, return null (the
    newcomer will spectate).
  - lobby: prefer bots that the Watcher isn't carrying (`!lobby.isCarried(bot.name)`).
  - take the **last** bot of that list.
  Create `newPlayer(name, false)` with the bot's `num` and `team`; delete the bot from `players`,
  add the new player; then `lobby.replacePerson(bot.name, p)` (lobby stage) or
  `match.replaceMember(bot.name, name)` (otherwise). Broadcast
  `{t:"ev", e:"replaced", bot: bot.name, n: name}`. Return p.
- `addBots(n)`: n times, while `players.size < MAX_PLAYERS`: name = `"Bot-" + first BOT_NAMES
  entry not already used` (fallback `"Bot-" + (players.size + 1)`); `newPlayer(name, true)`;
  add to players; `lobby.addPerson(p)`. Mark roster changed.
- `clearBots()`: `removePlayer` every bot.
- `removePlayer(name)`: delete from players and (if it points here) from sessionOf;
  `lobby.removePerson(name)`; `match && match.memberGone(name)`; if it was the host, `pickHost()`;
  mark roster changed.
- `pickHost()`: host = first connected human, else first human, else null.

### Connections

- `attach(p, ws)`: if `p.ws` is another socket: send it `{t:"err", code:"elsewhere"}` and close
  it with 4000. Then `p.ws = ws; p.offFor = 0; p.input = {x:0, y:0}`; mark roster changed;
  send `hello(p)`, then `roster()`; if `stage !== "lobby"` and there is a match, send
  `match.intro(p)`.
- `detach(p, ws)`: only if `p.ws === ws`: `p.ws = null; p.offFor = 0; p.input = {x:0,y:0}`;
  mark roster changed.
- `hello(p)` → `{t:"hello", code, you: p.name, num: p.num, host, stage}`.
- `roster()` → `{t:"roster", host, max: MAX_PLAYERS, minutes: matchMinutes, players: [...players.values()].map(p => ({n: p.name, num: p.num, look: p.look, on: !!(p.ws || p.bot), bot: p.bot, team: p.team}))}`.
- `broadcast(msg)`: stringify once, `send` to every player's ws.
- `onMessage(p, m)`: see docs/PROTOCOL.md (client → server table).

### tick(dt)

```
stageT += dt
for each player p without ws and not a bot:
    p.offFor += dt
    if stage == "lobby" and p.offFor > LOBBY_GRACE: removePlayer(p.name)
if host is set and (host isn't a player, or host has no ws and host.offFor > 5):
    if anyone is connected: host = first connected player; mark roster changed
if nobody is connected: emptyFor += dt; if emptyFor > EMPTY_LIFETIME: destroy(); return
else emptyFor = 0
if rosterChanged: rosterChanged = false; broadcast(roster())

if stage == "lobby":
    lobby.update(dt)
    broadcast every event from lobby.drainEvents()
    broadcast(lobby.snapshot())
    if lobby.done: startMaze(lobby.teams)
else:
    match.update(dt)
    snapshots: for each connected player, team = p.team >= 0 ? p.team : match.clampTeam(p.watch);
               build JSON.stringify(match.snapshot(team)) once per team, send it
    for each [team, event] of match.drainEvents(): send to every player whose (team or watched team) is that team
    if match.boardDue(): broadcast(match.board())
    if stage == "maze" and match.over: stage = "results"; stageT = 0; broadcast(match.results())
    else if stage == "results" and stageT > RESULTS_TIME: backToLobby()
```

- `startMaze(teams)`: every player's `team = -1`, then set `team = t.id` for each member of each
  team; `match = new MazeMatch(this, teams)`; `stage = "maze"; stageT = 0`; mark roster changed;
  broadcast `{t:"go", to:"/maze?code=" + code}`.
- `backToLobby()`: remove every human who isn't connected; every player: `team = -1, watch = 0`;
  `match = null; stage = "lobby"; stageT = 0; lobby = new LobbySim(this)`; `lobby.addPerson(p)`
  for every player (bots included); mark roster changed; broadcast
  `{t:"go", to:"/play?code=" + code}`.
- `destroy()`: delete from `sessions` and remove its players from `sessionOf`.

## connect(ws, user)

```
session = null, player = null
budget = 120; every 1 s: budget = 120               (clear the interval on close)
after 10 s with no player: ws.close(4001, "no join")
ws.isAlive = true; ws.on("pong", () => ws.isAlive = true)

on message (data, isBinary):
    if isBinary or --budget < 0: if budget < -60: ws.close(4008, "too fast"); return
    m = JSON.parse (ignore errors); must be an object with string m.t
    if no player yet:
        if m.t == "host": old = sessionOf.get(user); if old: old.removePlayer(user); session = new Session(user)
        elif m.t == "join":
            code = upper-case m.code (string, else "")
            session = sessions.get(code); if none: send {t:"err", code:"nosession"}; ws.close(4004, "no session"); return
            if user isn't a member and players.size >= MAX_PLAYERS and the session has no bots:
                send {t:"err", code:"full"}; ws.close(4005, "full"); return
            old = sessionOf.get(user); if old and old != session: old.removePlayer(user)
        else: return
        player = session.addPlayer(user); session.attach(player, ws); return
    if session.players.get(user) !== player or player.ws !== ws: return    (replaced/removed)
    session.onMessage(player, m)

on close: clear timers; if session and player: session.detach(player, ws)
on error: nothing (close follows)
```

## start()

- Every `1000 / TICK_HZ` ms: `dt = min(0.1, real seconds since last)`; for every session,
  `try { s.tick(dt) } catch (e) { console.error(...) }` (one broken session must not stop others).
- Every 20 s: for every connected player's ws: if `!ws.isAlive` → `ws.terminate()`; else
  `ws.isAlive = false; ws.ping()`.
