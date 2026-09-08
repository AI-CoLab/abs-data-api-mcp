/**
 * SDMX ObservationalTimePeriod handling.
 *
 * ABS emits several formats depending on a flow's FREQ dimension, and column
 * order differs per flow, so periods must be parsed rather than assumed:
 *   annual "2022", quarterly "2025-Q3", monthly "2025-08", semi-annual
 *   "2025-S1", weekly "2025-W12", daily "2025-08-15".
 */

export type PeriodGranularity = "annual" | "semi" | "quarter" | "month" | "week" | "day";

export interface ParsedPeriod {
  granularity: PeriodGranularity;
  year: number;
  /** 1-based index within the year: quarter, month, half, week or day-of-year. */
  index: number;
  /** Monotonic ordinal within its own granularity, for comparison. */
  ordinal: number;
}

const PATTERNS: Array<{
  re: RegExp;
  granularity: PeriodGranularity;
  perYear: number;
}> = [
  { re: /^(\d{4})$/, granularity: "annual", perYear: 1 },
  { re: /^(\d{4})-S(\d)$/, granularity: "semi", perYear: 2 },
  { re: /^(\d{4})-Q(\d)$/, granularity: "quarter", perYear: 4 },
  { re: /^(\d{4})-(\d{2})$/, granularity: "month", perYear: 12 },
  { re: /^(\d{4})-W(\d{1,2})$/, granularity: "week", perYear: 53 },
  { re: /^(\d{4})-(\d{2})-(\d{2})$/, granularity: "day", perYear: 366 },
];

export function parsePeriod(raw: string | undefined | null): ParsedPeriod | undefined {
  if (!raw) return undefined;
  const value = raw.trim();

  for (const { re, granularity, perYear } of PATTERNS) {
    const m = re.exec(value);
    if (!m) continue;

    const year = Number(m[1]);
    if (!Number.isFinite(year)) return undefined;

    let index: number;
    if (granularity === "annual") {
      index = 1;
    } else if (granularity === "day") {
      const month = Number(m[2]);
      const day = Number(m[3]);
      index = dayOfYear(year, month, day);
    } else {
      index = Number(m[2]);
    }
    if (!Number.isFinite(index)) return undefined;

    return { granularity, year, index, ordinal: year * perYear + (index - 1) };
  }
  return undefined;
}

function dayOfYear(year: number, month: number, day: number): number {
  const start = Date.UTC(year, 0, 1);
  const target = Date.UTC(year, month - 1, day);
  return Math.floor((target - start) / 86_400_000) + 1;
}

/** Negative if a precedes b. Periods of differing granularity compare by year. */
export function comparePeriods(a: string, b: string): number {
  const pa = parsePeriod(a);
  const pb = parsePeriod(b);
  if (!pa || !pb) return a.localeCompare(b);
  if (pa.granularity !== pb.granularity) {
    return pa.year - pb.year || pa.index - pb.index;
  }
  return pa.ordinal - pb.ordinal;
}

export function minPeriod(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return comparePeriods(a, b) <= 0 ? a : b;
}

export function maxPeriod(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return comparePeriods(a, b) >= 0 ? a : b;
}

/**
 * Inclusive count of periods between two bounds.
 *
 * This is a DERIVED figure. A two-pass probe (firstNObservations=1 plus
 * lastNObservations=1) establishes exact extents but not true observation
 * counts, so this is exact only for gap-free series and an upper bound
 * otherwise. Stored as `series.derivedObsCount`; `actualObsCount` stays NULL
 * unless a full-history pull is done.
 */
export function derivedObsCount(
  first: string | undefined,
  last: string | undefined,
): number | undefined {
  if (!first || !last) return undefined;
  const a = parsePeriod(first);
  const b = parsePeriod(last);
  if (!a || !b || a.granularity !== b.granularity) return undefined;
  const span = b.ordinal - a.ordinal + 1;
  return span > 0 ? span : undefined;
}

/** Map an SDMX FREQ code to the granularity its periods should use. */
export function granularityForFreq(freq: string | undefined): PeriodGranularity | undefined {
  switch (freq?.toUpperCase()) {
    case "A":
      return "annual";
    case "S":
    case "H":
      return "semi";
    case "Q":
      return "quarter";
    case "M":
      return "month";
    case "W":
      return "week";
    case "D":
    case "B":
      return "day";
    default:
      return undefined;
  }
}
