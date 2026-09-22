import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { main } from './cli.js';

function withTree(build: (dir: string) => void, run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'unit-lint-cli-'));
  try {
    build(dir);
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// main() writes to console.log/error rather than returning output, so tests capture
// both streams while it runs and restore the originals no matter how the test ends.
function captureOutput(run: () => number): { exitCode: number; stdout: string; stderr: string } {
  const originalLog = console.log;
  const originalError = console.error;
  const stdout: string[] = [];
  const stderr: string[] = [];
  console.log = (...args: unknown[]) => {
    stdout.push(args.join(' '));
  };
  console.error = (...args: unknown[]) => {
    stderr.push(args.join(' '));
  };
  try {
    const exitCode = run();
    return { exitCode, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

test('main: no arguments prints usage and exits 1', () => {
  const { exitCode, stderr } = captureOutput(() => main([]));
  assert.equal(exitCode, 1);
  assert.match(stderr, /^usage: unit-lint/);
});

test('main: --config with no following path exits 1', () => {
  const { exitCode, stderr } = captureOutput(() => main(['--config']));
  assert.equal(exitCode, 1);
  assert.match(stderr, /--config requires a path/);
});

test('main: a clean file exits 0 and reports no problems', () => {
  withTree(
    (dir) => {
      writeFileSync(join(dir, 'clean.txt'), 'nothing to see here\n');
    },
    (dir) => {
      const { exitCode, stdout } = captureOutput(() => main([join(dir, 'clean.txt')]));
      assert.equal(exitCode, 0);
      assert.match(stdout, /no problems found/);
    }
  );
});

test('main: a file that does not exist exits 1 with a read error', () => {
  const { exitCode, stderr } = captureOutput(() => main([join(tmpdir(), 'unit-lint-missing-file.txt')]));
  assert.equal(exitCode, 1);
  assert.match(stderr, /could not read/);
});

test('main: an error-severity finding exits 1', () => {
  withTree(
    (dir) => {
      writeFileSync(join(dir, 'typo.txt'), 'download size: 10MG\n');
    },
    (dir) => {
      const { exitCode, stdout } = captureOutput(() => main([join(dir, 'typo.txt')]));
      assert.equal(exitCode, 1);
      assert.match(stdout, /unknown-unit/);
    }
  );
});

test('main: a warning-only finding exits 0', () => {
  withTree(
    (dir) => {
      writeFileSync(join(dir, 'warn.txt'), 'timeout: 30000\n');
    },
    (dir) => {
      const { exitCode, stdout } = captureOutput(() => main([join(dir, 'warn.txt')]));
      assert.equal(exitCode, 0);
      assert.match(stdout, /bare-duration-value/);
    }
  );
});

test('main: --json prints findings as parseable JSON', () => {
  withTree(
    (dir) => {
      writeFileSync(join(dir, 'typo.txt'), 'download size: 10MG\n');
    },
    (dir) => {
      const file = join(dir, 'typo.txt');
      const { stdout } = captureOutput(() => main(['--json', file]));
      const findings = JSON.parse(stdout);
      assert.equal(findings.length, 1);
      assert.equal(findings[0].rule, 'unknown-unit');
      assert.equal(findings[0].file, file);
    }
  );
});

test('main: --fix rewrites the file and re-lints the result', () => {
  withTree(
    (dir) => {
      writeFileSync(join(dir, 'typo.txt'), 'download size: 10MG\n');
    },
    (dir) => {
      const file = join(dir, 'typo.txt');
      const { exitCode, stdout } = captureOutput(() => main(['--fix', file]));
      assert.match(stdout, /fixed 1 issue\(s\)/);
      assert.equal(readFileSync(file, 'utf8'), 'download size: 10MB\n');
      assert.equal(exitCode, 0);
    }
  );
});

test('main: --config applies custom size keys from the config file', () => {
  withTree(
    (dir) => {
      writeFileSync(join(dir, 'unit-lint.config.json'), '{"sizeKeys": ["pageSize"]}');
      writeFileSync(join(dir, 'data.txt'), 'pageSize: 50\n');
    },
    (dir) => {
      const { stdout } = captureOutput(() =>
        main(['--json', '--config', join(dir, 'unit-lint.config.json'), join(dir, 'data.txt')])
      );
      const findings = JSON.parse(stdout);
      assert.equal(findings.length, 1);
      assert.equal(findings[0].rule, 'bare-size-value');
    }
  );
});

test('main: an invalid config path exits 1', () => {
  const { exitCode, stderr } = captureOutput(() =>
    main(['--config', join(tmpdir(), 'unit-lint-missing-config.json'), 'anything.txt'])
  );
  assert.equal(exitCode, 1);
  assert.match(stderr, /could not read config/);
});

test('main: an unmatched glob pattern exits 1', () => {
  withTree(
    () => {},
    (dir) => {
      const { exitCode, stderr } = captureOutput(() => main([join(dir, '*.nomatch')]));
      assert.equal(exitCode, 1);
      assert.match(stderr, /no files matched pattern/);
    }
  );
});

test('main: the same file passed twice is only linted once', () => {
  withTree(
    (dir) => {
      writeFileSync(join(dir, 'clean.txt'), 'nothing to see here\n');
    },
    (dir) => {
      const file = join(dir, 'clean.txt');
      const { stdout } = captureOutput(() => main(['--json', file, file]));
      assert.deepEqual(JSON.parse(stdout), []);
    }
  );
});

test('main: findings from multiple files are grouped by file in human output', () => {
  withTree(
    (dir) => {
      writeFileSync(join(dir, 'a.txt'), 'download size: 10MG\n');
      writeFileSync(join(dir, 'b.txt'), 'download size: 10MG\n');
    },
    (dir) => {
      const { stdout } = captureOutput(() => main([join(dir, 'a.txt'), join(dir, 'b.txt')]));
      assert.match(stdout, /2 problem\(s\)/);
      assert.match(stdout, /a\.txt/);
      assert.match(stdout, /b\.txt/);
    }
  );
});
