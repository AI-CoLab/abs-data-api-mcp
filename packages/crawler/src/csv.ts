/**
 * Streaming RFC 4180 CSV reader.
 *
 * Two measured facts make a real parser mandatory rather than nice-to-have:
 *
 *   1. `OBS_COMMENT` contains embedded newlines. Splitting on "\n" overcounts
 *      CPI's series by ~18% (8,466 apparent rows vs 7,168 real series), which
 *      would silently corrupt every count in the catalogue.
 *   2. Column sets differ per flow. ABS_LABOUR_ACCT carries UNIT_MULT and
 *      dimensions ASGS_2016/LABOURACCT_IND; CPI carries neither. Headers must
 *      be read from the response, never assumed.
 *
 * Streaming keeps memory bounded: single responses reach 42MB+ and full
 * histories 58MB, so nothing is buffered whole.
 */

const COMMA = 0x2c;
const QUOTE = 0x22;
const CR = 0x0d;
const LF = 0x0a;

/** Yields raw rows as string arrays, quotes and embedded newlines resolved. */
export async function* readCsvRows(
  body: ReadableStream<Uint8Array>,
  onBytes?: (n: number) => void,
): AsyncGenerator<string[], void, undefined> {
  const decoder = new TextDecoder("utf-8");
  const reader = body.getReader();

  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  /** True immediately after a closing quote, to detect "" escapes. */
  let quoteJustClosed = false;
  let sawAnyChar = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      onBytes?.(value.byteLength);

      // Decode incrementally so multi-byte characters spanning chunks survive.
      const text = decoder.decode(value, { stream: true });

      for (let i = 0; i < text.length; i += 1) {
        const ch = text.charCodeAt(i);
        sawAnyChar = true;

        if (inQuotes) {
          if (quoteJustClosed) {
            quoteJustClosed = false;
            if (ch === QUOTE) {
              field += '"'; // escaped quote
              continue;
            }
            inQuotes = false;
            // fall through and handle ch as an unquoted character
          } else if (ch === QUOTE) {
            quoteJustClosed = true;
            continue;
          } else {
            // Newlines inside quotes are data, not row terminators.
            field += text[i];
            continue;
          }
        }

        if (ch === QUOTE) {
          inQuotes = true;
          continue;
        }
        if (ch === COMMA) {
          row.push(field);
          field = "";
          continue;
        }
        if (ch === LF) {
          row.push(field);
          field = "";
          yield row;
          row = [];
          continue;
        }
        if (ch === CR) {
          continue; // CRLF: the LF terminates the row
        }
        field += text[i];
      }
    }

    // Flush any trailing decoder state and the final unterminated row.
    const tail = decoder.decode();
    if (tail.length > 0) field += tail;
    if (field.length > 0 || row.length > 0) {
      row.push(field);
      yield row;
    } else if (!sawAnyChar) {
      return;
    }
  } finally {
    reader.releaseLock();
  }
}

export interface CsvTable {
  header: string[];
  /** Column name -> index, for O(1) access without per-row object allocation. */
  columnIndex: ReadonlyMap<string, number>;
  rows: AsyncGenerator<string[], void, undefined>;
}

/**
 * Reads the header row, then exposes the remainder as a row stream.
 *
 * Returns undefined when the response has no header at all. An empty result set
 * still returns a table with zero rows — a real and distinct outcome, since
 * `detail=serieskeysonly` returns exactly that (header only, no data).
 */
export async function readCsvTable(
  body: ReadableStream<Uint8Array>,
  onBytes?: (n: number) => void,
): Promise<CsvTable | undefined> {
  const rows = readCsvRows(body, onBytes);
  const first = await rows.next();
  if (first.done) return undefined;

  const header = first.value.map((h) => h.trim());
  const columnIndex = new Map(header.map((name, i) => [name, i] as const));
  return { header, columnIndex, rows };
}

/**
 * ABS labels=both emits headers as `CODE: Label` (e.g. `MEASURE: Measure`).
 * Returns the bare code so column lookup works with either labelling mode.
 */
export function bareColumnName(header: string): string {
  const idx = header.indexOf(":");
  return idx === -1 ? header.trim() : header.slice(0, idx).trim();
}

export function normaliseHeader(header: string[]): {
  bare: string[];
  labels: Map<string, string>;
} {
  const bare: string[] = [];
  const labels = new Map<string, string>();
  for (const h of header) {
    const code = bareColumnName(h);
    bare.push(code);
    const idx = h.indexOf(":");
    if (idx !== -1) labels.set(code, h.slice(idx + 1).trim());
  }
  return { bare, labels };
}
