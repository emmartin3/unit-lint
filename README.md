# unit-lint

Config files and source code are full of numbers that mean nothing without their
unit: `timeout: 30000`, `bufferSize: 4096`, `cacheSize: 500MB` sitting next to
`maxUpload: 2GiB` in the same file. Every one of those is a small trap — is the
timeout in seconds or milliseconds, is the cache size decimal or binary megabytes,
did someone typo `MG` for `MB`. unit-lint scans text files for exactly these
patterns and reports them with a file and line number, the way a normal linter
would report a syntax problem.

It doesn't parse any particular file format. It works on plain text, line by
line, so it applies equally to YAML, JSON, `.env` files, Terraform, or a
TypeScript source file with inline constants.

## Building

There are no runtime dependencies. You need a TypeScript compiler available
(install `typescript` yourself, globally or as a devDependency) to turn the
sources in `src/` into runnable JavaScript:

```
tsc
node dist/cli.js config.yaml
```

## Testing

```
npm test
```

Runs the test suite with Node's built-in test runner (`node --test`), against
the compiled output in `dist/`. No test framework dependency needed.

## Usage

Given `config.yaml`:

```yaml
cacheSize: 500MB
uploadBuffer: 2GiB
requestTimeout: 30000
retryDelay: 500
maxUpload: 200MG
```

```
$ node dist/cli.js config.yaml
config.yaml
  2:15  warning mixed-unit-style  'GiB' uses the binary convention, but this file mostly uses decimal units — pick one
  3:18  warning bare-duration-value  'requestTimeout' is set to a bare number (30000) with no unit — is that seconds or milliseconds?
  4:13  warning bare-duration-value  'retryDelay' is set to a bare number (500) with no unit — is that seconds or milliseconds?
  5:12  error   unknown-unit  'MG' looks like a typo for 'MB'

4 problem(s)  (1 error, 3 warning)
```

Pass `--json` to get the same findings as a machine-readable array instead,
for feeding into CI or another tool:

```
$ node dist/cli.js --json config.yaml
[
  {
    "file": "config.yaml",
    "line": 2,
    "column": 15,
    "rule": "mixed-unit-style",
    "severity": "warning",
    "message": "'GiB' uses the binary convention, but this file mostly uses decimal units — pick one"
  },
  ...
]
```

The process exits with status 1 if any finding has `severity: "error"`, 0
otherwise — `--json` doesn't change the exit code.

Arguments can be files, directories, or glob patterns. A directory is walked
recursively (skipping `.git` and `node_modules`); a pattern containing `*`,
`?`, or `[` is expanded against the filesystem, so it works even on a shell
that leaves it unexpanded — `**` matches across any number of directories:

```
$ node dist/cli.js config/
$ node dist/cli.js 'config/**/*.yaml'
```

## Rules

- **mixed-unit-style** — a file uses both decimal (`KB`, `MB`, `GB`) and binary
  (`KiB`, `MiB`, `GiB`) byte units. Occurrences of whichever convention is used
  less often are flagged.
- **bare-duration-value** — a key that looks like it holds a duration
  (`timeout`, `delay`, `ttl`, `interval`, `retry`, `wait`, `cooldown`,
  `deadline`, `expires`) is assigned a plain integer with no unit suffix.
- **bare-size-value** — same idea for size-like keys (`size`, `maxSize`,
  `limit`, `buffer`, `chunk`, `capacity`, `quota`, `bytes`).
- **unknown-unit** — a number is followed by a suffix that's almost certainly
  a typo or a unit borrowed from another language (`MG`, `GO`, `KO`, `SEC`,
  `MIN`, `HR`), with a suggested correction.
- **byte-size-precision-loss** — a byte size literal (e.g. `9PiB`) works out to
  more bytes than `Number.MAX_SAFE_INTEGER`. Any tool that reads the value with
  `JSON.parse` or does float64 arithmetic on it — rather than treating it as an
  opaque string — will silently round it.

## Configuration

By default `bare-duration-value` and `bare-size-value` only look at a fixed list of
key names (see Rules, below). Pass `--config` with a JSON file to extend those lists
or to change a rule's severity:

```json
{
  "durationKeys": ["staleAfter", "pollEvery"],
  "sizeKeys": ["pageSize"],
  "severities": {
    "bare-size-value": "error",
    "mixed-unit-style": "error"
  }
}
```

```
$ node dist/cli.js --config unit-lint.config.json config.yaml
```

`durationKeys` and `sizeKeys` are added to the built-in lists, not a replacement for
them. `severities` maps a rule name to `"error"` or `"warning"`; any rule not listed
keeps its default severity.

## Ignoring a line

Put `unit-lint-disable-line` anywhere on a line to suppress every finding on
that line, or `unit-lint-disable-next-line` to suppress findings on the line
that follows — useful when the directive itself has to go in a comment above
the value rather than trailing it:

```yaml
retryDelay: 500  # unit-lint-disable-line
# unit-lint-disable-next-line
maxUpload: 200MG
```

Add `:rule-name` (or a comma-separated list) to suppress only specific rules
and let the others still fire:

```yaml
cacheSize: 500MB  # unit-lint-disable-line:mixed-unit-style
```

There's no comment syntax requirement — since unit-lint doesn't parse the
host file format, it just looks for the phrase anywhere on the line.

## Library use

`src/units.ts` exports `parseByteSize` and `parseDuration` on their own, and
`src/lint.ts` exports `lintText(file, text, options?)`, which returns a
`Finding[]` without touching the filesystem — useful if you want to lint an
in-memory string or wire this into another tool. `options` takes the same
`durationKeys`, `sizeKeys`, and `severities` fields as the config file.
`src/config.ts` exports `loadConfig(path)` to read one of those files directly.
