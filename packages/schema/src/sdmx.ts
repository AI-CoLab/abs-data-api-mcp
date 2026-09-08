/**
 * Zod contracts for the SDMX 2.1 structure JSON the ABS API returns, plus URN
 * parsing.
 *
 * Every object schema is LOOSE on purpose. ABS metadata is patchy and
 * inconsistent (annotation type casing varies, optional blocks come and go), and
 * a strict schema would fail the crawl on fields we do not care about. We
 * validate the shape we depend on and tolerate the rest.
 */
import { z } from "zod";

/** ABS returns English only: `names: { en: "..." }`. */
const localisedText = z.record(z.string(), z.string());

export const sdmxAnnotationSchema = z.looseObject({
  id: z.string().optional(),
  title: z.string().optional(),
  type: z.string().optional(),
  text: z.string().optional(),
  texts: localisedText.optional(),
});

export const sdmxCodeSchema = z.looseObject({
  id: z.string(),
  name: z.string().optional(),
  names: localisedText.optional(),
  description: z.string().optional(),
  descriptions: localisedText.optional(),
  parent: z.string().optional(),
  annotations: z.array(sdmxAnnotationSchema).optional(),
});

export const sdmxCodelistSchema = z.looseObject({
  id: z.string(),
  agencyID: z.string(),
  version: z.string(),
  name: z.string().optional(),
  names: localisedText.optional(),
  description: z.string().optional(),
  codes: z.array(sdmxCodeSchema).optional(),
});

export const sdmxConceptSchema = z.looseObject({
  id: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
});

export const sdmxConceptSchemeSchema = z.looseObject({
  id: z.string(),
  agencyID: z.string(),
  version: z.string(),
  name: z.string().optional(),
  concepts: z.array(sdmxConceptSchema).optional(),
});

/** Categories nest arbitrarily deep, so the schema is recursive. */
export interface SdmxCategory {
  id: string;
  name?: string | undefined;
  description?: string | undefined;
  categories?: SdmxCategory[] | undefined;
}

export const sdmxCategorySchema: z.ZodType<SdmxCategory> = z.lazy(() =>
  z.looseObject({
    id: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
    categories: z.array(sdmxCategorySchema).optional(),
  }),
) as z.ZodType<SdmxCategory>;

export const sdmxCategorySchemeSchema = z.looseObject({
  id: z.string(),
  agencyID: z.string(),
  version: z.string(),
  name: z.string().optional(),
  categories: z.array(sdmxCategorySchema).optional(),
});

export const sdmxCategorisationSchema = z.looseObject({
  id: z.string(),
  agencyID: z.string().optional(),
  version: z.string().optional(),
  name: z.string().optional(),
  /** URN of the dataflow. */
  source: z.string(),
  /** URN of the category. */
  target: z.string(),
});

export const sdmxDimensionSchema = z.looseObject({
  id: z.string(),
  position: z.number(),
  type: z.string().optional(),
  conceptIdentity: z.string().optional(),
  localRepresentation: z
    .looseObject({
      enumeration: z.string().optional(),
      textFormat: z.looseObject({ textType: z.string().optional() }).optional(),
    })
    .optional(),
});

export const sdmxAttributeSchema = z.looseObject({
  id: z.string(),
  assignmentStatus: z.string().optional(),
  conceptIdentity: z.string().optional(),
  attributeRelationship: z.looseObject({}).optional(),
  localRepresentation: z
    .looseObject({
      enumeration: z.string().optional(),
      textFormat: z.looseObject({ textType: z.string().optional() }).optional(),
    })
    .optional(),
});

export const sdmxDataStructureSchema = z.looseObject({
  id: z.string(),
  agencyID: z.string(),
  version: z.string(),
  name: z.string().optional(),
  dataStructureComponents: z
    .looseObject({
      dimensionList: z
        .looseObject({
          dimensions: z.array(sdmxDimensionSchema).optional(),
          timeDimensions: z.array(sdmxDimensionSchema).optional(),
        })
        .optional(),
      attributeList: z
        .looseObject({ attributes: z.array(sdmxAttributeSchema).optional() })
        .optional(),
      measureList: z.looseObject({}).optional(),
    })
    .optional(),
});

export const sdmxDataflowSchema = z.looseObject({
  id: z.string(),
  agencyID: z.string(),
  version: z.string(),
  name: z.string().optional(),
  names: localisedText.optional(),
  description: z.string().optional(),
  descriptions: localisedText.optional(),
  isExternalReference: z.boolean().optional(),
  isFinal: z.boolean().optional(),
  /** URN of the DSD. Present with detail=full, absent from stubs. */
  structure: z.string().optional(),
  annotations: z.array(sdmxAnnotationSchema).optional(),
});

/**
 * Content constraint. `type` is usually "Actual", which is misleading: the cube
 * region holds per-dimension marginals, not real key combinations.
 */
export const sdmxContentConstraintSchema = z.looseObject({
  id: z.string(),
  agencyID: z.string().optional(),
  version: z.string().optional(),
  type: z.string().optional(),
  validFrom: z.string().optional(),
  constraintAttachment: z.looseObject({ dataflows: z.array(z.string()).optional() }).optional(),
  cubeRegions: z
    .array(
      z.looseObject({
        isIncluded: z.boolean().optional(),
        keyValues: z
          .array(z.looseObject({ id: z.string(), values: z.array(z.string()).optional() }))
          .optional(),
      }),
    )
    .optional(),
});

export const sdmxStructureResponseSchema = z.looseObject({
  data: z
    .looseObject({
      dataflows: z.array(sdmxDataflowSchema).optional(),
      dataStructures: z.array(sdmxDataStructureSchema).optional(),
      codelists: z.array(sdmxCodelistSchema).optional(),
      conceptSchemes: z.array(sdmxConceptSchemeSchema).optional(),
      categorySchemes: z.array(sdmxCategorySchemeSchema).optional(),
      categorisations: z.array(sdmxCategorisationSchema).optional(),
      contentConstraints: z.array(sdmxContentConstraintSchema).optional(),
    })
    .optional(),
  meta: z.looseObject({}).optional(),
  errors: z.array(z.unknown()).optional(),
});

export type SdmxStructureResponse = z.infer<typeof sdmxStructureResponseSchema>;
export type SdmxDataflow = z.infer<typeof sdmxDataflowSchema>;
export type SdmxDataStructure = z.infer<typeof sdmxDataStructureSchema>;
export type SdmxCodelist = z.infer<typeof sdmxCodelistSchema>;
export type SdmxContentConstraint = z.infer<typeof sdmxContentConstraintSchema>;
export type SdmxCategorisation = z.infer<typeof sdmxCategorisationSchema>;
export type SdmxDimension = z.infer<typeof sdmxDimensionSchema>;

/** e.g. `urn:sdmx:org.sdmx.infomodel.codelist.Codelist=ABS:CL_CPI_MEASURES(1.1.0)` */
const URN_RE = /^urn:sdmx:org\.sdmx\.infomodel\.([^.]+)\.([^=]+)=([^:]+):([^(]+)(?:\(([^)]+)\))?/;

export interface ParsedUrn {
  package: string;
  class: string;
  agencyId: string;
  id: string;
  version: string | undefined;
  /** For nested items, e.g. `CS_COMMON(1.0.0).TIME_PERIOD` -> "TIME_PERIOD". */
  itemId: string | undefined;
}

export function parseUrn(urn: string | undefined): ParsedUrn | undefined {
  if (!urn) return undefined;
  const m = URN_RE.exec(urn);
  if (!m) return undefined;
  const [, pkg, cls, agencyId, rawId, version] = m;
  if (!pkg || !cls || !agencyId || !rawId) return undefined;

  // Item references append `.ITEM_ID` after the version parenthesis.
  const tail = urn.slice(m[0].length);
  const itemId = tail.startsWith(".") ? tail.slice(1) : undefined;

  return {
    package: pkg,
    class: cls,
    agencyId,
    id: rawId,
    version,
    itemId: itemId && itemId.length > 0 ? itemId : undefined,
  };
}

/** Prefer the explicit English label, then the flat field. */
export function localName(
  names: Record<string, string> | undefined,
  fallback: string | undefined,
): string | undefined {
  return names?.["en"] ?? fallback;
}

/** ABS emits both `ORDER` and `order`; normalise so grouping works. */
export function normaliseAnnotationType(type: string | undefined): string {
  return (type ?? "UNKNOWN").toUpperCase();
}
