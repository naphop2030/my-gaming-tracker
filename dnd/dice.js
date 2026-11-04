'use strict';
// Dice expression parser and roller.
// Supports: d20, 2d6+3, 1d8+1d6-1, d%, 4d6kh3 (keep highest), 2d20kl1 (keep lowest),
// 4d6dl1 (drop lowest), 4d6dh1 (drop highest), and the shortcuts "adv" / "dis".
const crypto = require('crypto');

const MAX_DICE = 200;
const defaultRng = (sides) => crypto.randomInt(1, sides + 1);

const TERM = /^([+-]?)(?:(\d*)d(\d+|%)(?:(kh|kl|dh|dl|k)(\d+))?|(\d+))/;

function roll(expr, rng = defaultRng) {
  if (/[\dd%]\s+[\dd]/i.test(String(expr ?? ''))) {
    throw new Error(`Can't read the roll "${expr}". Put + or - between parts, like 1d20+5.`);
  }
  let src = String(expr ?? '').toLowerCase().replace(/\s+/g, '');
  if (src === 'adv') src = '2d20kh1';
  if (src === 'dis') src = '2d20kl1';
  if (!src) throw new Error('Nothing to roll');
  if (src.length > 100) throw new Error('That roll is too long');

  let rest = src;
  let total = 0;
  let diceCount = 0;
  const parts = [];

  while (rest.length) {
    const m = TERM.exec(rest);
    if (!m || m[0] === '' || (parts.length && !m[1])) {
      throw new Error(`Can't read the roll "${expr}". Try something like 1d20+5 or 2d6.`);
    }
    rest = rest.slice(m[0].length);
    const sign = m[1] === '-' ? -1 : 1;

    if (m[6] !== undefined) {
      const n = Number(m[6]);
      if (n > 100000) throw new Error('That number is too big');
      total += sign * n;
      parts.push({ sign, value: n });
      continue;
    }

    const count = m[2] === '' ? 1 : Number(m[2]);
    const sides = m[3] === '%' ? 100 : Number(m[3]);
    if (count < 1 || count > 100) throw new Error('You can roll 1 to 100 dice at a time');
    if (sides < 2 || sides > 1000) throw new Error('Dice need between 2 and 1000 sides');
    diceCount += count;
    if (diceCount > MAX_DICE) throw new Error(`Too many dice (max ${MAX_DICE})`);

    const rolls = Array.from({ length: count }, () => rng(sides));
    const kept = rolls.map(() => true);
    let suffix = '';
    if (m[4]) {
      const n = Number(m[5]);
      const mode = m[4] === 'k' ? 'kh' : m[4];
      suffix = mode + n;
      // Indexes ordered from lowest to highest roll.
      const order = rolls.map((r, i) => i).sort((a, b) => rolls[a] - rolls[b]);
      let drop = [];
      if (mode === 'kh') drop = order.slice(0, Math.max(0, count - n));
      if (mode === 'kl') drop = order.slice(Math.min(count, n));
      if (mode === 'dl') drop = order.slice(0, Math.min(count, n));
      if (mode === 'dh') drop = order.slice(Math.max(0, count - n));
      for (const i of drop) kept[i] = false;
    }
    const sum = rolls.reduce((acc, r, i) => acc + (kept[i] ? r : 0), 0);
    total += sign * sum;
    parts.push({ sign, notation: `${count}d${sides}${suffix}`, sides, rolls, kept });
  }

  const notation = parts
    .map((p, i) => (p.sign < 0 ? '-' : i ? '+' : '') + (p.notation ?? p.value))
    .join('');

  // Natural result of a single kept d20, for crit / fumble highlighting.
  let nat = null;
  const d20s = parts.filter((p) => p.sides === 20);
  if (d20s.length === 1) {
    const keptRolls = d20s[0].rolls.filter((r, i) => d20s[0].kept[i]);
    if (keptRolls.length === 1) nat = keptRolls[0];
  }

  return { notation, total, parts, nat };
}

module.exports = { roll };
