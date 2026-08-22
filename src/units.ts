// Parsing for the two quantity kinds this tool cares about: byte sizes and durations.
// Both show up in config files and code as "number + suffix" literals, and both have
// a decimal/binary or second/millisecond ambiguity baked into their suffixes.

export type ByteStandard = 'decimal' | 'binary' | 'exact';

interface ByteUnitInfo {
  bytes: number;
  standard: ByteStandard;
}

// 'exact' units (B, byte, bytes) are neither decimal nor binary, so they never
// count toward the mixed-unit-style check.
const BYTE_UNITS: Record<string, ByteUnitInfo> = {
  b: { bytes: 1, standard: 'exact' },
  byte: { bytes: 1, standard: 'exact' },
  bytes: { bytes: 1, standard: 'exact' },
  kb: { bytes: 1000, standard: 'decimal' },
  mb: { bytes: 1000 ** 2, standard: 'decimal' },
  gb: { bytes: 1000 ** 3, standard: 'decimal' },
  tb: { bytes: 1000 ** 4, standard: 'decimal' },
  pb: { bytes: 1000 ** 5, standard: 'decimal' },
  kib: { bytes: 1024, standard: 'binary' },
  mib: { bytes: 1024 ** 2, standard: 'binary' },
  gib: { bytes: 1024 ** 3, standard: 'binary' },
  tib: { bytes: 1024 ** 4, standard: 'binary' },
  pib: { bytes: 1024 ** 5, standard: 'binary' },
};

export interface ParsedByteSize {
  value: number;
  unit: string;
  bytes: number;
  standard: ByteStandard;
}

export function parseByteSize(literal: string): ParsedByteSize | null {
  const match = /^\s*([0-9]+(?:\.[0-9]+)?)\s*([A-Za-z]+)\s*$/.exec(literal);
  if (!match) return null;
  const [, rawValue, rawUnit] = match;
  const info = BYTE_UNITS[rawUnit.toLowerCase()];
  if (!info) return null;
  const value = Number(rawValue);
  return { value, unit: rawUnit, bytes: value * info.bytes, standard: info.standard };
}

// Milliseconds per unit. Durations can be compound ("1h30m"), like Go's time.Duration
// syntax, so parseDuration sums every token rather than expecting a single suffix.
const DURATION_UNITS: Record<string, number> = {
  ns: 1 / 1_000_000,
  us: 1 / 1000,
  'µs': 1 / 1000,
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

const DURATION_TOKEN = /([0-9]+(?:\.[0-9]+)?)(ns|us|µs|ms|s|m|h|d|w)/g;

export interface ParsedDuration {
  milliseconds: number;
  parts: Array<{ value: number; unit: string }>;
}

export function parseDuration(literal: string): ParsedDuration | null {
  const trimmed = literal.trim();
  if (!trimmed) return null;

  const parts: Array<{ value: number; unit: string }> = [];
  let milliseconds = 0;
  let consumed = 0;

  DURATION_TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = DURATION_TOKEN.exec(trimmed)) !== null) {
    // Tokens must be back to back — a gap means this isn't a clean duration literal
    // (e.g. "5 apples 3h" shouldn't parse as a 3 hour duration).
    if (match.index !== consumed) return null;
    const value = Number(match[1]);
    const unit = match[2];
    milliseconds += value * DURATION_UNITS[unit];
    parts.push({ value, unit });
    consumed = DURATION_TOKEN.lastIndex;
  }

  if (consumed !== trimmed.length || parts.length === 0) return null;
  return { milliseconds, parts };
}
