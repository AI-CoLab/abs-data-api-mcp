/**
 * Flat re-export of every table, and nothing else.
 *
 * This is what gets handed to `drizzle()`. It must contain only table objects:
 * Drizzle introspects the module's own entries, and a namespace object created
 * by `export * as` has a null prototype, which its `is()` check cannot read.
 */
export * from "./reference.ts";
export * from "./declared.ts";
export * from "./observed.ts";
export * from "./derived.ts";
