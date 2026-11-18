"use strict";
// the three how-to cards on the lobby's entry screen (kept out of the page so there's no inline script)
Ui.howto(document.getElementById("howto"), [
  { scene: "mingle", title: "Hang out", text: "Ride the spinning floor or walk off it. The host starts the clock.", color: "#1fae95" },
  { scene: "number", title: "Pick a cell", text: "Walk into a cell to join that team. Full cells won't let you in.", color: "#ffb000" },
  { scene: "locked", title: "Don't go AFK", text: "You get <b>20 seconds</b>. Then the Watcher drags you into the emptiest cell.", color: "#ff4b5c" },
]);
