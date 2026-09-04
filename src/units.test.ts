import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseByteSize, parseDuration } from './units.js';

test('parseByteSize: decimal unit', () => {
  const parsed = parseByteSize('500MB');
  assert.deepEqual(parsed, { value: 500, unit: 'MB', bytes: 500_000_000, standard: 'decimal' });
});

test('parseByteSize: binary unit', () => {
  const parsed = parseByteSize('2GiB');
  assert.deepEqual(parsed, { value: 2, unit: 'GiB', bytes: 2 * 1024 ** 3, standard: 'binary' });
});

test('parseByteSize: exact units (B, byte, bytes) never count as decimal or binary', () => {
  assert.equal(parseByteSize('10B')?.standard, 'exact');
  assert.equal(parseByteSize('1byte')?.standard, 'exact');
  assert.equal(parseByteSize('5 bytes')?.bytes, 5);
});

test('parseByteSize: whitespace between value and unit is allowed', () => {
  const parsed = parseByteSize('12 KB');
  assert.equal(parsed?.bytes, 12_000);
});

test('parseByteSize: unit lookup is case-insensitive', () => {
  const parsed = parseByteSize('5kb');
  assert.deepEqual(parsed, { value: 5, unit: 'kb', bytes: 5000, standard: 'decimal' });
});

test('parseByteSize: fractional values', () => {
  const parsed = parseByteSize('1.5GB');
  assert.equal(parsed?.bytes, 1_500_000_000);
});

test('parseByteSize: rejects an unrecognized unit', () => {
  assert.equal(parseByteSize('12XB'), null);
});

test('parseByteSize: rejects a value with no unit', () => {
  assert.equal(parseByteSize('500'), null);
});

test('parseByteSize: rejects a unit with no value', () => {
  assert.equal(parseByteSize('MB'), null);
});

test('parseByteSize: rejects trailing garbage after the unit', () => {
  assert.equal(parseByteSize('500MB extra'), null);
});

test('parseDuration: single unit', () => {
  const parsed = parseDuration('30s');
  assert.deepEqual(parsed, { milliseconds: 30_000, parts: [{ value: 30, unit: 's' }] });
});

test('parseDuration: compound tokens sum in order', () => {
  const parsed = parseDuration('1h30m');
  assert.equal(parsed?.milliseconds, 3_600_000 + 1_800_000);
  assert.deepEqual(parsed?.parts, [
    { value: 1, unit: 'h' },
    { value: 30, unit: 'm' },
  ]);
});

test('parseDuration: a gap between tokens is not a clean duration literal', () => {
  assert.equal(parseDuration('1h 30m'), null);
});

test('parseDuration: micro units, ASCII and unicode spelling agree', () => {
  assert.equal(parseDuration('5us')?.milliseconds, 0.005);
  assert.equal(parseDuration('5µs')?.milliseconds, 0.005);
});

test('parseDuration: rejects an unrecognized unit', () => {
  assert.equal(parseDuration('10x'), null);
});

test('parseDuration: rejects empty and whitespace-only input', () => {
  assert.equal(parseDuration(''), null);
  assert.equal(parseDuration('   '), null);
});

test('parseDuration: rejects trailing words after a valid token', () => {
  assert.equal(parseDuration('5 apples 3h'), null);
});

test('parseDuration: rejects a leading sign', () => {
  assert.equal(parseDuration('-5s'), null);
});
