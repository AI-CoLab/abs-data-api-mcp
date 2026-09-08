/**
 * Census family factorisation (DESIGN.md decision 4).
 *
 * Roughly 558 of 1,227 dataflows are the same Census tables replicated across
 * geography levels: C21_G01_LGA, C21_G01_ASGS, C21_G01_POA and so on. Every one
 * is still probed independently, but the catalogue presents "G01 x 9
 * geographies" rather than 558 unrelated rows.
 *
 * Detection is data-driven rather than hardcoded: a family forms only when two
 * or more flows share a prefix and differ solely by a trailing token from the
 * ABS geography vocabulary.
 */

/** ASGS and non-ASGS geography suffixes used in ABS dataflow ids. */
export const GEOGRAPHY_LEVELS = new Set([
  "ASGS", // full ASGS hierarchy
  "SA", // statistical areas
  "SA1",
  "SA2",
  "SA3",
  "SA4",
  "LGA", // local government area
  "POA", // postal area
  "SAL", // suburb/locality
  "SSC", // state suburb
  "SED", // state electoral division
  "CED", // commonwealth electoral division
  "SUA", // significant urban area
  "UCL", // urban centre and locality
  "RA", // remoteness area
  "GCCSA", // greater capital city statistical area
  "STE", // state/territory
  "IARE", // indigenous area
  "ILOC", // indigenous location
  "IREG", // indigenous region
  "AUS",
]);

export interface DetectedFamily {
  familyId: string;
  tableCode: string;
  members: Array<{ flowId: string; geographyLevel: string }>;
}

export interface FamilyDetection {
  families: DetectedFamily[];
  /** Flows that are not part of any family. */
  standalone: string[];
}

export function detectFamilies(flowIds: readonly string[]): FamilyDetection {
  const candidates = new Map<string, Array<{ flowId: string; geographyLevel: string }>>();
  const unmatched: string[] = [];

  for (const flowId of flowIds) {
    const idx = flowId.lastIndexOf("_");
    if (idx <= 0) {
      unmatched.push(flowId);
      continue;
    }
    const suffix = flowId.slice(idx + 1);
    const prefix = flowId.slice(0, idx);

    if (!GEOGRAPHY_LEVELS.has(suffix.toUpperCase())) {
      unmatched.push(flowId);
      continue;
    }
    const list = candidates.get(prefix);
    if (list) list.push({ flowId, geographyLevel: suffix.toUpperCase() });
    else candidates.set(prefix, [{ flowId, geographyLevel: suffix.toUpperCase() }]);
  }

  const families: DetectedFamily[] = [];
  const standalone = [...unmatched];

  for (const [prefix, members] of candidates) {
    // A single flow whose id happens to end in a geography token is not a
    // family; treat it as standalone so we do not invent structure.
    if (members.length < 2) {
      for (const m of members) standalone.push(m.flowId);
      continue;
    }
    families.push({
      familyId: prefix,
      tableCode: prefix,
      members: members.sort((a, b) => a.geographyLevel.localeCompare(b.geographyLevel)),
    });
  }

  families.sort((a, b) => a.familyId.localeCompare(b.familyId));
  standalone.sort();
  return { families, standalone };
}
