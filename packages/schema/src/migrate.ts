import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { openCatalogue } from "./client.ts";

const path = resolve(process.env["ABS_DB_PATH"] ?? "../../data/abs-catalogue.sqlite");
mkdirSync(dirname(path), { recursive: true });

const { db, sqlite } = openCatalogue({ path });
migrate(db, { migrationsFolder: new URL("../migrations", import.meta.url).pathname });
sqlite.close();

console.log(`migrated ${path}`);
