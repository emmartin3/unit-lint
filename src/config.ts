import { readFileSync } from 'node:fs';
import {
  DEFAULT_DURATION_KEYS,
  DEFAULT_SIZE_KEYS,
  RULE_NAMES,
  type LintOptions,
  type RuleName,
  type Severity,
} from './lint.js';

const KNOWN_RULES = new Set<string>(RULE_NAMES);

// The config file only ever adds to the built-in key lists — there's no way to shrink
// them, because removing e.g. "timeout" from detection is rarely what someone wants;
// they almost always mean "also flag our custom key names".
function mergeKeys(defaults: string[], value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    throw new Error(`"${field}" must be an array of strings`);
  }
  return Array.from(new Set([...defaults, ...value]));
}

function parseSeverities(value: unknown): Partial<Record<RuleName, Severity>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('"severities" must be an object mapping rule names to "error" or "warning"');
  }

  const result: Partial<Record<RuleName, Severity>> = {};
  for (const [rule, severity] of Object.entries(value as Record<string, unknown>)) {
    if (!KNOWN_RULES.has(rule)) {
      throw new Error(`unknown rule "${rule}" in "severities" (expected one of ${RULE_NAMES.join(', ')})`);
    }
    if (severity !== 'error' && severity !== 'warning') {
      throw new Error(`severity for "${rule}" must be "error" or "warning"`);
    }
    result[rule as RuleName] = severity;
  }
  return result;
}

// Config files are plain JSON, not YAML — no dependencies means no YAML parser, and
// JSON is unambiguous enough for a handful of arrays and a severity map.
export function loadConfig(path: string): LintOptions {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new Error(`could not read config ${path}: ${(err as Error).message}`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(`could not parse config ${path}: ${(err as Error).message}`);
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`${path}: config must be a JSON object`);
  }
  const { durationKeys, sizeKeys, severities, ...unknownFields } = raw as Record<string, unknown>;

  const extraKeys = Object.keys(unknownFields);
  if (extraKeys.length > 0) {
    throw new Error(`${path}: unknown config field(s): ${extraKeys.join(', ')}`);
  }

  const options: LintOptions = {};
  try {
    if (durationKeys !== undefined) {
      options.durationKeys = mergeKeys(DEFAULT_DURATION_KEYS, durationKeys, 'durationKeys');
    }
    if (sizeKeys !== undefined) {
      options.sizeKeys = mergeKeys(DEFAULT_SIZE_KEYS, sizeKeys, 'sizeKeys');
    }
    if (severities !== undefined) {
      options.severities = parseSeverities(severities);
    }
  } catch (err) {
    throw new Error(`${path}: ${(err as Error).message}`);
  }

  return options;
}
