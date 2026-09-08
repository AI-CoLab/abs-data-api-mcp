import { defineConfig } from "drizzle-kit";

// Local SQLite is the build target; D1 ingest happens via `wrangler d1 import`
// of the file this produces (DESIGN.md decision 10).
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/tables/*.ts",
  out: "./migrations",
  dbCredentials: {
    url: process.env.ABS_DB_PATH ?? "../../data/abs-catalogue.sqlite",
  },
  strict: true,
  verbose: true,
});
