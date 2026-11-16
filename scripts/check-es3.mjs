#!/usr/bin/env node
// Parse ExtendScript files as ES3 before sending them to After Effects.
// Catches let/const, arrow functions, trailing commas, and reserved words used as property
// names ({in: 1}, o.class, o.default) - the last one pops a modal "Illegal use of reserved word"
// dialog in AE that blocks every later job until someone clicks it.
//   node scripts/check-es3.mjs file.jsx [more.jsx ...]
import fs from "fs";
import { parse, tokenizer } from "acorn";
const RESERVED = new Set(("break case catch class const continue debugger default delete do else enum export extends false finally for " +
  "function if import in instanceof new null return super switch this throw true try typeof var void while with").split(" "));
let bad = 0;
for (const f of process.argv.slice(2)) {
  const src = "(function(){\n" + fs.readFileSync(f, "utf8") + "\n})()"; // jobs are function bodies (top-level return)
  const errs = [];
  try { parse(src, { ecmaVersion: 3, allowReserved: false, locations: true }); }
  catch (e) { errs.push(e.message.replace(/\((\d+):(\d+)\)/, (m, l, c) => `(line ${l - 1}, col ${c})`)); }
  try {
    const toks = [...tokenizer(src, { ecmaVersion: 5, locations: true })];
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i], word = t.value, prev = toks[i - 1], next = toks[i + 1];
      if (t.type.label === "string" || typeof word !== "string" || !RESERVED.has(word)) continue; // quoted keys ("in": 1) are fine
      const afterDot = prev && prev.type.label === ".";
      const asKey = next && next.type.label === ":" && prev && (prev.type.label === "{" || prev.type.label === ",");
      if (afterDot || asKey) errs.push(`reserved word "${word}" used as a property name (line ${t.loc.start.line - 1}) - use o["${word}"] or rename`);
    }
  } catch (e) { /* the parse error above already covers it */ }
  if (errs.length) { bad++; console.log("FAIL " + f + "\n  " + errs.join("\n  ")); } else console.log("ok   " + f);
}
process.exit(bad ? 1 : 0);
