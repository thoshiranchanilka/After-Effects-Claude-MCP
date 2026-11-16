// Bridge between the MCP server and a running After Effects.
// Every call becomes one .jsx job: [style library] + [profile] + [your code wrapped in CS.__run].
// The job writes <id>.result.json; we wait for it.
//
// Delivery, in order of preference:
//   1. "Claude Bridge" panel is open in AE (heartbeat fresh)  -> drop job in its queue folder
//   2. macOS                                                 -> osascript: DoScriptFile
//   3. Windows                                               -> AfterFX.exe -r <job>
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const LIB_PATH = path.join(ROOT, "ae", "claude_style_lib.jsx");
export const PROFILE_PATH = process.env.AE_STYLE_PROFILE || path.join(ROOT, "style", "profile.json");
// STYLE.md: explicit AE_STYLE_MD, else the one next to a custom profile, else the bundled starter guide
const SIDE_MD = process.env.AE_STYLE_PROFILE ? path.join(path.dirname(process.env.AE_STYLE_PROFILE), "STYLE.md") : null;
export const STYLE_MD_PATH = process.env.AE_STYLE_MD || (SIDE_MD && fs.existsSync(SIDE_MD) ? SIDE_MD : path.join(ROOT, "style", "STYLE.md"));

export const BRIDGE_DIR = process.env.AE_BRIDGE_DIR || (
  process.platform === "darwin" ? path.join(os.homedir(), "Library", "Application Support", "AE Claude Bridge")
  : process.platform === "win32" ? path.join(process.env.APPDATA || os.homedir(), "AE Claude Bridge")
  : path.join(os.homedir(), ".ae-claude-bridge"));
const JOBS = path.join(BRIDGE_DIR, "jobs");
const QUEUE = path.join(BRIDGE_DIR, "queue");
export const RENDERS = path.join(BRIDGE_DIR, "renders");
const HEARTBEAT = path.join(BRIDGE_DIR, "listener.heartbeat");

for (const d of [BRIDGE_DIR, JOBS, QUEUE, RENDERS]) fs.mkdirSync(d, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (cmd, args, opts = {}) => new Promise((resolve, reject) => {
  execFile(cmd, args, { maxBuffer: 10 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
    if (err) { err.stdout = stdout; err.stderr = stderr; reject(err); } else resolve({ stdout, stderr });
  });
});

// ExtendScript is happiest with pure ASCII: escape everything else as \uXXXX
// (valid inside string literals, identifiers and comments).
export function asciiSafe(src) {
  return src.replace(/[^\x00-\x7f]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}

export function buildJob(code, label, resultPath) {
  const lib = fs.readFileSync(LIB_PATH, "utf8");
  const profile = fs.readFileSync(PROFILE_PATH, "utf8");
  const header = `${lib}\nCS.profile = ${profile};\n`;
  const wrapperOpen = "CS.__run(function () {\n";
  const body = `${wrapperOpen}${code}\n}, ${JSON.stringify(resultPath)}, ${JSON.stringify(label || "job")});\n`;
  const userLineOffset = header.split("\n").length - 1 + wrapperOpen.split("\n").length - 1;
  return { text: asciiSafe(header + body), userLineOffset };
}

export function listenerAlive() {
  try { return Date.now() - fs.statSync(HEARTBEAT).mtimeMs < 4000; } catch { return false; }
}

let cachedApp = null;
export async function findAfterEffects() {
  if (process.platform === "darwin") {
    if (process.env.AE_APP_NAME) return { platform: "mac", app: process.env.AE_APP_NAME, running: true };
    const { stdout } = await run("ps", ["-axo", "command="]);
    const m = stdout.split("\n").map((l) => l.match(/\/([^/]*After Effects[^/]*)\.app\/Contents\/MacOS\//)).find(Boolean);
    if (m) { cachedApp = m[1]; return { platform: "mac", app: m[1], running: true }; }
    return { platform: "mac", app: cachedApp, running: false };
  }
  if (process.platform === "win32") {
    if (process.env.AE_EXE) return { platform: "win", exe: process.env.AE_EXE, running: true };
    try {
      const { stdout } = await run("powershell", ["-NoProfile", "-Command", "(Get-Process AfterFX -ErrorAction SilentlyContinue | Select-Object -First 1).Path"]);
      const exe = stdout.trim();
      if (exe) return { platform: "win", exe, running: true };
    } catch { /* fall through */ }
    return { platform: "win", exe: null, running: false };
  }
  return { platform: process.platform, running: false };
}

async function dispatch(jobPath) {
  if (listenerAlive()) {
    const target = path.join(QUEUE, path.basename(jobPath));
    fs.renameSync(jobPath, target);
    return { via: "panel", jobPath: target };
  }
  const ae = await findAfterEffects();
  if (!ae.running) {
    throw new Error("After Effects is not running. Open After Effects (and a project) first. " +
      "On Windows also open Window > Claude Bridge.jsx.");
  }
  if (ae.platform === "mac") {
    const p = jobPath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const script = `with timeout of 900 seconds\ntell application "${ae.app}" to DoScriptFile "${p}"\nend timeout`;
    // fire and forget – we wait for the result file instead of osascript's exit
    run("osascript", ["-e", script]).catch((e) => { dispatch.lastError = (e.stderr || e.message || "").toString(); });
    return { via: "osascript", app: ae.app, jobPath };
  }
  if (ae.platform === "win") {
    run(ae.exe, ["-r", jobPath]).catch((e) => { dispatch.lastError = (e.stderr || e.message || "").toString(); });
    return { via: "afterfx -r", jobPath };
  }
  throw new Error("Unsupported platform " + process.platform);
}

let seq = 0;
// Run ExtendScript code (a function body – use `return` to send a value back).
export async function runJsx(code, { label = "job", timeoutMs = 180000 } = {}) {
  const id = `${Date.now()}-${process.pid}-${++seq}`;
  const jobPath = path.join(JOBS, `job-${id}.jsx`);
  const resultPath = path.join(JOBS, `job-${id}.result.json`);
  const { text, userLineOffset } = buildJob(code, label, resultPath);
  fs.writeFileSync(jobPath, text, "utf8");
  dispatch.lastError = null;
  const how = await dispatch(jobPath);
  const t0 = Date.now();
  while (!fs.existsSync(resultPath)) {
    if (dispatch.lastError && Date.now() - t0 > 1500) {
      throw new Error(`After Effects did not run the job (${how.via}): ${dispatch.lastError.trim()}\n` +
        "Check: AE is open, a project is open, no modal dialog is showing, and macOS allowed Claude/Terminal to control After Effects (System Settings > Privacy & Security > Automation).");
    }
    if (Date.now() - t0 > timeoutMs) {
      throw new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for After Effects (${how.via}). ` +
        "A dialog may be open in AE, or 'Allow Scripts to Write Files and Access Network' is off (Settings > Scripting & Expressions).");
    }
    await sleep(120);
  }
  await sleep(30);
  let raw = fs.readFileSync(resultPath, "utf8");
  let res;
  try { res = JSON.parse(raw); } catch { await sleep(200); raw = fs.readFileSync(resultPath, "utf8"); res = JSON.parse(raw); }
  try { fs.unlinkSync(resultPath); } catch {}
  if (res.ok) { try { fs.unlinkSync(how.jobPath); } catch {} }
  if (!res.ok) {
    const line = typeof res.line === "number" ? res.line : null;
    const where = line === null ? "" : (line > userLineOffset ? ` (your code, line ${line - userLineOffset})` : ` (style library, line ${line})`);
    const err = new Error(`${res.error}${where}`);
    err.warnings = res.warnings;
    throw err;
  }
  return { result: res.result, warnings: res.warnings || [], via: how.via };
}

export async function waitForFile(p, timeoutMs = 30000) {
  const t0 = Date.now(); let last = -1;
  while (Date.now() - t0 < timeoutMs) {
    if (fs.existsSync(p)) {
      const s = fs.statSync(p).size;
      if (s > 0 && s === last) return true;
      last = s;
    }
    await sleep(150);
  }
  return fs.existsSync(p);
}
