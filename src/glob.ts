// Expands directory arguments and glob patterns into concrete file paths, so the CLI
// can be pointed at a whole tree ("unit-lint config/") or a pattern the shell left
// unexpanded (quoted, or passed from a shell that doesn't glob) without depending on
// a glob package.

import { readdirSync, statSync, type Dirent, type Stats } from 'node:fs';
import { join, sep } from 'node:path';

const SKIP_DIRS = new Set(['.git', 'node_modules']);

const GLOB_CHAR_PATTERN = /[*?[\]]/;

export function hasGlobChars(pattern: string): boolean {
  return GLOB_CHAR_PATTERN.test(pattern);
}

const REGEXP_SPECIAL = new Set(['.', '+', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\']);

function segmentToRegExp(segment: string): RegExp {
  let source = '^';
  for (const char of segment) {
    if (char === '*') {
      source += '.*';
    } else if (char === '?') {
      source += '.';
    } else if (REGEXP_SPECIAL.has(char)) {
      source += `\\${char}`;
    } else {
      source += char;
    }
  }
  return new RegExp(`${source}$`);
}

function walkGlob(dir: string, segments: string[], depth: number, results: Set<string>): void {
  if (depth >= segments.length) return;

  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  const segment = segments[depth];

  if (segment === '**') {
    // Matches zero or more directories: try the rest of the pattern right here,
    // then descend into every subdirectory and try again from the same segment.
    walkGlob(dir, segments, depth + 1, results);
    for (const entry of entries) {
      if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
        walkGlob(join(dir, entry.name), segments, depth, results);
      }
    }
    return;
  }

  const regex = segmentToRegExp(segment);
  const isLast = depth === segments.length - 1;
  for (const entry of entries) {
    if (!regex.test(entry.name)) continue;
    const full = join(dir, entry.name);
    if (isLast) {
      if (entry.isFile()) results.add(full);
    } else if (entry.isDirectory()) {
      walkGlob(full, segments, depth + 1, results);
    }
  }
}

// Only relative patterns are supported (no leading "/") — that covers every pattern a
// shell would otherwise expand itself, and keeps the walk scoped under cwd.
export function expandGlob(pattern: string, cwd: string = process.cwd()): string[] {
  const segments = pattern.split(sep).join('/').split('/').filter((part) => part.length > 0);
  const results = new Set<string>();
  walkGlob(cwd, segments, 0, results);
  return Array.from(results).sort();
}

export function walkDirectory(dir: string): string[] {
  const results: string[] = [];
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDirectory(full));
    } else if (entry.isFile()) {
      results.push(full);
    }
  }
  return results.sort();
}

export type ResolvedArg = { files: string[]; error?: undefined } | { files?: undefined; error: string };

// Turns one raw CLI argument into concrete file paths: directories are walked
// recursively, glob patterns are expanded, and anything else passes through as a
// literal path for the caller to read (and fail on, if it doesn't exist).
export function resolveArg(arg: string): ResolvedArg {
  if (hasGlobChars(arg)) {
    const files = expandGlob(arg);
    if (files.length === 0) {
      return { error: `no files matched pattern '${arg}'` };
    }
    return { files };
  }

  let stat: Stats;
  try {
    stat = statSync(arg);
  } catch {
    // Doesn't exist (yet) — let the caller's own read attempt produce the error.
    return { files: [arg] };
  }

  if (stat.isDirectory()) {
    const files = walkDirectory(arg);
    if (files.length === 0) {
      return { error: `no files found under directory '${arg}'` };
    }
    return { files };
  }

  return { files: [arg] };
}
