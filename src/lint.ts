import { parseByteSize } from './units.js';

export type Severity = 'error' | 'warning';

export interface Finding {
  file: string;
  line: number;
  column: number;
  rule: string;
  severity: Severity;
  message: string;
}

// Byte units, scanned across the whole line so we can compare conventions within a file.
const BYTE_UNIT_PATTERN = /\b(\d+(?:\.\d+)?)\s?(B|KB|KiB|MB|MiB|GB|GiB|TB|TiB|PB|PiB)\b/gi;

// Key names that usually hold a duration. A bare number assigned to one of these is
// ambiguous: is 30000 thirty seconds or thirty thousand milliseconds?
export const DEFAULT_DURATION_KEYS = [
  'timeout',
  'delay',
  'ttl',
  'interval',
  'duration',
  'expire',
  'expires',
  'retry',
  'wait',
  'cooldown',
  'deadline',
];

// Same idea for sizes: a bare number could be bytes, KB, or a count of items entirely.
export const DEFAULT_SIZE_KEYS = [
  'size',
  'maxsize',
  'max_size',
  'limit',
  'buffer',
  'chunk',
  'capacity',
  'quota',
  'bytes',
];

export const RULE_NAMES = [
  'bare-duration-value',
  'bare-size-value',
  'unknown-unit',
  'mixed-unit-style',
] as const;

export type RuleName = (typeof RULE_NAMES)[number];

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildKeyPattern(keys: string[]): RegExp {
  const alternatives = keys.map(escapeRegExp).join('|');
  return new RegExp(`\\b(${alternatives})\\b\\s*[:=]\\s*(\\d+)(?!\\s*[a-zA-Z])`, 'gi');
}

// Common typo'd or borrowed unit suffixes, mapped to what they were probably meant to be.
// KO/GO show up in French-language codebases ("kilo-octet", "giga-octet").
const UNIT_TYPOS: Record<string, string> = {
  MG: 'MB',
  GO: 'GB',
  KO: 'KB',
  SEC: 's',
  SECS: 's',
  MIN: 'm',
  MINS: 'm',
  HR: 'h',
  HRS: 'h',
};

const UNIT_TYPO_PATTERN = /\b(\d+(?:\.\d+)?)\s?(MG|GO|KO|SECS?|MINS?|HRS?)\b/gi;

// No comment-syntax assumptions here — the tool works on plain text across file
// formats, so the directive is just a phrase, matched wherever it appears on the line.
// An optional "rule-a,rule-b" suffix limits the suppression to those rules; with no
// suffix, every finding on the target line is suppressed.
const DISABLE_DIRECTIVE_PATTERN = /unit-lint-disable-(line|next-line)(?::\s*([a-zA-Z0-9,\- ]+))?/;

type DisableSet = 'all' | Set<RuleName>;

function parseDisableDirectives(lines: string[]): Map<number, DisableSet> {
  const disabled = new Map<number, DisableSet>();

  lines.forEach((line, index) => {
    const match = DISABLE_DIRECTIVE_PATTERN.exec(line);
    if (!match) return;

    const targetLine = match[1] === 'line' ? index + 1 : index + 2;
    const rulesPart = match[2]?.trim();

    let toApply: DisableSet;
    if (!rulesPart) {
      toApply = 'all';
    } else {
      toApply = new Set(
        rulesPart
          .split(',')
          .map((name) => name.trim())
          .filter((name): name is RuleName => (RULE_NAMES as readonly string[]).includes(name))
      );
    }

    const existing = disabled.get(targetLine);
    if (existing === 'all' || toApply === 'all') {
      disabled.set(targetLine, 'all');
    } else {
      disabled.set(targetLine, new Set([...existing ?? [], ...toApply]));
    }
  });

  return disabled;
}

function isSuppressed(disabled: Map<number, DisableSet>, line: number, rule: RuleName): boolean {
  const entry = disabled.get(line);
  if (!entry) return false;
  return entry === 'all' || entry.has(rule);
}

interface ByteOccurrence {
  line: number;
  column: number;
  unit: string;
  standard: 'decimal' | 'binary';
}

export interface LintOptions {
  durationKeys?: string[];
  sizeKeys?: string[];
  severities?: Partial<Record<RuleName, Severity>>;
}

export function lintText(file: string, text: string, options: LintOptions = {}): Finding[] {
  const durationKeyPattern = buildKeyPattern(options.durationKeys ?? DEFAULT_DURATION_KEYS);
  const sizeKeyPattern = buildKeyPattern(options.sizeKeys ?? DEFAULT_SIZE_KEYS);
  const severityOf = (rule: RuleName, fallback: Severity): Severity => options.severities?.[rule] ?? fallback;

  const findings: Finding[] = [];
  const lines = text.split(/\r\n|\r|\n/);
  const byteOccurrences: ByteOccurrence[] = [];
  const disabled = parseDisableDirectives(lines);

  lines.forEach((line, index) => {
    const lineNumber = index + 1;

    for (const match of line.matchAll(BYTE_UNIT_PATTERN)) {
      const parsed = parseByteSize(`${match[1]}${match[2]}`);
      if (parsed && parsed.standard !== 'exact') {
        byteOccurrences.push({
          line: lineNumber,
          column: match.index! + 1,
          unit: match[2],
          standard: parsed.standard,
        });
      }
    }

    for (const match of line.matchAll(durationKeyPattern)) {
      findings.push({
        file,
        line: lineNumber,
        column: match.index! + 1,
        rule: 'bare-duration-value',
        severity: severityOf('bare-duration-value', 'warning'),
        message: `'${match[1]}' is set to a bare number (${match[2]}) with no unit — is that seconds or milliseconds?`,
      });
    }

    for (const match of line.matchAll(sizeKeyPattern)) {
      findings.push({
        file,
        line: lineNumber,
        column: match.index! + 1,
        rule: 'bare-size-value',
        severity: severityOf('bare-size-value', 'warning'),
        message: `'${match[1]}' is set to a bare number (${match[2]}) with no unit — bytes, KB, or MB?`,
      });
    }

    for (const match of line.matchAll(UNIT_TYPO_PATTERN)) {
      const suggestion = UNIT_TYPOS[match[2].toUpperCase()];
      findings.push({
        file,
        line: lineNumber,
        column: match.index! + 1,
        rule: 'unknown-unit',
        severity: severityOf('unknown-unit', 'error'),
        message: `'${match[2]}' looks like a typo for '${suggestion}'`,
      });
    }
  });

  if (byteOccurrences.length > 1) {
    const binaryCount = byteOccurrences.filter((o) => o.standard === 'binary').length;
    const decimalCount = byteOccurrences.length - binaryCount;

    if (binaryCount > 0 && decimalCount > 0) {
      const dominant = decimalCount >= binaryCount ? 'decimal' : 'binary';
      const minority = dominant === 'decimal' ? 'binary' : 'decimal';
      for (const occurrence of byteOccurrences) {
        if (occurrence.standard === minority) {
          findings.push({
            file,
            line: occurrence.line,
            column: occurrence.column,
            rule: 'mixed-unit-style',
            severity: severityOf('mixed-unit-style', 'warning'),
            message: `'${occurrence.unit}' uses the ${minority} convention, but this file mostly uses ${dominant} units — pick one`,
          });
        }
      }
    }
  }

  const visible = findings.filter((f) => !isSuppressed(disabled, f.line, f.rule as RuleName));
  visible.sort((a, b) => a.line - b.line || a.column - b.column);
  return visible;
}
