'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { roll } = require('../dice');

// Deterministic "dice" that return values from a list.
const seq = (...vals) => { let i = 0; return () => vals[i++ % vals.length]; };

test('basic roll with modifier', () => {
  const r = roll('2d6+3', seq(4, 5));
  assert.strictEqual(r.total, 12);
  assert.strictEqual(r.notation, '2d6+3');
});

test('spaces, implicit count, subtraction', () => {
  const r = roll('d20 + 1d4 - 2', seq(10, 3));
  assert.strictEqual(r.total, 11);
  assert.strictEqual(r.notation, '1d20+1d4-2');
});

test('advantage keeps the highest and reports the natural roll', () => {
  const r = roll('adv', seq(4, 20));
  assert.strictEqual(r.total, 20);
  assert.strictEqual(r.nat, 20);
  assert.deepStrictEqual(r.parts[0].kept, [false, true]);
});

test('disadvantage keeps the lowest', () => {
  assert.strictEqual(roll('dis', seq(15, 1)).total, 1);
});

test('4d6 drop lowest', () => {
  assert.strictEqual(roll('4d6dl1', seq(1, 6, 3, 4)).total, 13);
  assert.strictEqual(roll('4d6kh3', seq(1, 6, 3, 4)).total, 13);
});

test('d% is a d100', () => {
  assert.strictEqual(roll('d%', seq(77)).parts[0].sides, 100);
});

test('real rolls stay in range', () => {
  for (let i = 0; i < 500; i++) {
    const t = roll('1d20').total;
    assert.ok(t >= 1 && t <= 20);
  }
});

test('rejects garbage and huge rolls', () => {
  for (const bad of ['', 'hello', '1d20 5', '1000d6', '1d1', '2d6+', 'd20d20']) {
    assert.throws(() => roll(bad), undefined, bad);
  }
});
