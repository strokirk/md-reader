// Generates a synthetic library of assorted Markdown "RPG books" for manual
// performance and functional testing (search latency, scroll perf, offline
// behaviour) against a realistic ~6 MB corpus without needing real content.
//
// Usage: node scripts/gen-test-corpus.mjs <out-dir> [totalMB]
import { writeFileSync, mkdirSync } from "node:fs";

const [outDir, totalMBArg] = process.argv.slice(2);
if (!outDir) {
  console.error("usage: node scripts/gen-test-corpus.mjs <out-dir> [totalMB]");
  process.exit(1);
}
const totalMB = totalMBArg ? Number(totalMBArg) : 6;

const words =
  "the of and to in a is that for it as with on be by this are from or an at which have not were but had their they has one you all his her will more when who there been if would out so up said what its about into than them can only other new some time these two may then do first any my now such like our over man me even most made after also did many before must through back years where much your way well down should because each just those people mr how too little state good very make world still own see men work long get here between both life being under never day same another know while last might us great old year off come since against go came right used take three states himself few house use during without again place American around however home small found Mrs thought went say part once general high upon school every don't does got united left number course war until always away something fact though water less public put think almost hand enough far took head yet government system better set told nothing night end why called didn't eyes find going look asked later knew point next program city business give group toward young days let room president side social given present several order national possible rather second face per often brought whose".split(
    /\s+/,
  );
const rpg = [
  "grapple",
  "Strength",
  "Dexterity",
  "fireball",
  "saving throw",
  "initiative",
  "hit points",
  "armour class",
  "goblin",
  "dragon",
  "wizard",
  "cleric",
  "rogue",
  "d20",
  "d6",
  "spell slot",
  "concentration",
  "advantage",
  "disadvantage",
  "opportunity attack",
  "stealth",
  "perception",
  "ritual",
  "undead",
  "longsword",
  "shield",
  "potion of healing",
  "dungeon",
  "trap",
  "treasure",
];

function rnd(n) {
  return Math.floor(Math.random() * n);
}
function sentence() {
  const len = 6 + rnd(14);
  const s = [];
  for (let i = 0; i < len; i++)
    s.push(Math.random() < 0.08 ? rpg[rnd(rpg.length)] : words[rnd(words.length)]);
  const t = s.join(" ");
  return t[0].toUpperCase() + t.slice(1) + ".";
}
function para() {
  const n = 2 + rnd(5);
  const p = [];
  for (let i = 0; i < n; i++) p.push(sentence());
  return p.join(" ");
}
function book(title, targetBytes) {
  let out = `# ${title}\n\n${para()}\n\n`;
  let ch = 0;
  while (out.length < targetBytes) {
    ch++;
    out += `## Chapter ${ch}: ${sentence().slice(0, -1)}\n\n${para()}\n\n`;
    const secs = 2 + rnd(5);
    for (let s = 1; s <= secs; s++) {
      out += `### ${rpg[rnd(rpg.length)][0].toUpperCase() + rpg[rnd(rpg.length)].slice(1)} ${s}\n\n`;
      const blocks = 2 + rnd(6);
      for (let b = 0; b < blocks; b++) {
        const r = Math.random();
        if (r < 0.6) out += para() + "\n\n";
        else if (r < 0.75) out += `- ${sentence()}\n- ${sentence()}\n- ${sentence()}\n\n`;
        else if (r < 0.85) out += `> ${sentence()}\n> ${sentence()}\n\n`;
        else if (r < 0.93)
          out += `| Name | Cost | Damage |\n| --- | --- | --- |\n| ${rpg[rnd(rpg.length)]} | ${rnd(50)} gp | 1d${[4, 6, 8, 10, 12][rnd(5)]} |\n| ${rpg[rnd(rpg.length)]} | ${rnd(50)} gp | 2d6 |\n\n`;
        else out += "```\n" + sentence() + "\n" + sentence() + "\n```\n\n";
        if (Math.random() < 0.1) out += `#### ${sentence().slice(0, 30)}\n\n${para()}\n\n`;
      }
    }
  }
  return out;
}

// Proportioned to add up to roughly `totalMB`, split across a "core" and
// "expansions" subfolder plus a couple of small files, to exercise nested
// import paths and mixed file sizes.
const scale = totalMB / 6;
const specs = [
  ["core/Players Handbook.md", 2.6e6 * scale],
  ["core/Monster Manual.md", 1.4e6 * scale],
  ["core/Dungeon Masters Guide.md", 1.2e6 * scale],
  ["expansions/Sea of Fallen Stars.md", 4e5 * scale],
  ["expansions/Tome of Beasts.md", 3e5 * scale],
  ["expansions/notes.md", 2e4 * scale],
  ["README.md", 3e3 * scale],
];
let total = 0;
for (const [name, size] of specs) {
  const path = `${outDir}/${name}`;
  mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  const b = book(name.split("/").pop().replace(".md", ""), size);
  writeFileSync(path, b);
  total += b.length;
}
console.log(`wrote ${(total / 1e6).toFixed(1)} MB across ${specs.length} files to ${outDir}`);
