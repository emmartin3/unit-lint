import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintText } from './lint.js';

function rules(findings: ReturnType<typeof lintText>): string[] {
  return findings.map((f) => f.rule);
}

test('bare-duration-value: flags a known key assigned a bare number', () => {
  const findings = lintText('f', 'timeout: 30000\n');
  assert.deepEqual(rules(findings), ['bare-duration-value']);
  assert.equal(findings[0].line, 1);
  assert.equal(findings[0].column, 1);
  assert.match(findings[0].message, /30000/);
});

test('bare-duration-value: a trailing unit suffix is not a bare number', () => {
  const findings = lintText('f', 'timeout: 30000ms\n');
  assert.deepEqual(findings, []);
});

test('bare-duration-value: key matching requires a word boundary', () => {
  // "mySize" contains "size" but isn't the standalone word, so it must not match.
  const findings = lintText('f', 'mySize: 100\n');
  assert.deepEqual(findings, []);
});

test('bare-size-value: flags a known key assigned a bare number', () => {
  const findings = lintText('f', 'buffer: 4096\n');
  assert.deepEqual(rules(findings), ['bare-size-value']);
  assert.match(findings[0].message, /4096/);
});

test('unknown-unit: suggests the likely intended unit', () => {
  const findings = lintText('f', 'upload: 200MG\n');
  assert.deepEqual(rules(findings), ['unknown-unit']);
  assert.equal(findings[0].severity, 'error');
  assert.match(findings[0].message, /'MG' looks like a typo for 'MB'/);
});

test('unknown-unit: recognizes borrowed time abbreviations', () => {
  const findings = lintText('f', 'value = 10HRS\n');
  assert.deepEqual(rules(findings), ['unknown-unit']);
  assert.match(findings[0].message, /looks like a typo for 'h'/);
});

test('mixed-unit-style: flags the minority convention only', () => {
  const findings = lintText('f', '500MB\n200GB\n2GiB\n');
  assert.deepEqual(rules(findings), ['mixed-unit-style']);
  assert.equal(findings[0].line, 3);
  assert.match(findings[0].message, /binary convention.*mostly uses decimal/);
});

test('mixed-unit-style: a single occurrence is not a mix', () => {
  const findings = lintText('f', '500MB\n');
  assert.deepEqual(findings, []);
});

test('byte-size-precision-loss: flags a value past MAX_SAFE_INTEGER', () => {
  const findings = lintText('f', '9PiB\n');
  assert.deepEqual(rules(findings), ['byte-size-precision-loss']);
  assert.match(findings[0].message, /10133099161583616/);
});

test('byte unit pattern requires a word boundary before the number', () => {
  // "x500MB" is one identifier-like token, not the number 500 followed by a unit.
  const findings = lintText('f', 'x500MB\n');
  assert.deepEqual(findings, []);
});

test('disable-line with no rule list suppresses every finding on that line', () => {
  const findings = lintText('f', 'timeout: 30000  # unit-lint-disable-line\n');
  assert.deepEqual(findings, []);
});

test('disable-next-line suppresses findings on the following line', () => {
  const findings = lintText('f', '# unit-lint-disable-next-line\ntimeout: 30000\n');
  assert.deepEqual(findings, []);
});

test('disable-line with a rule list only suppresses that rule', () => {
  const suppressed = lintText('f', 'upload: 200MG  # unit-lint-disable-line:unknown-unit\n');
  assert.deepEqual(suppressed, []);

  const untouched = lintText('f', 'upload: 200MG  # unit-lint-disable-line:bare-size-value\n');
  assert.deepEqual(rules(untouched), ['unknown-unit']);
});

test('disable-line ignores rule names it does not recognize', () => {
  const findings = lintText('f', 'upload: 200MG  # unit-lint-disable-line:not-a-real-rule\n');
  assert.deepEqual(rules(findings), ['unknown-unit']);
});

test('options.durationKeys replaces rather than extends the default list', () => {
  // Merging a config file's keys with the defaults happens in config.ts (mergeKeys);
  // lintText itself just uses whatever list it's given.
  const findings = lintText('f', 'pollEvery: 5000\ntimeout: 5000\n', {
    durationKeys: ['pollEvery'],
  });
  assert.deepEqual(rules(findings), ['bare-duration-value']);
  assert.equal(findings[0].line, 1);
});

test('severities option overrides a rule default', () => {
  const findings = lintText('f', 'timeout: 30000\n', {
    severities: { 'bare-duration-value': 'error' },
  });
  assert.equal(findings[0].severity, 'error');
});
