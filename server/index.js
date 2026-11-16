#!/usr/bin/env node
// After Effects MCP server – builds scenes in the learned house style.
import fs from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { runJsx, findAfterEffects, listenerAlive, waitForFile, PROFILE_PATH, STYLE_MD_PATH, RENDERS, BRIDGE_DIR } from "./bridge.js";

const server = new McpServer({ name: "after-effects-style", version: "1.0.0" });
const J = (v) => JSON.stringify(v);

function ok(obj, extra = []) {
  return { content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }, ...extra] };
}
function fail(e) {
  const w = e.warnings && e.warnings.length ? `\nWarnings: ${e.warnings.join(" | ")}` : "";
  return { isError: true, content: [{ type: "text", text: `Error: ${e.message}${w}` }] };
}
async function ae(code, label, timeoutMs) {
  try {
    const r = await runJsx(code, { label, timeoutMs });
    const out = { result: r.result };
    if (r.warnings.length) out.warnings = r.warnings;
    return ok(out);
  } catch (e) { return fail(e); }
}

// ---------- shared schemas
const vec3 = z.array(z.number()).length(3);
const ease = z.enum(["glide", "glideStrong", "punch", "pop", "soft", "exit", "linear"]);
const dir = z.enum(["down", "up", "left", "right", "in", "out"]);
const move = {
  dir: dir.optional().describe("Camera direction: down/up = crane, left/right = truck, in/out = push in / pull out"),
  dist: z.number().optional().describe("Pixels. Defaults come from the profile (cameraMoves.typicalDistancePx)"),
  by: vec3.optional().describe("Explicit controller delta [x,y,z] instead of dir/dist"),
  frames: z.number().int().optional().describe("Move length (glide 40, punch 20)"),
  ease: ease.optional().describe("glide = 40f 85/85 (default), glideStrong = 40f 100/100, punch = 20f linear->100"),
};
const textStyle = z.enum(["blurRise", "bounceWords", "fadeHighlight", "charFade", "none"]);
const textFields = {
  text: z.string(),
  at: z.number().optional().describe("Frame the reveal starts (default 0). Put it on the cut."),
  end: z.number().optional().describe("Frame the layer ends (default comp end / shot end)"),
  x: z.number().optional().describe("Offset from comp centre, px"), y: z.number().optional(), z: z.number().optional(),
  style: textStyle.optional().describe("blurRise (default), bounceWords, fadeHighlight, charFade"),
  frames: z.number().optional().describe("Reveal length (blurRise default 34)"),
  accent: z.array(z.string()).optional().describe("Words/phrases to colour in the accent blue"),
  size: z.number().optional(), scale: z.number().optional().describe("Layer scale % (default 75)"),
  color: z.array(z.number()).optional(), align: z.enum(["left", "center", "right"]).optional(),
  exit: z.enum(["fade", "cut"]).optional(), parent: z.string().optional(), name: z.string().optional(),
};
const imageFields = {
  file: z.string().describe("Absolute path to an image/video on this computer"),
  at: z.number().optional(), end: z.number().optional(),
  x: z.number().optional(), y: z.number().optional(), z: z.number().optional(),
  width: z.number().optional().describe("Target width in px (sets scale)"), scale: z.number().optional(),
  enter: z.enum(["blurPop", "blurPopSoft", "logoTumble", "videoPop", "none"]).optional(),
  enterFrames: z.number().optional(),
  exit: z.union([z.enum(["blurOut", "none"]), z.boolean()]).optional(), exitAt: z.number().optional(), exitFrames: z.number().optional(),
  shadow: z.boolean().optional(), float: z.boolean().optional().describe("Gentle idle float"),
  parent: z.string().optional(), name: z.string().optional(),
};

// ---------- tools
server.registerTool("ae_status", {
  title: "After Effects status",
  description: "Check that After Effects is reachable and list the open project's comps. Call this first.",
  inputSchema: {},
}, async () => {
  const info = await findAfterEffects().catch((e) => ({ error: e.message }));
  const base = { afterEffects: info, panelListening: listenerAlive(), bridgeFolder: BRIDGE_DIR };
  try {
    const r = await runJsx("return CS.status();", { label: "status", timeoutMs: 30000 });
    return ok({ ...base, project: r.result, via: r.via });
  } catch (e) { return ok({ ...base, error: e.message }); }
});

server.registerTool("get_style_guide", {
  title: "Get the house style",
  description: "Returns the learned animation style (camera rig, split-move cuts, eases, text reveals, typography, image entrances) as a guide plus the exact numbers. Read before planning a video.",
  inputSchema: { includeProfileJson: z.boolean().optional() },
}, async ({ includeProfileJson }) => {
  const md = fs.readFileSync(STYLE_MD_PATH, "utf8");
  return ok(includeProfileJson === false ? md : md + "\n\n---\nprofile.json:\n" + fs.readFileSync(PROFILE_PATH, "utf8"));
});

server.registerTool("build_storyboard", {
  title: "Build a whole video from a storyboard",
  description: [
    "Creates scene precomps (with the aurora background and camera rig), one camera shot per beat, the signature split-move cuts between shots,",
    "camera moves, text and images, then assembles everything in a Main comp. Times in shots are frames relative to the shot start (30 fps).",
    "Shape: {main?:'Main', palette?:'blue'|'warm'|[[r,g,b]x4], replace?:bool, scenes:[{name, exit?:'whip'|'blur'|'cut', palette?,",
    " shots:[{name?, frames (≈75-170), enter?:{dir,dist?,ease?,frames?} (the shared move INTO this shot), moves?:[{at,dir,dist?,ease?}],",
    " elements:[{type:'text', text, at?, y?, style?, accent?:[...]} | {type:'image'|'video', file, at?, x?, y?, width?, enter?, float?}]}]}]}.",
    "Text 'at' defaults to 0 = on the cut. Keep one idea per shot.",
  ].join(" "),
  inputSchema: { storyboard: z.object({}).passthrough() },
}, async ({ storyboard }) => ae(`return CS.buildStoryboard(${J(storyboard)});`, "build storyboard", 900000));

server.registerTool("create_scene", {
  title: "Create a scene comp",
  description: "New 1920x1080 30fps comp with Advanced 3D, motion blur, the aurora background and the Control Null drift rig.",
  inputSchema: { name: z.string(), frames: z.number().int(), palette: z.union([z.enum(["blue", "warm"]), z.array(z.array(z.number()))]).optional(),
    background: z.boolean().optional(), replace: z.boolean().optional() },
}, async (a) => ae(`var c = CS.createScene(${J(a)}); return {comp: c.name, frames: Math.round(c.duration * c.frameRate)};`, "create scene"));

server.registerTool("add_shot", {
  title: "Add a camera shot",
  description: "Adds Camera_Controller <name> (parented to Control Null) + one-node 50mm Camera <name>, trimmed to [start,end) frames.",
  inputSchema: { comp: z.string(), name: z.string(), start: z.number(), end: z.number(), offset: vec3.optional(), overshoot: z.boolean().optional() },
}, async (a) => ae(`return CS.addShot(${J(a.comp)}, ${J(a)});`, "add shot"));

server.registerTool("move_camera", {
  title: "Move a shot's camera",
  description: "Keyframes the shot's controller: a move starting at frame `at`. Holds are automatic between moves.",
  inputSchema: { comp: z.string(), shot: z.string(), at: z.number(), ...move },
}, async (a) => ae(`return CS.moveCamera(${J(a.comp)}, ${J(a.shot)}, ${J(a)});`, "move camera"));

server.registerTool("split_cut", {
  title: "Signature split-move cut",
  description: "Cuts from shot `from` to shot `to` at frame `at` in the middle of one shared move: `from` plays the first half, `to` the second half. Also trims both cameras to the cut.",
  inputSchema: { comp: z.string(), from: z.string(), to: z.string(), at: z.number(), ...move },
}, async (a) => ae(`return CS.splitCut(${J(a.comp)}, ${J(a.from)}, ${J(a.to)}, ${J(a)});`, "split cut"));

server.registerTool("add_text", {
  title: "Add text in the house style",
  description: "Text in the profile font and size, 3D, centred, with a reveal animator (blurRise default) and optional accent-coloured words.",
  inputSchema: { comp: z.string(), ...textFields },
}, async (a) => ae(`return CS.addText(${J(a.comp)}, ${J(a)});`, "add text"));

server.registerTool("add_image", {
  title: "Add an image / screenshot / video",
  description: "Imports the file (once), adds it as a 3D layer with the double navy drop shadow and an entrance (blurPop default).",
  inputSchema: { comp: z.string(), ...imageFields },
}, async (a) => ae(`return CS.addImage(${J(a.comp)}, ${J(a)});`, "add image", 300000));

server.registerTool("animate_layer", {
  title: "Animate a layer in or out",
  description: "Applies a house-style entrance (blurPop, blurPopSoft, logoTumble, videoPop) or exit (blurOut) to any existing layer.",
  inputSchema: { comp: z.string(), layer: z.string(), kind: z.enum(["in", "out"]),
    type: z.enum(["blurPop", "blurPopSoft", "logoTumble", "videoPop", "blurOut"]).optional(), at: z.number(), frames: z.number().optional() },
}, async (a) => ae(a.kind === "in"
  ? `return CS.enter(${J(a.comp)}, ${J(a.layer)}, ${J(a.type || "blurPop")}, ${J(a.at)}, ${J(a.frames)});`
  : `return CS.exit(${J(a.comp)}, ${J(a.layer)}, ${J(a.type || "blurOut")}, ${J(a.at)}, ${J(a.frames)});`, "animate layer"));

server.registerTool("place_scene", {
  title: "Place a scene in the main comp",
  description: "Adds scene comp `scene` to `main` (created if missing) starting at frame `at`.",
  inputSchema: { main: z.string().optional(), scene: z.string(), at: z.number() },
}, async (a) => ae(`var s = CS.comp(${J(a.scene)}); var m = CS.ensureMain(${J(a.main || "Main")}, ${J(a.at)} + Math.round(s.duration * s.frameRate)); return CS.placeScene(m, s, ${J(a.at)});`, "place scene"));

server.registerTool("inspect_comp", {
  title: "Inspect a comp",
  description: "Lists layers with type, in/out frames, parent, position and key counts.",
  inputSchema: { comp: z.string().optional().describe("Defaults to the active comp") },
}, async (a) => ae(`return CS.inspect(${J(a.comp || null)});`, "inspect"));

server.registerTool("render_frame", {
  title: "Render a frame to look at",
  description: "Renders one frame of a comp to PNG and returns the image so you can check the result. Use just after cuts and mid-shot.",
  inputSchema: { comp: z.string(), frame: z.number().int() },
}, async ({ comp, frame }) => {
  const file = path.join(RENDERS, `${comp.replace(/[^\w.-]+/g, "_")}_${frame}_${Date.now()}.png`);
  try {
    const r = await runJsx(`return CS.renderFrame(${J(comp)}, ${J(frame)}, ${J(file)});`, { label: "render frame", timeoutMs: 300000 });
    if (!(await waitForFile(file, 60000))) return fail(new Error("Frame was not written: " + file));
    const data = fs.readFileSync(file).toString("base64");
    return ok({ comp, frame, path: file, method: r.result && r.result.method }, [{ type: "image", data, mimeType: "image/png" }]);
  } catch (e) { return fail(e); }
});

server.registerTool("run_extendscript", {
  title: "Run custom ExtendScript",
  description: "Escape hatch for anything the other tools don't cover. Code is a function body (ES3: var, no arrow functions, no JSON); `return` a value to get it back. The style library is available as CS.* (CS.comp, CS.layer, CS.animate, CS.addEffect, CS.profile …). Wrapped in one undo group.",
  inputSchema: { code: z.string(), label: z.string().optional() },
}, async (a) => ae(a.code, a.label || "custom script", 300000));

server.registerTool("undo", {
  title: "Undo",
  description: "Undo the last N Claude actions in After Effects (each tool call is one undo step).",
  inputSchema: { steps: z.number().int().min(1).max(20).optional() },
}, async (a) => ae(`for (var i = 0; i < ${a.steps || 1}; i++) app.executeCommand(16); return {undone: ${a.steps || 1}};`, "undo"));

// resources: the style guide
server.registerResource("style-guide", "style://guide", { title: "House style guide", mimeType: "text/markdown" },
  async (uri) => ({ contents: [{ uri: uri.href, text: fs.readFileSync(STYLE_MD_PATH, "utf8") }] }));
server.registerResource("style-profile", "style://profile", { title: "House style profile (JSON)", mimeType: "application/json" },
  async (uri) => ({ contents: [{ uri: uri.href, text: fs.readFileSync(PROFILE_PATH, "utf8") }] }));

const transport = new StdioServerTransport();
await server.connect(transport);
