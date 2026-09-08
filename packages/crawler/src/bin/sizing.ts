/**
 * Pre-flight sizing entrypoint: measures the exact probe volume for every flow
 * without downloading it.
 *
 *   pnpm --filter @abs/crawler size
 */
import { bootstrap } from "../runtime.ts";
import { measureCorpus } from "../sizing.ts";

const rt = bootstrap({ runKind: "sizing", archive: false });

try {
  rt.log("measuring lastNObservations=1 payload size for every flow (Range: bytes=0-0)…");
  const s = await measureCorpus({
    db: rt.db,
    client: rt.client,
    runId: rt.runId,
    log: rt.log,
    pass: "last",
  });

  rt.log("--- sizing complete ---");
  rt.log(`measured:          ${s.measured}`);
  rt.log(`404 (empty):       ${s.empty404}`);
  rt.log(`timed out:         ${s.timedOut}`);
  rt.log(`total payload:     ${(s.totalBytes / 1e9).toFixed(2)}GB uncompressed`);
  rt.log(`est. gzipped:      ${(s.totalBytes / 1e9 / 8.7).toFixed(2)}GB`);
  rt.log(`est. series:       ${s.estimatedSeries.toLocaleString()}`);
  rt.log("largest flows:");
  for (const f of s.largest) {
    rt.log(
      `  ${f.flowId.padEnd(28)} ${((f.totalBytes ?? 0) / 1e6).toFixed(1).padStart(9)}MB  ` +
        `~${(f.estimatedSeries ?? 0).toLocaleString()} series`,
    );
  }
  rt.log(`http: ${JSON.stringify(rt.client.stats)}`);
} finally {
  rt.sqlite.close();
}
