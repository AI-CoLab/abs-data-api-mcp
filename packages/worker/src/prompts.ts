/**
 * MCP prompts: packaged workflows over the four verbs — the showcases carried
 * inside the server rather than left to each client to rediscover.
 */
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { MANIFEST } from "@abs/contract";

const user = (text: string) => ({ messages: [{ role: "user" as const, content: { type: "text" as const, text } }] });

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "suburb_dossier",
    {
      title: "Suburb dossier",
      description: "Build a small-area profile for any Australian suburb or locality: population history, age profile, building pipeline, and census income, language and industry — at SA2 level.",
      argsSchema: z.object({
        place: z.string().describe("A suburb, town or locality name, e.g. Fitzroy"),
        include_census: z.string().optional().describe("'yes' to add 2021 Census income/language/industry panels"),
      }),
    },
    ({ place, include_census }) =>
      user(
        `Build a data-backed dossier for the SA2 that best matches "${place}", using only the ABS tools.\n\n` +
          `1. Resolve the place: search_tables for "estimated resident population" with geography SA2, then search_options on its REGION dimension for "${place}". If several SA2s match, list them with their state and ask which — do not guess.\n` +
          `2. Population history: get_data on the ERP-by-SA2 table for that region, all available years (use startPeriod). Note any COVID-era dip (2020–21) explicitly if present.\n` +
          `3. Age profile: the ERP-by-age table at SA2 for the latest year; summarise the distribution against the state or national profile if that table exists.\n` +
          `4. Building pipeline: search_tables for "building approvals" at SA2; fetch dwelling approvals for the last five years. Small-area approvals are dominated by individual developments clearing in one month — report the five-year total and warn against reading one year as a trend.\n` +
          (include_census?.toLowerCase() === "yes"
            ? `5. Census 2021 at SA2: G17 (personal income by age and sex), G13 (language spoken at home), G54 (industry of employment). Use familyGeographies/geography=SA2 to pick the SA2 variant, and search_options to find the region code.\n`
            : `5. Offer the Census 2021 panels (income G17, language G13, industry G54 at SA2) as a follow-up.\n`) +
          `\nPresent the dossier with the exact ABS series keys used and the provenance runId. Every number must come from a get_data response in this conversation; do not fill gaps from memory.`,
      ),
  );

  server.registerPrompt(
    "compare_capitals",
    {
      title: "Compare the capital cities",
      description: "Compare an indicator across Australia's capital cities — CPI components, rents, labour force — using the observed tables.",
      argsSchema: z.object({
        indicator: z.string().describe("What to compare, e.g. 'rents', 'unemployment rate', 'all groups CPI'"),
      }),
    },
    ({ indicator }) =>
      user(
        `Compare "${indicator}" across Australia's eight capital cities using only the ABS tools.\n\n` +
          `1. search_tables for "${indicator}"; prefer tables whose matchedOptions name it directly. describe_table to learn the key order and the REGION options (capital cities are typically codes 1–8, with 50 = weighted average of eight capitals).\n` +
          `2. get_data with REGION set to all eight cities (pass several codes), the relevant MEASURE/INDEX, and lastN sized to compute a year-on-year change (e.g. 5 quarterly or 13 monthly observations).\n` +
          `3. If a combination fails, use the validOptions/alternatives in the response — quarterly and monthly availability differ for many CPI components.\n` +
          `4. Present a ranked table: latest value, year-on-year change, period. State the series keys and provenance runId.`,
      ),
  );

  server.registerPrompt(
    "explain_metadata_gap",
    {
      title: "Explain the metadata gap",
      description: "Explain, with live examples, why ABS's published metadata implies 23.8× more data than exists — and why this front door only offers what does.",
      argsSchema: z.object({ table: z.string().optional().describe("A table to use as the worked example; defaults to CPI") }),
    },
    ({ table }) =>
      user(
        `Explain the gap between what the ABS Data API's metadata declares and what it serves, for a technical reader.\n\n` +
          `Read the resource abs://findings first. Then use describe_table on ${table ?? "CPI"}: multiply its dimensions' option counts to get the implied combinations, compare with its seriesCount and density, and demonstrate one combination that the metadata implies but which does not exist (get_data will return the valid alternatives). ` +
          `Corpus-wide: ${MANIFEST.corpus.seriesConfirmed.toLocaleString("en-AU")} series exist against ${MANIFEST.corpus.seriesImpliedByMetadata.toLocaleString("en-AU")} implied (${((MANIFEST.corpus.density ?? 0) * 100).toFixed(2)}%). ` +
          `Explain the mechanism (per-dimension marginals are exact; the implied cross-product is not; hierarchical geography encoded as separate dimensions accounts for most of it) and what a consumer should do about it.`,
      ),
  );
}
