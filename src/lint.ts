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
const DURATION_KEY_PATTERN =
  /\b(timeout|delay|ttl|interval|duration|expires?|retry|wait|cooldown|deadline)\b\s*[:=]\s*(\d+)(?!\s*[a-zA-Z])/gi;

// Same idea for sizes: a bare number could be bytes, KB, or a count of items entirely.
const SIZE_KEY_PATTERN =
  /\b(size|maxsize|max_size|limit|buffer|chunk|capacity|quota|bytes)\b\s*[:=]\s*(\d+)(?!\s*[a-zA-Z])/gi;

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

interface ByteOccurrence {
  line: number;
  column: number;
  unit: string;
  standard: 'decimal' | 'binary';
}

export function lintText(file: string, text: string): Finding[] {
  const findings: Finding[] = [];
  const lines = text.split(/\r\n|\r|\n/);
  const byteOccurrences: ByteOccurrence[] = [];

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

    for (const match of line.matchAll(DURATION_KEY_PATTERN)) {
      findings.push({
        file,
        line: lineNumber,
        column: match.index! + 1,
        rule: 'bare-duration-value',
        severity: 'warning',
        message: `'${match[1]}' is set to a bare number (${match[2]}) with no unit — is that seconds or milliseconds?`,
      });
    }

    for (const match of line.matchAll(SIZE_KEY_PATTERN)) {
      findings.push({
        file,
        line: lineNumber,
        column: match.index! + 1,
        rule: 'bare-size-value',
        severity: 'warning',
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
        severity: 'error',
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
            severity: 'warning',
            message: `'${occurrence.unit}' uses the ${minority} convention, but this file mostly uses ${dominant} units — pick one`,
          });
        }
      }
    }
  }

  findings.sort((a, b) => a.line - b.line || a.column - b.column);
  return findings;
}
