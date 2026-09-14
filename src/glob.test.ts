import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { hasGlobChars, expandGlob, walkDirectory, resolveArg } from './glob.js';

function withTree(build: (dir: string) => void, run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'unit-lint-glob-'));
  try {
    build(dir);
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('hasGlobChars: detects *, ?, and [ ]', () => {
  assert.equal(hasGlobChars('config/*.yaml'), true);
  assert.equal(hasGlobChars('file?.txt'), true);
  assert.equal(hasGlobChars('file[0-9].txt'), true);
  assert.equal(hasGlobChars('plain/path.txt'), false);
});

test('expandGlob: * matches files within a single directory', () => {
  withTree(
    (dir) => {
      writeFileSync(join(dir, 'a.yaml'), '');
      writeFileSync(join(dir, 'b.yaml'), '');
      writeFileSync(join(dir, 'c.json'), '');
    },
    (dir) => {
      const matches = expandGlob('*.yaml', dir);
      assert.deepEqual(
        matches.map((m) => m.slice(dir.length + 1)).sort(),
        ['a.yaml', 'b.yaml']
      );
    }
  );
});

test('expandGlob: ** matches across any number of directories', () => {
  withTree(
    (dir) => {
      mkdirSync(join(dir, 'nested', 'deeper'), { recursive: true });
      writeFileSync(join(dir, 'top.yaml'), '');
      writeFileSync(join(dir, 'nested', 'mid.yaml'), '');
      writeFileSync(join(dir, 'nested', 'deeper', 'bottom.yaml'), '');
    },
    (dir) => {
      const matches = expandGlob('**/*.yaml', dir);
      assert.deepEqual(
        matches.map((m) => m.slice(dir.length + 1)).sort(),
        [join('nested', 'deeper', 'bottom.yaml'), join('nested', 'mid.yaml'), 'top.yaml'].sort()
      );
    }
  );
});

test('expandGlob: ? matches exactly one character', () => {
  withTree(
    (dir) => {
      writeFileSync(join(dir, 'a1.txt'), '');
      writeFileSync(join(dir, 'a12.txt'), '');
    },
    (dir) => {
      const matches = expandGlob('a?.txt', dir);
      assert.deepEqual(matches.map((m) => m.slice(dir.length + 1)), ['a1.txt']);
    }
  );
});

test('expandGlob: a pattern with no matches returns an empty array', () => {
  withTree(
    () => {},
    (dir) => {
      assert.deepEqual(expandGlob('*.yaml', dir), []);
    }
  );
});

test('expandGlob: skips .git and node_modules when walking **', () => {
  withTree(
    (dir) => {
      mkdirSync(join(dir, '.git'), { recursive: true });
      mkdirSync(join(dir, 'node_modules'), { recursive: true });
      writeFileSync(join(dir, '.git', 'config.yaml'), '');
      writeFileSync(join(dir, 'node_modules', 'config.yaml'), '');
      writeFileSync(join(dir, 'config.yaml'), '');
    },
    (dir) => {
      const matches = expandGlob('**/*.yaml', dir);
      assert.deepEqual(matches, [join(dir, 'config.yaml')]);
    }
  );
});

test('walkDirectory: recurses into subdirectories and skips .git/node_modules', () => {
  withTree(
    (dir) => {
      mkdirSync(join(dir, 'sub'), { recursive: true });
      mkdirSync(join(dir, '.git'), { recursive: true });
      writeFileSync(join(dir, 'top.txt'), '');
      writeFileSync(join(dir, 'sub', 'nested.txt'), '');
      writeFileSync(join(dir, '.git', 'HEAD'), '');
    },
    (dir) => {
      const files = walkDirectory(dir);
      assert.deepEqual(files.sort(), [join(dir, 'sub', 'nested.txt'), join(dir, 'top.txt')].sort());
    }
  );
});

test('walkDirectory: a directory that does not exist returns an empty array', () => {
  assert.deepEqual(walkDirectory('/no/such/directory'), []);
});

test('resolveArg: a literal path to an existing file passes through unchanged', () => {
  withTree(
    (dir) => {
      writeFileSync(join(dir, 'config.yaml'), '');
    },
    (dir) => {
      const file = join(dir, 'config.yaml');
      assert.deepEqual(resolveArg(file), { files: [file] });
    }
  );
});

test('resolveArg: a directory is walked recursively', () => {
  withTree(
    (dir) => {
      mkdirSync(join(dir, 'sub'), { recursive: true });
      writeFileSync(join(dir, 'a.yaml'), '');
      writeFileSync(join(dir, 'sub', 'b.yaml'), '');
    },
    (dir) => {
      const result = resolveArg(dir);
      assert.deepEqual(result.files?.sort(), [join(dir, 'a.yaml'), join(dir, 'sub', 'b.yaml')].sort());
    }
  );
});

test('resolveArg: an empty directory is an error', () => {
  withTree(
    () => {},
    (dir) => {
      assert.deepEqual(resolveArg(dir), { error: `no files found under directory '${dir}'` });
    }
  );
});

test('resolveArg: a path that does not exist yet passes through, deferring to the caller', () => {
  const missing = join(tmpdir(), 'unit-lint-does-not-exist', 'config.yaml');
  assert.deepEqual(resolveArg(missing), { files: [missing] });
});
