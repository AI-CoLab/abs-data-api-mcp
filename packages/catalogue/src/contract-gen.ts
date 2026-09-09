/**
 * Contract generator: observed catalogue -> the corrected API contract.
 *
 * Emits, per crawl (DESIGN.md decision 25):
 *   packages/contract/src/generated/manifest.ts  run id, corpus totals
 *   packages/contract/src/generated/tables.ts    every table, its key structure and coverage
 *   packages/contract/src/generated/options.ts   literal-union option types for small codelists
 *   packages/contract/src/generated/index.ts
 *   data/d1/*.sql                                 D1 import: schema + the runtime tables
 *
 * Everything here is derived from the OBSERVED tables. Declared metadata is
 * consulted only for structural facts that are not availability claims — the
 * key order of dimensions and the codelist a dimension draws from — and for
 * descriptions. No declared code set reaches the contract.
 */
import type { Database } from "better-sqlite3";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** Dimensions with at most this many observed codes become literal unions. */
export const LITERAL_UNION_MAX = 64;

export interface GenerateOptions {
  contractDir: string;
  d1Dir: string;
  migrationsDir: string;
  log: (m: string) => void;
}

export interface GenerateSummary {
  runId: string;
  tables: number;
  dimensions: number;
  literalCodelists: number;
  literalCodes: number;
  brandedCodelists: number;
  d1Files: string[];
  d1Rows: number;
}

function identifier(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
}

function header(runId: string, generatedAt: string): string {
  return (
    `// GENERATED FILE — do not edit.\n` +
    `// Source: observed ABS catalogue, crawl ${runId}, generated ${generatedAt}.\n` +
    `// Regenerate with: pnpm generate:contract\n\n`
  );
}

export function generateContract(sqlite: Database, opts: GenerateOptions): GenerateSummary {
  const { log } = opts;
  const all = <T>(sql: string, ...p: unknown[]): T[] => sqlite.prepare(sql).all(...p) as T[];
  const one = <T>(sql: string, ...p: unknown[]): T => sqlite.prepare(sql).get(...p) as T;

  const run = one<{ id: string; finished_at: string | null }>(
    `SELECT id, finished_at FROM probe_run WHERE kind = 'probe' AND status = 'complete'
     ORDER BY started_at DESC LIMIT 1`,
  );
  const runId = run?.id ?? "unknown";
  const generatedAt = new Date().toISOString();

  const genDir = resolve(opts.contractDir, "src/generated");
  mkdirSync(genDir, { recursive: true });
  mkdirSync(opts.d1Dir, { recursive: true });

  // ------------------------------------------------------------- manifest
  const totals = one<{
    flows: number;
    series: number;
    declared: number;
    earliest: string | null;
    latest: string | null;
  }>(
    `SELECT COUNT(*) AS flows, SUM(o.series_count) AS series, SUM(d.declared_key_count) AS declared,
            MIN(o.earliest_period) AS earliest, MAX(o.latest_period) AS latest
     FROM observed_flow o JOIN declared_flow d ON d.id = o.id WHERE o.series_count > 0`,
  );

  writeFileSync(
    join(genDir, "manifest.ts"),
    header(runId, generatedAt) +
      `export const MANIFEST = ${JSON.stringify(
        {
          runId,
          generatedAt,
          observedAt: run?.finished_at ?? generatedAt,
          corpus: {
            tables: totals.flows,
            seriesConfirmed: totals.series,
            seriesImpliedByMetadata: totals.declared,
            density: totals.declared > 0 ? totals.series / totals.declared : null,
            earliestPeriod: totals.earliest,
            latestPeriod: totals.latest,
          },
          literalUnionMax: LITERAL_UNION_MAX,
        },
        null,
        2,
      )} as const;\n`,
    "utf8",
  );

  // --------------------------------------------------------------- tables
  const flows = all<{
    id: string;
    name: string | null;
    description: string | null;
    series_count: number;
    frequencies: string | null;
    earliest_period: string | null;
    latest_period: string | null;
    density_ratio: number | null;
    family_id: string | null;
    geography_level: string | null;
  }>(
    `SELECT d.id, d.name, d.description, o.series_count, o.frequencies, o.earliest_period,
            o.latest_period, o.density_ratio, fm.family_id, fm.geography_level
     FROM observed_flow o
     JOIN declared_flow d ON d.id = o.id
     LEFT JOIN flow_family_member fm ON fm.flow_id = o.id
     WHERE o.series_count > 0
     ORDER BY d.id`,
  );

  const dimRows = all<{
    flow_id: string;
    dimension_id: string;
    position: number;
    codelist_id: string | null;
    observed: number;
  }>(
    `SELECT dd.flow_id, dd.dimension_id, dd.position, dd.codelist_id,
            (SELECT COUNT(*) FROM observed_dimension_code o
              WHERE o.flow_id = dd.flow_id AND o.dimension_id = dd.dimension_id) AS observed
     FROM declared_dimension dd
     WHERE dd.dimension_type <> 'TimeDimension'
       AND dd.flow_id IN (SELECT id FROM observed_flow WHERE series_count > 0)
     ORDER BY dd.flow_id, dd.position`,
  );
  const dimsByFlow = new Map<string, typeof dimRows>();
  for (const d of dimRows) {
    const list = dimsByFlow.get(d.flow_id) ?? [];
    list.push(d);
    dimsByFlow.set(d.flow_id, list);
  }

  const topicRows = all<{ flow_id: string; category_path: string }>(
    `SELECT flow_id, category_path FROM categorisation ORDER BY flow_id`,
  );
  const topicsByFlow = new Map<string, string[]>();
  for (const t of topicRows) {
    const list = topicsByFlow.get(t.flow_id) ?? [];
    list.push(t.category_path);
    topicsByFlow.set(t.flow_id, list);
  }

  const tableEntries = flows.map((f) => {
    const dims = dimsByFlow.get(f.id) ?? [];
    return {
      id: f.id,
      name: f.name,
      description: f.description,
      seriesCount: f.series_count,
      frequencies: (f.frequencies ?? "").split(",").filter(Boolean),
      coverage: { from: f.earliest_period, to: f.latest_period },
      density: f.density_ratio,
      family: f.family_id,
      geography: f.geography_level,
      topics: topicsByFlow.get(f.id) ?? [],
      dimensions: dims.map((d) => ({
        id: d.dimension_id,
        position: d.position,
        codelist: d.codelist_id,
        optionCount: d.observed,
        literal: d.codelist_id !== null && d.observed <= LITERAL_UNION_MAX,
      })),
    };
  });

  const tablesTs =
    header(runId, generatedAt) +
    `export interface TableDimension {\n` +
    `  id: string;\n  position: number;\n  codelist: string | null;\n` +
    `  /** Options observed in real data for this table. */\n  optionCount: number;\n` +
    `  /** True when the codelist's observed options are small enough to be a literal union type. */\n  literal: boolean;\n}\n\n` +
    `export interface TableRecord {\n` +
    `  id: string;\n  name: string | null;\n  description: string | null;\n  seriesCount: number;\n` +
    `  frequencies: string[];\n  coverage: { from: string | null; to: string | null };\n` +
    `  density: number | null;\n  family: string | null;\n  geography: string | null;\n` +
    `  topics: string[];\n  dimensions: TableDimension[];\n}\n\n` +
    `export const TABLES = ${JSON.stringify(
      Object.fromEntries(tableEntries.map((t) => [t.id, t])),
      null,
      1,
    )} as const satisfies Record<string, TableRecord>;\n\n` +
    `export type TableId = keyof typeof TABLES;\n` +
    `export const TABLE_IDS = Object.keys(TABLES) as TableId[];\n`;
  writeFileSync(join(genDir, "tables.ts"), tablesTs, "utf8");

  // -------------------------------------------------------------- options
  // Literal unions at codelist granularity: the union of codes observed
  // anywhere for that codelist. Per-table exact option sets live in D1.
  const smallCodelists = all<{ codelist_id: string; n: number }>(
    `SELECT dd.codelist_id, COUNT(DISTINCT o.code_id) AS n
     FROM declared_dimension dd
     JOIN observed_dimension_code o ON o.flow_id = dd.flow_id AND o.dimension_id = dd.dimension_id
     WHERE dd.codelist_id IS NOT NULL
     GROUP BY dd.codelist_id
     HAVING n <= ?
     ORDER BY dd.codelist_id`,
    LITERAL_UNION_MAX,
  );
  const allCodelists = all<{ codelist_id: string; n: number }>(
    `SELECT dd.codelist_id, COUNT(DISTINCT o.code_id) AS n
     FROM declared_dimension dd
     JOIN observed_dimension_code o ON o.flow_id = dd.flow_id AND o.dimension_id = dd.dimension_id
     WHERE dd.codelist_id IS NOT NULL GROUP BY dd.codelist_id`,
  );
  const smallIds = new Set(smallCodelists.map((c) => c.codelist_id));

  const codeStmt = sqlite.prepare(
    `SELECT DISTINCT o.code_id, c.name
     FROM observed_dimension_code o
     JOIN declared_dimension dd ON dd.flow_id = o.flow_id AND dd.dimension_id = o.dimension_id
     LEFT JOIN code c ON c.codelist_id = dd.codelist_id AND c.code_id = o.code_id
     WHERE dd.codelist_id = ?
     ORDER BY o.code_id`,
  );

  let optionsTs = header(runId, generatedAt);
  optionsTs +=
    `/** Codelists whose observed options are small enough to type as literal unions. */\n` +
    `export const LITERAL_CODELISTS = ${JSON.stringify([...smallIds].sort())} as const;\n\n`;
  let literalCodes = 0;
  for (const cl of smallCodelists) {
    const codes = codeStmt.all(cl.codelist_id) as Array<{ code_id: string; name: string | null }>;
    literalCodes += codes.length;
    const ident = identifier(cl.codelist_id);
    optionsTs +=
      `export const ${ident} = ${JSON.stringify(
        Object.fromEntries(codes.map((c) => [c.code_id, c.name])),
        null,
        1,
      )} as const;\n` + `export type ${ident} = keyof typeof ${ident};\n\n`;
  }
  const branded = allCodelists.filter((c) => !smallIds.has(c.codelist_id));
  optionsTs +=
    `/** Large codelists: options are branded strings, resolved via search_options. */\n` +
    `export const BRANDED_CODELISTS = ${JSON.stringify(
      Object.fromEntries(branded.map((c) => [c.codelist_id, c.n])),
      null,
      1,
    )} as const;\n` +
    `export type BrandedCode<CL extends keyof typeof BRANDED_CODELISTS> = string & { readonly __codelist: CL };\n`;
  writeFileSync(join(genDir, "options.ts"), optionsTs, "utf8");

  writeFileSync(
    join(genDir, "index.ts"),
    header(runId, generatedAt) +
      `export * from "./manifest.ts";\nexport * from "./tables.ts";\nexport * from "./options.ts";\n`,
    "utf8",
  );
  log(`contract: ${tableEntries.length} tables, ${dimRows.length} dimensions, ${smallCodelists.length} literal codelists (${literalCodes} codes), ${branded.length} branded`);

  // ------------------------------------------------------------------ D1
  const d1Files: string[] = [];
  let d1Rows = 0;

  // Schema: the Drizzle migrations verbatim. D1 gets every table; only the
  // runtime subset is populated.
  const migrations = readdirSync(opts.migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const schemaSql = migrations
    .map((f) => readFileSync(join(opts.migrationsDir, f), "utf8").replace(/--> statement-breakpoint/g, ""))
    .join("\n");
  const schemaPath = join(opts.d1Dir, "00-schema.sql");
  writeFileSync(schemaPath, `${schemaSql}\n`, "utf8");
  d1Files.push(schemaPath);

  // Runtime subset — nothing from series/* or declared_constraint_value.
  const runtimeTables: Array<{ table: string; where?: string }> = [
    { table: "probe_run" },
    { table: "declared_flow" },
    { table: "declared_dimension" },
    { table: "declared_attribute" },
    { table: "observed_flow" },
    { table: "observed_dimension_code" },
    { table: "codelist" },
    { table: "code" },
    { table: "code_annotation" },
    { table: "code_closure" },
    { table: "concept_scheme" },
    { table: "concept" },
    { table: "category_scheme" },
    { table: "category" },
    { table: "categorisation" },
    { table: "flow_family" },
    { table: "flow_family_member" },
    {
      table: "flow_probe",
      where: `fetched_at = (SELECT MAX(fetched_at) FROM flow_probe fp2 WHERE fp2.flow_id = flow_probe.flow_id)`,
    },
    {
      table: "delta_finding",
      where: `run_id = (SELECT run_id FROM delta_finding ORDER BY detected_at DESC LIMIT 1)`,
    },
    {
      table: "endpoint_check",
      where: `run_id = (SELECT run_id FROM endpoint_check ORDER BY checked_at DESC LIMIT 1)`,
    },
  ];

  const sqlLiteral = (v: unknown): string => {
    if (v === null || v === undefined) return "NULL";
    if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
    if (typeof v === "bigint") return v.toString();
    if (typeof v === "boolean") return v ? "1" : "0";
    if (Buffer.isBuffer(v)) return `X'${v.toString("hex")}'`;
    return `'${String(v).replace(/'/g, "''")}'`;
  };

  const ROWS_PER_INSERT = 250;
  const MAX_FILE_BYTES = 90 * 1024 * 1024;

  let fileIndex = 10;
  for (const { table, where } of runtimeTables) {
    const cols = (sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
      (c) => c.name,
    );
    const select = `SELECT ${cols.map((c) => `"${c}"`).join(", ")} FROM ${table}${where ? ` WHERE ${where}` : ""}`;
    const iter = sqlite.prepare(select).raw().iterate() as IterableIterator<unknown[]>;

    let part = 0;
    let buf: string[] = [];
    let bufBytes = 0;
    let batch: string[] = [];
    let tableRows = 0;

    const flushBatch = () => {
      if (batch.length === 0) return;
      const stmt = `INSERT OR IGNORE INTO ${table} (${cols.map((c) => `"${c}"`).join(", ")}) VALUES\n${batch.join(",\n")};\n`;
      buf.push(stmt);
      bufBytes += stmt.length;
      batch = [];
    };
    const flushFile = () => {
      if (buf.length === 0) return;
      const path = join(opts.d1Dir, `${String(fileIndex).padStart(2, "0")}-${table}${part > 0 ? `-${part}` : ""}.sql`);
      writeFileSync(path, buf.join(""), "utf8");
      d1Files.push(path);
      buf = [];
      bufBytes = 0;
      part += 1;
    };

    for (const row of iter) {
      batch.push(`(${row.map(sqlLiteral).join(", ")})`);
      tableRows += 1;
      if (batch.length >= ROWS_PER_INSERT) flushBatch();
      if (bufBytes >= MAX_FILE_BYTES) flushFile();
    }
    flushBatch();
    flushFile();
    d1Rows += tableRows;
    fileIndex += 1;
    log(`  d1: ${table} ${tableRows.toLocaleString()} rows`);
  }

  return {
    runId,
    tables: tableEntries.length,
    dimensions: dimRows.length,
    literalCodelists: smallCodelists.length,
    literalCodes,
    brandedCodelists: branded.length,
    d1Files,
    d1Rows,
  };
}
