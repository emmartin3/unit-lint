import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from './config.js';
import { DEFAULT_DURATION_KEYS, DEFAULT_SIZE_KEYS } from './lint.js';

function withConfig(contents: string, run: (path: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'unit-lint-config-'));
  const path = join(dir, 'unit-lint.config.json');
  writeFileSync(path, contents);
  try {
    run(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('loadConfig: throws with the path in the message when the file is missing', () => {
  assert.throws(() => loadConfig('/no/such/unit-lint.config.json'), /could not read config/);
});

test('loadConfig: throws on invalid JSON', () => {
  withConfig('{ not json', (path) => {
    assert.throws(() => loadConfig(path), /could not parse config/);
  });
});

test('loadConfig: throws when the top level is not an object', () => {
  withConfig('[1, 2, 3]', (path) => {
    assert.throws(() => loadConfig(path), /config must be a JSON object/);
  });
});

test('loadConfig: an empty object produces no options', () => {
  withConfig('{}', (path) => {
    assert.deepEqual(loadConfig(path), {});
  });
});

test('loadConfig: durationKeys extends the built-in list', () => {
  withConfig('{"durationKeys": ["pollEvery"]}', (path) => {
    const options = loadConfig(path);
    assert.ok(options.durationKeys?.includes('pollEvery'));
    for (const key of DEFAULT_DURATION_KEYS) {
      assert.ok(options.durationKeys?.includes(key));
    }
  });
});

test('loadConfig: sizeKeys extends the built-in list without duplicates', () => {
  withConfig('{"sizeKeys": ["pageSize", "limit"]}', (path) => {
    const options = loadConfig(path);
    assert.ok(options.sizeKeys?.includes('pageSize'));
    const occurrences = options.sizeKeys?.filter((key) => key === 'limit').length;
    assert.equal(occurrences, 1);
    assert.equal(options.sizeKeys?.length, DEFAULT_SIZE_KEYS.length + 1);
  });
});

test('loadConfig: rejects a non-array durationKeys', () => {
  withConfig('{"durationKeys": "timeout"}', (path) => {
    assert.throws(() => loadConfig(path), /"durationKeys" must be an array of strings/);
  });
});

test('loadConfig: rejects a durationKeys array with a non-string entry', () => {
  withConfig('{"durationKeys": ["timeout", 5]}', (path) => {
    assert.throws(() => loadConfig(path), /"durationKeys" must be an array of strings/);
  });
});

test('loadConfig: severities maps known rules to a severity', () => {
  withConfig('{"severities": {"bare-size-value": "error"}}', (path) => {
    const options = loadConfig(path);
    assert.deepEqual(options.severities, { 'bare-size-value': 'error' });
  });
});

test('loadConfig: rejects an unknown rule name in severities', () => {
  withConfig('{"severities": {"not-a-real-rule": "error"}}', (path) => {
    assert.throws(() => loadConfig(path), /unknown rule "not-a-real-rule" in "severities"/);
  });
});

test('loadConfig: rejects a severity value that is not "error" or "warning"', () => {
  withConfig('{"severities": {"bare-size-value": "critical"}}', (path) => {
    assert.throws(() => loadConfig(path), /severity for "bare-size-value" must be "error" or "warning"/);
  });
});

test('loadConfig: rejects an unknown top-level field', () => {
  withConfig('{"durationKeys": ["timeout"], "extra": true}', (path) => {
    assert.throws(() => loadConfig(path), /unknown config field\(s\): extra/);
  });
});

test('loadConfig: error messages are prefixed with the config path', () => {
  withConfig('{"sizeKeys": 5}', (path) => {
    assert.throws(() => loadConfig(path), new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: `));
  });
});
