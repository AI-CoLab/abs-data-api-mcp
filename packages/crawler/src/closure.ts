/**
 * Builds the code closure table (DESIGN.md decision 9).
 *
 * 232,200 of 301,722 codes carry a parent. ASGS geography nests seven levels
 * deep (AUS -> STE -> GCCSA -> SA4 -> SA3 -> SA2 -> SA1), so a recursive CTE
 * over a 61,845-code list is slow enough to matter at query time. Precomputing
 * ancestor-descendant pairs turns "every SA2 within Greater Sydney" into one
 * indexed lookup.
 */

export interface ClosureRow {
  codelistId: string;
  ancestorCodeId: string;
  descendantCodeId: string;
  depth: number;
}

export interface ClosureResult {
  rows: ClosureRow[];
  maxDepth: number;
  /** Codes whose `parent` points at a code that does not exist in the list. */
  danglingParents: Array<{ codeId: string; parentCodeId: string }>;
  /** Codes involved in a parent cycle. Recorded, not thrown. */
  cyclic: string[];
}

/**
 * Emits one row per ancestor of each code, plus a depth-0 self row so that
 * "descendants of X including X" needs no special-casing.
 */
export function buildClosure(
  codelistId: string,
  codes: Array<{ codeId: string; parentCodeId?: string | null | undefined }>,
): ClosureResult {
  const parentOf = new Map<string, string | undefined>();
  for (const c of codes) parentOf.set(c.codeId, c.parentCodeId ?? undefined);

  const rows: ClosureRow[] = [];
  const danglingParents: Array<{ codeId: string; parentCodeId: string }> = [];
  const cyclic: string[] = [];
  let maxDepth = 0;

  for (const { codeId } of codes) {
    rows.push({ codelistId, ancestorCodeId: codeId, descendantCodeId: codeId, depth: 0 });

    const seen = new Set<string>([codeId]);
    let current = parentOf.get(codeId);
    let depth = 1;

    while (current !== undefined) {
      if (!parentOf.has(current)) {
        danglingParents.push({ codeId, parentCodeId: current });
        break;
      }
      if (seen.has(current)) {
        cyclic.push(codeId);
        break;
      }
      seen.add(current);
      rows.push({
        codelistId,
        ancestorCodeId: current,
        descendantCodeId: codeId,
        depth,
      });
      if (depth > maxDepth) maxDepth = depth;
      current = parentOf.get(current);
      depth += 1;
    }
  }

  return { rows, maxDepth, danglingParents, cyclic };
}
