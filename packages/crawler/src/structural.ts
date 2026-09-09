/**
 * Structural crawl: everything ABS *declares*.
 *
 * Seven bulk requests cover the entire corpus. An earlier read of this API
 * concluded that `datastructure/ABS` and `contentconstraint/ABS` were unusable
 * because both gateway-timed-out at 120s. They are not: the service sits behind
 * CloudFront/Varnish, and only the first uncached request is slow enough to
 * time out. With retry-and-backoff they return in well under a second:
 *
 *   dataflow/ABS?detail=full     2.6MB   1,227 flows, each with its DSD urn
 *   datastructure/ABS            3.5MB   1,229 DSDs with full components
 *   contentconstraint/ABS         29MB   2,433 constraints, flow-attached
 *   codelist/ABS                  49MB   573 codelists / 301,722 codes
 *   conceptscheme/ABS            991KB   59 concept schemes
 *   categoryscheme/ABS?full       30KB   25 schemes / 143 categories
 *   categorisation/ABS           617KB   1,226 flow-to-category links
 *
 * That replaces 1,227 per-flow `references=all` requests (~120MB), so the whole
 * declared side of the catalogue lands in seconds.
 *
 * Everything written here goes to the `declared_*` tables and is treated as
 * unverified: content constraints are per-dimension marginals and overstate
 * CPI's real series count by 4.8x and the corpus by 23.8x. Their purpose is to describe the dimension
 * space for the probe and to feed the delta report — never to answer
 * availability.
 */
import { eq } from "drizzle-orm";
import type { CatalogueDb } from "@abs/schema/client";
import {
  categorisation,
  category,
  categoryScheme,
  code,
  codeAnnotation,
  codeClosure,
  codelist,
  concept,
  conceptScheme,
  declaredAttribute,
  declaredConstraint,
  declaredConstraintValue,
  declaredDimension,
  declaredFlow,
  flowFamily,
  flowFamilyMember,
  probeRun,
  localName,
  normaliseAnnotationType,
  parseUrn,
  sdmxStructureResponseSchema,
  type SdmxCategory,
  type SdmxStructureResponse,
} from "@abs/schema";
import type { AbsClient } from "./http.ts";
import { archiveKey, type RawArchive } from "./archive.ts";
import { buildClosure } from "./closure.ts";
import { detectFamilies } from "./families.ts";
import { dedupeBy, insertChunked } from "./ingest.ts";

export interface StructuralDeps {
  db: CatalogueDb;
  client: AbsClient;
  archive: RawArchive;
  runId: string;
  log: (msg: string) => void;
}

export interface StructuralSummary {
  flows: number;
  dataStructures: number;
  dimensions: number;
  attributes: number;
  constraints: number;
  constraintValues: number;
  flowsWithDeclaredKeyCount: number;
  codelists: number;
  codes: number;
  closureRows: number;
  maxCodeDepth: number;
  conceptSchemes: number;
  concepts: number;
  categories: number;
  categorisations: number;
  families: number;
  flowsInFamilies: number;
  /** Anomalies worth reporting to ABS, collected as we go. */
  anomalies: {
    annotationCasingVariants: string[];
    danglingCodeParents: number;
    cyclicCodes: number;
    constraintsForUnknownFlows: string[];
    flowsWithoutDsd: string[];
    dsdsWithoutFlow: number;
    flowsWithoutDimensions: string[];
  };
}

function stringStream(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

/** Fetches, archives and validates one bulk structure payload. */
async function fetchBulk(
  deps: StructuralDeps,
  label: string,
  path: string,
  query?: Record<string, string | number>,
): Promise<SdmxStructureResponse["data"]> {
  const res = await deps.client.getJson(path, query);
  if (res.text) {
    await deps.archive.put(
      archiveKey({ kind: "bulk", label: `${label}.json`, runId: deps.runId }),
      stringStream(res.text),
    );
  }
  if (res.status !== 200) throw new Error(`${label}: HTTP ${res.status}`);

  const parsed = sdmxStructureResponseSchema.safeParse(res.json);
  if (!parsed.success) throw new Error(`${label}: response failed validation`);

  const sizeMb = ((res.text?.length ?? 0) / 1_048_576).toFixed(1);
  deps.log(`  ${label}: ${sizeMb}MB in ${(res.durationMs / 1000).toFixed(1)}s`);
  return parsed.data.data;
}

export async function crawlStructural(deps: StructuralDeps): Promise<StructuralSummary> {
  const { db, client, runId, log } = deps;
  const now = () => new Date().toISOString();

  const summary: StructuralSummary = {
    flows: 0,
    dataStructures: 0,
    dimensions: 0,
    attributes: 0,
    constraints: 0,
    constraintValues: 0,
    flowsWithDeclaredKeyCount: 0,
    codelists: 0,
    codes: 0,
    closureRows: 0,
    maxCodeDepth: 0,
    conceptSchemes: 0,
    concepts: 0,
    categories: 0,
    categorisations: 0,
    families: 0,
    flowsInFamilies: 0,
    anomalies: {
      annotationCasingVariants: [],
      danglingCodeParents: 0,
      cyclicCodes: 0,
      constraintsForUnknownFlows: [],
      flowsWithoutDsd: [],
      dsdsWithoutFlow: 0,
      flowsWithoutDimensions: [],
    },
  };

  db.insert(probeRun)
    .values({ id: runId, kind: "structural", startedAt: now(), status: "running" })
    .onConflictDoNothing()
    .run();

  // ---------------------------------------------------------------- dataflows
  log("fetching dataflows…");
  const flowData = await fetchBulk(deps, "dataflow-full", "dataflow/ABS", { detail: "full" });
  const flows = flowData?.dataflows ?? [];
  if (flows.length === 0) throw new Error("dataflow listing returned no flows");

  /** flow id -> DSD id, from the `structure` urn. */
  const flowToDsd = new Map<string, string>();
  for (const f of flows) {
    const dsd = parseUrn(f.structure);
    if (dsd) flowToDsd.set(f.id, dsd.id);
    else summary.anomalies.flowsWithoutDsd.push(f.id);
  }

  summary.flows = insertChunked(
    db,
    declaredFlow,
    dedupeBy(
      flows.map((f) => ({
        id: f.id,
        agencyId: f.agencyID,
        version: f.version,
        name: localName(f.names, f.name) ?? null,
        description: localName(f.descriptions, f.description) ?? null,
        dsdRef: f.structure ?? null,
        isFinal: f.isFinal ?? null,
        isExternalReference: f.isExternalReference ?? null,
        structureFetchedAt: now(),
      })),
      (r) => r.id,
    ),
  );
  log(`  ${summary.flows} dataflows (${summary.anomalies.flowsWithoutDsd.length} without a DSD urn)`);

  // ----------------------------------------------------------- data structures
  log("fetching data structures…");
  const dsdData = await fetchBulk(deps, "datastructure-all", "datastructure/ABS");
  const dsds = dsdData?.dataStructures ?? [];
  summary.dataStructures = dsds.length;

  const dsdById = new Map(dsds.map((d) => [d.id, d] as const));
  const referencedDsds = new Set(flowToDsd.values());
  summary.anomalies.dsdsWithoutFlow = dsds.filter((d) => !referencedDsds.has(d.id)).length;

  const dimensionRows: Array<typeof declaredDimension.$inferInsert> = [];
  const attributeRows: Array<typeof declaredAttribute.$inferInsert> = [];

  for (const [flowId, dsdId] of flowToDsd) {
    const dsd = dsdById.get(dsdId);
    if (!dsd) {
      summary.anomalies.flowsWithoutDimensions.push(flowId);
      continue;
    }
    const components = dsd.dataStructureComponents;
    const dims = components?.dimensionList?.dimensions ?? [];
    const timeDims = components?.dimensionList?.timeDimensions ?? [];
    const attrs = components?.attributeList?.attributes ?? [];

    if (dims.length === 0) summary.anomalies.flowsWithoutDimensions.push(flowId);

    for (const { d, fallbackType } of [
      ...dims.map((d) => ({ d, fallbackType: "Dimension" })),
      ...timeDims.map((d) => ({ d, fallbackType: "TimeDimension" })),
    ]) {
      const clUrn = parseUrn(d.localRepresentation?.enumeration);
      dimensionRows.push({
        flowId,
        dimensionId: d.id,
        position: d.position,
        dimensionType: d.type ?? fallbackType,
        conceptRef: d.conceptIdentity ?? null,
        codelistId: clUrn?.id ?? null,
        codelistSize: null, // filled once codelists are ingested
      });
    }

    for (const a of attrs) {
      const clUrn = parseUrn(a.localRepresentation?.enumeration);
      const rel = a.attributeRelationship as Record<string, unknown> | undefined;
      const relKeys = rel ? Object.keys(rel) : [];
      attributeRows.push({
        flowId,
        attributeId: a.id,
        relationship: relKeys.length > 0 ? relKeys.join("+") : "none",
        assignmentStatus: a.assignmentStatus ?? null,
        codelistId: clUrn?.id ?? null,
      });
    }
  }

  summary.dimensions = insertChunked(
    db,
    declaredDimension,
    dedupeBy(dimensionRows, (r) => `${r.flowId} ${r.dimensionId}`),
  );
  summary.attributes = insertChunked(
    db,
    declaredAttribute,
    dedupeBy(attributeRows, (r) => `${r.flowId} ${r.attributeId}`),
  );
  log(`  ${summary.dataStructures} DSDs -> ${summary.dimensions} dimensions, ${summary.attributes} attributes`);

  // ------------------------------------------------------------------ codelists
  await ingestCodelists(deps, summary);

  // Backfill declared cardinality now that codelist sizes are known.
  db.run(
    `UPDATE declared_dimension SET codelist_size = (
       SELECT code_count FROM codelist WHERE codelist.id = declared_dimension.codelist_id
     ) WHERE codelist_id IS NOT NULL`,
  );

  // ---------------------------------------------------------------- constraints
  log("fetching content constraints…");
  const ccData = await fetchBulk(deps, "contentconstraint-all", "contentconstraint/ABS");
  const constraints = ccData?.contentConstraints ?? [];

  const knownFlows = new Set(flows.map((f) => f.id));
  const constraintRows: Array<typeof declaredConstraint.$inferInsert> = [];
  const constraintValueRows: Array<typeof declaredConstraintValue.$inferInsert> = [];
  /** flow id -> largest declared marginal product across its constraints. */
  const declaredKeyCounts = new Map<string, number>();
  const unknownFlows = new Set<string>();

  for (const c of constraints) {
    const attachments = c.constraintAttachment?.dataflows ?? [];
    const flowIds = attachments
      .map((urn) => parseUrn(urn)?.id)
      .filter((id): id is string => id !== undefined);

    for (const flowId of flowIds) {
      if (!knownFlows.has(flowId)) {
        unknownFlows.add(flowId);
        continue;
      }
      constraintRows.push({
        id: `${c.id}@${flowId}`,
        flowId,
        constraintType: c.type ?? null,
        validFrom: c.validFrom ?? null,
        fetchedAt: now(),
      });

      let product = 1;
      let counted = 0;
      for (const region of c.cubeRegions ?? []) {
        for (const kv of region.keyValues ?? []) {
          const values = kv.values ?? [];
          for (const v of values) {
            constraintValueRows.push({
              constraintId: `${c.id}@${flowId}`,
              dimensionId: kv.id,
              codeId: v,
              isIncluded: region.isIncluded ?? true,
            });
          }
          // TIME_PERIOD carries no values and is excluded from the product.
          if (values.length > 0) {
            product *= values.length;
            counted += 1;
          }
        }
      }
      if (counted > 0) {
        declaredKeyCounts.set(flowId, Math.max(declaredKeyCounts.get(flowId) ?? 0, product));
      }
    }
  }

  summary.anomalies.constraintsForUnknownFlows = [...unknownFlows].sort();
  summary.constraints = insertChunked(
    db,
    declaredConstraint,
    dedupeBy(constraintRows, (r) => r.id),
  );
  summary.constraintValues = insertChunked(
    db,
    declaredConstraintValue,
    dedupeBy(constraintValueRows, (r) => `${r.constraintId} ${r.dimensionId} ${r.codeId}`),
  );

  db.transaction((tx) => {
    for (const [flowId, count] of declaredKeyCounts) {
      tx.update(declaredFlow)
        .set({ declaredKeyCount: count })
        .where(eq(declaredFlow.id, flowId))
        .run();
    }
  });
  summary.flowsWithDeclaredKeyCount = declaredKeyCounts.size;
  log(
    `  ${summary.constraints} constraints, ${summary.constraintValues} values, ` +
      `${summary.flowsWithDeclaredKeyCount} flows with a declared key count ` +
      `(${unknownFlows.size} attached to unknown flows)`,
  );

  // ------------------------------------------------------------------ concepts
  await ingestConceptSchemes(deps, summary);
  await ingestCategorySchemes(deps, summary);
  await ingestCategorisations(deps, summary);

  // ------------------------------------------------------------------ families
  const families = detectFamilies(flows.map((f) => f.id));
  insertChunked(
    db,
    flowFamily,
    families.families.map((f) => ({
      id: f.familyId,
      tableCode: f.tableCode,
      label: f.tableCode,
      memberCount: f.members.length,
    })),
  );
  insertChunked(
    db,
    flowFamilyMember,
    families.families.flatMap((f) =>
      f.members.map((m) => ({
        familyId: f.familyId,
        flowId: m.flowId,
        geographyLevel: m.geographyLevel,
      })),
    ),
  );
  summary.families = families.families.length;
  summary.flowsInFamilies = flows.length - families.standalone.length;
  log(`  ${summary.families} families covering ${summary.flowsInFamilies} flows`);

  db.update(probeRun)
    .set({
      finishedAt: now(),
      status: "complete",
      flowsAttempted: flows.length,
      flowsSucceeded: flows.length,
      notes: JSON.stringify({ anomalies: summary.anomalies, http: client.stats }),
    })
    .where(eq(probeRun.id, runId))
    .run();

  return summary;
}

async function ingestCodelists(deps: StructuralDeps, summary: StructuralSummary): Promise<void> {
  const { db, log } = deps;
  log("fetching codelists (≈49MB)…");

  const data = await fetchBulk(deps, "codelist-all", "codelist/ABS");
  const lists = data?.codelists ?? [];
  if (lists.length === 0) throw new Error("bulk codelist fetch returned nothing");

  const casings = new Set<string>();

  insertChunked(
    db,
    codelist,
    lists.map((cl) => ({
      id: cl.id,
      agencyId: cl.agencyID,
      version: cl.version,
      name: localName(cl.names, cl.name) ?? null,
      description: cl.description ?? null,
      codeCount: cl.codes?.length ?? 0,
    })),
  );
  summary.codelists = lists.length;

  // Ingested per codelist so peak memory stays bounded on a 49MB payload.
  for (const cl of lists) {
    const codes = cl.codes ?? [];
    if (codes.length === 0) continue;

    const annotationRows: Array<typeof codeAnnotation.$inferInsert> = [];
    const codeRows = codes.map((c) => {
      let sortOrder: number | null = null;
      for (const a of c.annotations ?? []) {
        const rawType = a.type ?? "";
        // ABS emits both ORDER and order; record the variants as a finding.
        if (rawType && rawType !== rawType.toUpperCase()) casings.add(rawType);
        const type = normaliseAnnotationType(a.type);
        const text = a.texts?.["en"] ?? a.text ?? null;
        if (type === "ORDER" && text !== null) {
          const n = Number(text);
          if (Number.isFinite(n)) sortOrder = n;
        }
        annotationRows.push({
          codelistId: cl.id,
          codeId: c.id,
          type,
          title: a.title ?? null,
          text,
        });
      }
      return {
        codelistId: cl.id,
        codeId: c.id,
        name: localName(c.names, c.name) ?? null,
        description: localName(c.descriptions, c.description) ?? null,
        parentCodeId: c.parent ?? null,
        sortOrder,
      };
    });

    const deduped = dedupeBy(codeRows, (r) => `${r.codelistId} ${r.codeId}`);
    summary.codes += insertChunked(db, code, deduped);
    insertChunked(db, codeAnnotation, annotationRows);

    const closure = buildClosure(cl.id, deduped);
    summary.closureRows += insertChunked(
      db,
      codeClosure,
      dedupeBy(closure.rows, (r) => `${r.codelistId} ${r.ancestorCodeId} ${r.descendantCodeId}`),
    );
    summary.anomalies.danglingCodeParents += closure.danglingParents.length;
    summary.anomalies.cyclicCodes += closure.cyclic.length;
    if (closure.maxDepth > summary.maxCodeDepth) summary.maxCodeDepth = closure.maxDepth;
  }

  summary.anomalies.annotationCasingVariants = [...casings].sort();
  log(
    `  ${summary.codelists} codelists, ${summary.codes} codes, ` +
      `${summary.closureRows} closure rows, max depth ${summary.maxCodeDepth}`,
  );
}

async function ingestConceptSchemes(
  deps: StructuralDeps,
  summary: StructuralSummary,
): Promise<void> {
  const { db, log } = deps;
  const data = await fetchBulk(deps, "conceptscheme-all", "conceptscheme/ABS");
  const schemes = data?.conceptSchemes ?? [];

  insertChunked(
    db,
    conceptScheme,
    schemes.map((s) => ({
      id: s.id,
      agencyId: s.agencyID,
      version: s.version,
      name: s.name ?? null,
    })),
  );
  const conceptRows = schemes.flatMap((s) =>
    (s.concepts ?? []).map((c) => ({
      schemeId: s.id,
      conceptId: c.id,
      name: c.name ?? null,
      description: c.description ?? null,
    })),
  );
  summary.concepts = insertChunked(
    db,
    concept,
    dedupeBy(conceptRows, (r) => `${r.schemeId} ${r.conceptId}`),
  );
  summary.conceptSchemes = schemes.length;
  log(`  ${schemes.length} concept schemes, ${summary.concepts} concepts`);
}

async function ingestCategorySchemes(
  deps: StructuralDeps,
  summary: StructuralSummary,
): Promise<void> {
  const { db, log } = deps;
  const data = await fetchBulk(deps, "categoryscheme-all", "categoryscheme/ABS", {
    detail: "full",
  });
  const schemes = data?.categorySchemes ?? [];

  insertChunked(
    db,
    categoryScheme,
    schemes.map((s) => ({
      id: s.id,
      agencyId: s.agencyID,
      version: s.version,
      name: s.name ?? null,
    })),
  );

  const rows: Array<typeof category.$inferInsert> = [];
  const walk = (schemeId: string, nodes: SdmxCategory[], parentPath: string | null): void => {
    for (const node of nodes) {
      const path = parentPath ? `${parentPath}.${node.id}` : node.id;
      rows.push({ schemeId, categoryPath: path, parentPath, name: node.name ?? null });
      if (node.categories?.length) walk(schemeId, node.categories, path);
    }
  };
  for (const s of schemes) walk(s.id, s.categories ?? [], null);

  summary.categories = insertChunked(
    db,
    category,
    dedupeBy(rows, (r) => `${r.schemeId} ${r.categoryPath}`),
  );
  log(`  ${schemes.length} category schemes, ${summary.categories} categories`);
}

async function ingestCategorisations(
  deps: StructuralDeps,
  summary: StructuralSummary,
): Promise<void> {
  const { db, log } = deps;
  const data = await fetchBulk(deps, "categorisation-all", "categorisation/ABS");
  const items = data?.categorisations ?? [];

  const rows = items.flatMap((c) => {
    const source = parseUrn(c.source);
    const target = parseUrn(c.target);
    if (!source || !target) return [];
    // Category urns carry the path as the item id: SCHEME(1.0.0).A.B.C
    return [
      { id: c.id, flowId: source.id, schemeId: target.id, categoryPath: target.itemId ?? target.id },
    ];
  });

  summary.categorisations = insertChunked(db, categorisation, dedupeBy(rows, (r) => r.id));
  log(`  ${summary.categorisations} categorisations`);
}
