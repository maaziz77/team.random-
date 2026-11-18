"use strict";
// Random outfits. Copied verbatim from app/public/art.js (the section from "// shirts: [main, shade]."
// to just before "// ---- rig"), so every client draws the same outfit for each player.
const INK = "#1d1b26";
const lerp = (a, b, t) => a + (b - a) * t;

// shirts: [main, shade]. Teal is listed several times so it stays the most common colour.
const SHIRTS = [
  ["#1fae95", "#168a76"], ["#1fae95", "#168a76"], ["#2ec4b6", "#1f9488"], ["#0f8f86", "#0b6d66"],
  ["#ff6f86", "#d94f67"], ["#ffb000", "#cf8d00"], ["#3fa7ff", "#2a7fd0"], ["#9b6bff", "#7a4fd6"],
  ["#ff7a3d", "#d65e27"], ["#43c47a", "#2f9a5c"], ["#f4efe6", "#d3ccbf"], ["#ef5da8", "#c4447f"],
  ["#5b7bff", "#4058cc"], ["#e8d36a", "#c2ad47"],
];
const ACCENTS = ["#fbf6ec", "#ffd23f", "#ff4b5c", "#1d1b26", "#3fa7ff", "#48e28a", "#ff9ec7", "#9b6bff"];
const PANTS = ["#2b2d4a", "#3b5b8c", "#4a3f63", "#1d1b26", "#6b5a45", "#5c6378", "#2f6f6a"];
const SHOES = ["#1d1b26", "#fbf6ec", "#ff4b5c", "#ffd23f", "#3fa7ff", "#8b5a3c"];
const STYLES = ["tee", "tee", "stripes", "raglan", "hoodie", "overalls", "jacket"];
const HAIR = ["none", "cap", "side", "spiky", "bun", "curly", "bowl", "long", "mohawk"];
const HAIR_COL = ["#6b4226", "#2a2321", "#c8642b", "#e0b04a", "#9c9a99", "#3b2a20", "#7a4a2a", "#ff8fb1", "#4fb3ff"];
const HATS = ["beanie", "headband", "headphones", "bow", "flower"];
const GREY = { shirt: "#8b86a3", shade: "#6d6885", accent: "#b9b4cc", pants: "#5d5873", shoes: "#4a4560", hatCol: "#a9a4bd", neckCol: "#a9a4bd", packCol: "#7b7693" };

function makeLook(rnd = Math.random) {
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const chance = (p) => rnd() < p;
  const [shirt, shade] = pick(SHIRTS);
  let accent = pick(ACCENTS); if (accent === shirt) accent = INK;
  const L = {
    shirt, shade, accent, style: pick(STYLES),
    pants: pick(PANTS), shorts: chance(0.25), shoes: pick(SHOES),
    hair: pick(HAIR), hairCol: pick(HAIR_COL.slice(0, rnd() < 0.85 ? 7 : 9)),
    hat: chance(0.38) ? pick(HATS) : null, hatCol: pick(ACCENTS.concat(SHIRTS.map((s) => s[0]))),
    glasses: chance(0.16) ? "round" : chance(0.08) ? "shades" : null,
    blush: chance(0.3), freckles: chance(0.12), bandaid: chance(0.08), mustache: chance(0.06),
    neck: chance(0.12) ? "scarf" : chance(0.1) ? "bowtie" : null, neckCol: pick(ACCENTS.concat(["#ff6f86", "#ffb000"])),
    backpack: chance(0.18), packCol: pick(SHIRTS)[0],
    tall: lerp(0.94, 1.08, rnd()), build: lerp(0.92, 1.1, rnd()),
  };
  if (L.hat === "beanie" && ["bun", "mohawk", "spiky", "cap"].includes(L.hair)) L.hair = "side";
  if (L.hat === "headphones" && L.hair === "cap") L.hair = "bowl";
  if (L.style === "hoodie" && L.neck === "scarf") L.neck = null;
  return L;
}


module.exports = { makeLook };
