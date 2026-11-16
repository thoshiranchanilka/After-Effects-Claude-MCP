#!/usr/bin/env node
// Send an ExtendScript file to After Effects through the same bridge the MCP server uses.
//   node scripts/run-jsx.mjs <file.jsx> [label] [timeoutMs] [--ui]
// The job runs with the style library as CS.*; --ui also prepends ae/ui_lib.jsx (UI.*).
// The file is a function body: `return` sends a value back. Label "undo" = read-only (no undo group).
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { runJsx } from "../server/bridge.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const ui = args.includes("--ui");
const [file, label = "job", timeout = "300000"] = args.filter((a) => a !== "--ui");
if (!file) { console.error("usage: node scripts/run-jsx.mjs <file.jsx> [label] [timeoutMs] [--ui]"); process.exit(2); }
let code = fs.readFileSync(file, "utf8");
if (ui) code = fs.readFileSync(path.join(root, "ae", "ui_lib.jsx"), "utf8") + "\n" + code;
const r = await runJsx(code, { label, timeoutMs: +timeout });
console.log(typeof r === "string" ? r : JSON.stringify(r, null, 1));
