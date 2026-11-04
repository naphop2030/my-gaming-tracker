'use strict';
// Copies the icons the game uses out of a clone of https://github.com/game-icons/icons
// into public/art/icons/, turning them into single-color stencils (the game colors them with CSS),
// and writes public/art/CREDITS.md.
//
//   git clone --depth 1 https://github.com/game-icons/icons.git /tmp/game-icons
//   node scripts/import-icons.js /tmp/game-icons
const fs = require('fs');
const path = require('path');

const ICONS = {
  // classes
  fighter: 'lorc/visored-helm', rogue: 'darkzaitzev/hooded-assassin', wizard: 'delapouite/wizard-face', cleric: 'cathelineau/nun-face',
  // monsters
  wolf: 'lorc/wolf-head', spider: 'carl-olsen/spider-face', bandit: 'delapouite/bandit', vesh: 'delapouite/pirate-captain',
  zombie: 'delapouite/shambling-zombie', skeleton: 'skoll/skeleton', cultist: 'skoll/cultist', priest: 'lorc/fire-silhouette',
  // items
  potion: 'delapouite/health-potion', 'abbey-key': 'lorc/key', 'moon-charm': 'lucasms/necklace', 'choir-note': 'lorc/scroll-unfurled', gold: 'delapouite/two-coins',
  // actions
  attack: 'lorc/broadsword', backstab: 'lorc/backstab', 'second-wind': 'zeromancer/heart-plus', 'fire-bolt': 'lorc/fireball',
  'magic-missile': 'lorc/magic-swirl', 'sacred-flame': 'lorc/holy-symbol', 'cure-wounds': 'delapouite/healing', defend: 'lorc/shield-reflect', flee: 'lorc/run',
  // places
  thornwick: 'delapouite/village', 'old-road': 'delapouite/stone-path', whisperwood: 'delapouite/forest', hollow: 'delapouite/hut',
  watchtower: 'lorc/stone-tower', greyfen: 'delapouite/swamp', crypt: 'delapouite/crypt-entrance', abbey: 'delapouite/church',
  // interface
  d20: 'delapouite/dice-twenty-faces-twenty', 'd20-one': 'delapouite/dice-twenty-faces-one', combat: 'lorc/crossed-swords', level: 'lorc/laurel-crown',
  camp: 'lorc/campfire', map: 'lorc/treasure-map', journal: 'lorc/open-book', bell: 'lorc/ringing-bell', skull: 'sbed/death-skull', inn: 'delapouite/tavern-sign',
};

const AUTHORS = {
  lorc: 'Lorc', delapouite: 'Delapouite', darkzaitzev: 'DarkZaitzev', cathelineau: 'Cathelineau', 'carl-olsen': 'Carl Olsen',
  skoll: 'Skoll', lucasms: 'Lucas', zeromancer: 'Zeromancer (CC0)', sbed: 'Sbed',
};

const src = process.argv[2];
if (!src) { console.error('Usage: node scripts/import-icons.js <path to game-icons clone>'); process.exit(1); }
const out = path.join(__dirname, '..', 'public', 'art', 'icons');
fs.mkdirSync(out, { recursive: true });
const byAuthor = {};
for (const [name, file] of Object.entries(ICONS)) {
  let svg = fs.readFileSync(path.join(src, `${file}.svg`), 'utf8');
  svg = svg.replace('<path d="M0 0h512v512H0z"/>', '').replace(/ fill="#fff"/g, '');
  fs.writeFileSync(path.join(out, `${name}.svg`), svg);
  const author = file.split('/')[0];
  (byAuthor[AUTHORS[author] || author] ||= []).push(file.split('/')[1]);
}
const credits = [
  '# Art credits',
  '',
  '## Icons',
  '',
  'Icons from [game-icons.net](https://game-icons.net), licensed under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)',
  '(Zeromancer\'s are CC0). Each icon had its black background removed so the game can recolor it.',
  '',
  ...Object.entries(byAuthor).map(([a, list]) => `- Icons made by **${a}**: ${list.sort().join(', ')}`),
  '',
  '## Location scenes',
  '',
  'The location backgrounds in `public/art/scenes.js` were drawn for this project as code (SVG) and are free to use with the game.',
  '',
].join('\n');
fs.writeFileSync(path.join(__dirname, '..', 'public', 'art', 'CREDITS.md'), credits);
console.log(`Wrote ${Object.keys(ICONS).length} icons and CREDITS.md`);
