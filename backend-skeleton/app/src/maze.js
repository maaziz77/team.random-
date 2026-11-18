"use strict";
// ============================================================================================
// STUB: the maze match. Spec: docs/MAZE.md (and docs/BOTS.md).
//   task #7: TeamSim players, stations, gates, walking down, floors + MazeMatch (clock, board)
//   task #8: the Watcher (noise, speeds, sendAway, updateMonster, updateThaw, the penalty)
//   task #9: maze bots (think, updateBot, plateBot, fleeCell, replace)
// Keep the class, method and export names: sessions.js calls them. This file can be built and
// tested on its own with a fake session object before sessions.js exists.
// ============================================================================================
// TODO (task #7): add app/shared/mazeworld.js from the frontend zip (unchanged), then uncomment:
// const { MazeWorld, C, W, P, BODY_R } = require("../shared/mazeworld"); // see app/shared/README.md
// (it stays commented until then so the app starts without it)

// TODO (task #7): MON_R, THAW_TIME, WALK_TIME, PLAYER_SPEED, OFFS, MODES (docs/MAZE.md)
const MATCH_SECONDS = 300;

class TeamSim {
  constructor(match, team, seed) {
    this.match = match; this.id = team.id; this.name = team.name; this.color = team.color;
    this.size = team.members.length; this.level = 1; this.levels = 0; this.reachedAt = 0;
    this.events = [];
    void seed;
    // TODO (task #7): this.k = MazeWorld(seed, team.id); this.k.newWorld(1, size); members; monster; phase ...
  }
  // TODO (task #7): get L, newMember, isBot, ev, active, frontierGate, spawnTeamAt, placeMonster,
  //   setOnline, banishMonster, belowGate, updateWalkDown, enterFloor,
  //   owners, pullLever, leverAt, updatePlates, openGate, updatePlayers, separate
  // TODO (task #8): noise, speeds, randomPatrolCell, sendAway, updateMonster, updateThaw
  // TODO (task #9): think, updateBot, plateBot, fleeCell
  setOnline(name, on) { void name; void on; }
  replace(botName, name) { void botName; void name; return false; } // TODO (task #9)
  update(dt) { void dt; }                                              // TODO (task #7)
  snapshot() { return { t: "M", tm: this.id }; }                       // TODO (task #7): docs/PROTOCOL.md
}

class MazeMatch {
  constructor(session, teams) {
    this.session = session;
    this.seed = (Math.random() * 2 ** 31) | 0;
    this.teams = teams.map((t) => new TeamSim(this, t, this.seed));
    this.left = (session.matchMinutes || MATCH_SECONDS / 60) * 60; this.clock = 0; this.over = false;
  }
  // TODO (task #7): clampTeam, memberGone, update, snapshot, drainEvents, boardDue, ranked, board, intro, results
  // TODO (task #9): replaceMember
  clampTeam(n) { void n; return 0; }
  memberGone(name) { void name; }
  replaceMember(botName, name) { void botName; void name; }
  update(dt) { void dt; }
  snapshot(team) { return this.teams[team].snapshot(); }
  drainEvents() { return []; }
  boardDue() { return false; }
  board() { return { t: "board", ml: 0, teams: [] }; }
  intro(p) { return { t: "mintro", seed: this.seed, you: p.team, ml: this.left, teams: [] }; }
  results() { return { t: "over", board: [] }; }
}

module.exports = { MazeMatch, MATCH_SECONDS };
