// ontology/validate.mjs
// Validates that every `maps_from` column in xbase1_ontology.yaml exists in
// schema.json (a committed snapshot of Supabase information_schema.columns).
//
// Node only — Python is not installed on this machine.
// Requires: js-yaml  (see package.json). Run:  node validate.mjs [--enforce]
//
//   default        -> REPORT mode: prints missing columns, exit 0 (never blocks)
//   --enforce      -> ENFORCE mode: prints missing columns, exit 1 (blocks commit)
//
// Use REPORT mode until the ontology `# CONFIRM` columns are resolved — the
// first runs double as the drift punch list. Flip the hook to --enforce once
// the maps_from lines point at real, verified columns.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const yaml = require("js-yaml"); // js-yaml is CommonJS — createRequire avoids ESM interop issues

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENFORCE = process.argv.includes("--enforce");

const ontologyPath = path.join(__dirname, "xbase1_ontology.yaml");
const schemaPath = path.join(__dirname, "schema.json");

// ---- load inputs -----------------------------------------------------------
let ontology, schema;
try {
  ontology = yaml.load(fs.readFileSync(ontologyPath, "utf8"));
} catch (e) {
  console.error(`FATAL: cannot read/parse ${ontologyPath}\n${e.message}`);
  process.exit(1);
}
try {
  schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
} catch (e) {
  console.error(`FATAL: cannot read/parse ${schemaPath}\n${e.message}`);
  console.error("Generate it from Supabase (see README/SQL) before validating.");
  process.exit(1);
}

// schema.json shape:  { "table_name": ["col_a","col_b",...], ... }
const tableHas = (t, c) =>
  Object.prototype.hasOwnProperty.call(schema, t) && schema[t].includes(c);

// ---- collect every "table.column" reference from the ontology ---------------
// Skips values that are not physical columns: computed / derived / enum /
// <synthetic> / empty arrays. Only "table.column" strings are checked.
const refs = []; // { where, table, column }

const isPhysical = (v) =>
  typeof v === "string" &&
  v.includes(".") &&
  !v.startsWith("<") &&
  !["computed", "derived", "enum", "fk_on_load_source_tables"].includes(v);

function pushRef(where, value) {
  if (!isPhysical(value)) return;
  const [table, column] = value.split(".");
  refs.push({ where, table, column });
}

// entities.*.attributes.*.maps_from[]
for (const [ename, entity] of Object.entries(ontology.entities || {})) {
  for (const [aname, attr] of Object.entries(entity.attributes || {})) {
    const mf = attr && attr.maps_from;
    if (Array.isArray(mf)) mf.forEach((v) => pushRef(`entity ${ename}.${aname}`, v));
    else if (typeof mf === "string") pushRef(`entity ${ename}.${aname}`, mf);
  }
}

// relationships[].via  and  relationships[].edge_properties.*
for (const rel of ontology.relationships || []) {
  const label = `rel ${rel.from}-${rel.verb}->${rel.to}`;
  if (rel.via) pushRef(`${label} via`, rel.via);
  for (const [pk, pv] of Object.entries(rel.edge_properties || {})) {
    pushRef(`${label} edge.${pk}`, pv);
  }
}

// ---- validate --------------------------------------------------------------
const missing = refs.filter((r) => !tableHas(r.table, r.column));
const checked = refs.length;

console.log(`ontology validate: ${checked} physical column refs checked`);
if (missing.length === 0) {
  console.log("OK — every maps_from column exists in schema.json");
  process.exit(0);
}

console.log(`\nDRIFT — ${missing.length} column(s) not found in schema.json:`);
for (const m of missing) {
  console.log(`  MISSING  ${m.table}.${m.column}   (${m.where})`);
}
console.log(
  `\nEither fix the maps_from line or refresh schema.json from Supabase.`
);

if (ENFORCE) {
  console.log("ENFORCE mode — commit blocked.");
  process.exit(1);
}
console.log("REPORT mode — commit allowed. (Add --enforce once CONFIRMs resolved.)");
process.exit(0);
