// Runs the style library inside a simulated After Effects and checks the result
// against the learned style. Also smoke-tests the MCP server over stdio.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { makeAE } from "./mock-ae.mjs";

process.env.AE_BRIDGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "aebridge-"));
const { buildJob } = await import("../server/bridge.js");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profile = JSON.parse(fs.readFileSync(process.env.AE_STYLE_PROFILE || path.join(ROOT, "style/profile.json"), "utf8"));
// expected values come from the active profile, so the suite passes for any style
const EZ = profile.cameraMoves.eases, G = EZ.glide, GS = EZ.glideStrong, PU = EZ.punch, DIST = profile.cameraMoves.typicalDistancePx;
const TX = profile.text, BR = TX.reveals.blurRise, FH = TX.reveals.fadeHighlight, IMG = profile.images.enter;

let passed = 0;
const check = (name, fn) => { try { fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name, "\n     ", e.message); process.exitCode = 1; } };

function job(ae, code, label = "test") {
  const rp = path.join(process.env.AE_BRIDGE_DIR, `r-${Math.random().toString(36).slice(2)}.json`);
  const { text, userLineOffset } = buildJob(code, label, rp);
  ae.run(text);
  const res = JSON.parse(fs.readFileSync(rp, "utf8"));
  res.userLineOffset = userLineOffset;
  return res;
}
const comp = (ae, n) => ae.project._items.find((i) => i.name === n);
const layer = (c, n) => c._layers.find((l) => l.name === n);
const pos = (L) => L.property("ADBE Transform Group").property("ADBE Position");
const deq = (a, b, m) => assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), m);
const near = (a, b, eps = 1e-3) => Math.abs(a - b) < eps;
const vnear = (a, b) => a.every((x, i) => near(x, b[i], 0.01));

console.log("\n1. status + error handling");
{
  const ae = makeAE();
  const r = job(ae, "return CS.status();");
  check("status runs", () => { assert.equal(r.ok, true); assert.equal(r.result.comps.length, 0); });
  const e = job(ae, "var x = 1;\nreturn CS.comp('Nope');");
  check("errors come back with a message", () => { assert.equal(e.ok, false); assert.match(e.error, /Comp not found: Nope/); });
  check("undo group closed after error", () => assert.equal(ae.app._undoDepth(), 0));
}

console.log("\n2. full storyboard");
const ae = makeAE();
const storyboard = {
  main: "Main", palette: "blue",
  scenes: [
    { name: "S01", exit: "whip", shots: [
      { name: "S01A", frames: 110, elements: [
        { type: "text", text: "Already using Acme Cloud?", style: "blurRise", accent: ["Acme Cloud"] },
        { type: "image", file: "/tmp/logo.png", at: 4, y: -160, width: 600, enter: "logoTumble" } ] },
      { name: "S01B", frames: 100, enter: { dir: "out", ease: "glide" }, moves: [{ at: 40, dir: "in", ease: "punch" }], elements: [
        { type: "image", file: "/tmp/dashboard.png", at: 0, width: 1100, float: true },
        { type: "text", text: "Acme’s CRA MCP turns gaps into actions", y: 380, style: "fadeHighlight", accent: ["CRA MCP"] } ] } ] },
    { name: "S02", exit: "blur", shots: [
      { name: "S02A", frames: 90, enter: { dir: "down", dist: 420, ease: "glideStrong" }, elements: [
        { type: "text", text: "outstanding issues.", style: "bounceWords" } ] },
      { name: "S02B", frames: 120, enter: { dir: "right" }, elements: [
        { type: "text", text: "Learn more", style: "charFade", exit: "fade" },
        { type: "video", file: "/tmp/clip.mp4", y: 100, width: 1200 } ] } ] },
  ],
};
const res = job(ae, `return CS.buildStoryboard(${JSON.stringify(storyboard)});`, "build storyboard");
check("storyboard built without errors", () => assert.equal(res.ok, true, res.error));
if (!res.ok) { console.log(res); process.exit(1); }
console.log("     warnings:", JSON.stringify(res.warnings));

const S01 = comp(ae, "S01"), S02 = comp(ae, "S02"), Main = comp(ae, "Main");
check("scene lengths = sum of shots", () => { assert.equal(Math.round(S01.duration * 30), 210); assert.equal(Math.round(S02.duration * 30), 210); });
check("comp settings: 1920x1080 30fps Advanced 3D, motion blur", () => {
  assert.equal(S01.width, 1920); assert.equal(S01.frameRate, 30); assert.equal(S01.renderer, "ADBE Advanced 3d"); assert.equal(S01.motionBlur, true); });
check("Main holds the scenes back to back", () => {
  const ls = Main._layers.slice().sort((a, b) => a.startTime - b.startTime);
  assert.equal(ls.length, 2); assert.equal(ls[0].source.name, "S01"); assert.equal(ls[1].startTime * 30, 210); });
check("background at the bottom: blobs + base solid", () => {
  const n = S01._layers.length, last3 = S01._layers.slice(n - 3).map((l) => l.name);
  deq(last3, ["BG Blob Bottom", "BG Blob Top", "BG Base"]);
  const blob = layer(S01, "BG Blob Top");
  assert.equal(blob.property("ADBE Effect Parade").numProperties, 5);
  assert.equal(blob.threeDLayer, true);
  deq(pos(blob).value, [960, 318.67, 1513]);
  const grad = blob.property("ADBE Effect Parade").property(3);
  deq(grad.property("ADBE 4ColorGradient-0002").value, profile.palettes.blue[0]);
  assert.equal(blob.property("ADBE Root Vectors Group").property(2).property("ADBE Vector Temporal Freq").value, profile.background.blob.wiggle.wigglesPerSecond); });
check("Control Null with drift sliders + expression", () => {
  const cn = layer(S01, "Control Null");
  assert.equal(cn.threeDLayer, true); assert.match(pos(cn).expression, /TC - freq/);
  assert.equal(cn.property("ADBE Effect Parade").property("TC - ampZ").property(1).value, profile.cameraRig.controlNull.drift.ampZ); });
check("camera rig: one-node 50mm camera parented to controller parented to Control Null", () => {
  const cam = layer(S01, "Camera S01A"), ctrl = layer(S01, "Camera_Controller S01A");
  assert.equal(cam.autoOrient, 1); assert.equal(cam.parent, ctrl); assert.equal(ctrl.parent.name, "Control Null");
  assert.ok(near(cam.property("ADBE Camera Options Group").property("ADBE Camera Zoom").value, 2666.6667));
  deq(pos(cam).value, [0, 0, -2666.6667]); });

check("split-move cut S01A -> S01B at frame 110: same move, cut at midpoint", () => {
  const A = pos(layer(S01, "Camera_Controller S01A")), B = pos(layer(S01, "Camera_Controller S01B"));
  const h = G.frames / 2;
  deq(A.keys.map((k) => Math.round(k.t * 30)), [110 - h, 110 + h]);
  deq(B.keys.map((k) => Math.round(k.t * 30)).slice(0, 2), [110 - h, 110 + h]);
  const dA = A.keys[1].v.map((x, i) => x - A.keys[0].v[i]), dB = B.keys[1].v.map((x, i) => x - B.keys[0].v[i]);
  deq(dA, [0, 0, -DIST.dolly]); deq(dB, [0, 0, -DIST.dolly]);
  deq(B.keys[1].v, [0, 0, 0], "incoming shot lands on its rest framing");
  assert.equal(A.keys[0].outE[0].influence, G.outInfluence); assert.equal(A.keys[1].inE[0].influence, G.inInfluence);
  assert.equal(Math.round(layer(S01, "Camera S01A").outPoint * 30), 110);
  assert.equal(Math.round(layer(S01, "Camera S01B").inPoint * 30), 110); });
check("punch move inside S01B (at +40 = frame 150, linear out -> 100 in)", () => {
  const B = pos(layer(S01, "Camera_Controller S01B"));
  const k = B.keys.filter((k) => Math.round(k.t * 30) >= 150 && Math.round(k.t * 30) <= 150 + PU.frames);
  deq(k.map((x) => Math.round(x.t * 30)), [150, 150 + PU.frames]);
  assert.equal(k[0].outI, 6612); assert.equal(k[1].inE[0].influence, 100);
  deq(k[1].v.map((x, i) => x - k[0].v[i]), [0, 0, DIST.dollyPunch]); });
check("whip into S02: S01's last shot starts the move, S02's first shot finishes it", () => {
  const A = pos(layer(S01, "Camera_Controller S01B")), B = pos(layer(S02, "Camera_Controller S02A"));
  const lastA = A.keys.slice(-2).map((k) => Math.round(k.t * 30));
  deq(lastA, [210 - GS.frames / 2, 210 + GS.frames / 2]);
  deq(B.keys.slice(0, 2).map((k) => Math.round(k.t * 30)), [-GS.frames / 2, GS.frames / 2]);
  assert.equal(B.keys[0].outE[0].influence, GS.outInfluence, "glideStrong ease"); });
check("text: blurRise animator values + Start keys on the cut", () => {
  const t = S01._layers.find((l) => l.kind === "text" && /Already/.test(l.name));
  const anim = t.property("ADBE Text Properties").property("ADBE Text Animators").property(1);
  const props = anim.property("ADBE Text Animator Properties");
  deq(props.property("ADBE Text Position 3D").value, BR.animator.position);
  deq(props.property("ADBE Text Blur").value, BR.animator.blur);
  assert.equal(props.property("ADBE Text Tracking Amount").value, BR.animator.trackingAmount);
  const sel = anim.property("ADBE Text Selectors").property(1);
  deq(sel.property("ADBE Text Percent Start").keys.map((k) => Math.round(k.t * 30)), [0, BR.start.frames]);
  assert.equal(sel.property("ADBE Text Range Advanced").property("ADBE Text Range Type2").value, 3);
  const doc = t.property("ADBE Text Properties").property("ADBE Text Document").value;
  assert.equal(doc.font, TX.font); assert.equal(doc.fontSize, TX.fontSize);
  assert.equal(t.threeDLayer, true); assert.equal(t.motionBlur, true); });
check("accent words: index range selector on 'Acme Cloud'", () => {
  const t = S01._layers.find((l) => l.kind === "text" && /Already/.test(l.name));
  const acc = t.property("ADBE Text Properties").property("ADBE Text Animators").property(2);
  assert.equal(acc.name, "Accent 1");
  const sel = acc.property("ADBE Text Selectors").property(1);
  assert.equal(sel.property("ADBE Text Index Start").value, 14); assert.equal(sel.property("ADBE Text Index End").value, 24); });
check("non-ASCII text survives the bridge (Acme’s)", () => {
  const t = S01._layers.find((l) => l.kind === "text" && /CRA/.test(l.name));
  assert.equal(t.property("ADBE Text Properties").property("ADBE Text Document").value.text, "Acme’s CRA MCP turns gaps into actions"); });
check("fadeHighlight: Fade + Tint animators, tint 3 frames behind", () => {
  const t = S01._layers.find((l) => l.kind === "text" && /CRA/.test(l.name));
  const an = t.property("ADBE Text Properties").property("ADBE Text Animators");
  assert.equal(an.property(1).name, "Fade"); assert.equal(an.property(2).name, "Tint");
  const s2 = an.property(2).property("ADBE Text Selectors").property(1).property("ADBE Text Percent Start");
  deq(s2.keys.map((k) => Math.round(k.t * 30)), [110 + FH.tint.delayFrames, 110 + FH.tint.delayFrames + FH.fade.frames]); });
check("bounceWords: expression selector with bounce", () => {
  const t = S02._layers.find((l) => l.kind === "text" && /outstanding/.test(l.name));
  const sel = t.property("ADBE Text Properties").property("ADBE Text Animators").property(1).property("ADBE Text Selectors").property(1);
  assert.equal(sel.matchName, "ADBE Text Expressible Selector"); assert.match(sel.property("ADBE Text Expressible Amount").expression, /decay/); });
check("logo: tumble entrance (orientation -> 0, rise, lens blur -> 0)", () => {
  const L = S01._layers.find((l) => l.name === "logo.png");
  const o = L.property("ADBE Transform Group").property("ADBE Orientation");
  deq(o.keys[0].v, IMG.logoTumble.orientationFrom); assert.equal(Math.round(o.keys[0].t * 30), 4);
  const p = pos(L); assert.equal(p.keys[0].v[1] - p.keys[1].v[1], IMG.logoTumble.riseFromPx);
  const blur = L.property("ADBE Effect Parade").property("Camera Lens Blur").property("ADBE Camera Lens Blur-0001");
  deq(blur.keys.map((k) => k.v), IMG.logoTumble.lensBlur);
  assert.equal(L.property("ADBE Effect Parade").property("Drop Shadow 2").property("ADBE Drop Shadow-0005").value, 20); });
check("image width -> scale, float expression, trimmed to its shot", () => {
  const L = S01._layers.find((l) => l.name === "dashboard.png");
  assert.ok(near(L.property("ADBE Transform Group").property("ADBE Scale").value[0], 1100 / 2400 * 100, 0.01));
  assert.match(pos(L).expression, /seedRandom/);
  assert.equal(Math.round(L.inPoint * 30), 110); assert.equal(Math.round(L.outPoint * 30), 210); });
check("video pop: scale-from + exposure flash", () => {
  const L = S02._layers.find((l) => l.name === "clip.mp4");
  const s = L.property("ADBE Transform Group").property("ADBE Scale");
  assert.ok(near(s.keys[0].v[0] / s.keys[1].v[0], IMG.videoPop.scaleFrom, 0.001));
  deq(L.property("ADBE Effect Parade").property("Exposure").property("ADBE Exposure2-0003").keys.map((k) => k.v), [IMG.videoPop.exposureFrom, 0]); });
check("blur exit at the end of S02 (last 15 frames)", () => {
  const L = S02._layers.find((l) => l.name === "clip.mp4");
  const blur = L.property("ADBE Effect Parade").property("Camera Lens Blur").property("ADBE Camera Lens Blur-0001");
  deq(blur.keys.map((k) => Math.round(k.t * 30)), [195, 210]); });
check("text exit fade over the last frames", () => {
  const t = S02._layers.find((l) => l.kind === "text" && /Learn/.test(l.name));
  const op = t.property("ADBE Transform Group").property("ADBE Opacity");
  deq(op.keys.map((k) => [Math.round(k.t * 30), k.v]), [[210 - TX.exit.frames, 100], [210, 0]]); });
check("no camera keyframes on the cameras themselves (only controllers)", () => {
  for (const c of [S01, S02]) for (const L of c._layers.filter((l) => l.kind === "camera")) assert.equal(pos(L).keys.length, 0); });
check("cameras never overlap in time (one active camera per frame)", () => {
  for (const c of [S01, S02]) {
    const cams = c._layers.filter((l) => l.kind === "camera").map((l) => [Math.round(l.inPoint * 30), Math.round(l.outPoint * 30)]).sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < cams.length; i++) assert.ok(cams[i][0] >= cams[i - 1][1], `overlap in ${c.name}: ${JSON.stringify(cams)}`);
  } });
check("undo groups balanced", () => assert.equal(ae.app._undoDepth(), 0));

console.log("\n3. granular calls");
{
  const a2 = makeAE({ fonts: [] });
  let r = job(a2, `var c = CS.createScene({name:"T1", frames:200, palette:"warm"}); CS.addShot(c,{name:"A",start:0,end:100}); CS.addShot(c,{name:"B",start:100,end:200});
                   CS.moveCamera(c,"A",{at:20,dir:"up"}); return CS.splitCut(c,"A","B",{at:100,dir:"left",ease:"glideStrong"});`);
  check("createScene/addShot/moveCamera/splitCut", () => { assert.equal(r.ok, true, r.error); deq(r.result.by, [-DIST.truck, 0, 0]); });
  const T1 = comp(a2, "T1"), A = pos(layer(T1, "Camera_Controller A"));
  check("hold between a move and the split cut", () => {
    deq(A.keys.map((k) => Math.round(k.t * 30)), [20, 20 + G.frames, 100 - GS.frames / 2, 100 + GS.frames / 2]);
    deq(A.keys[1].v, A.keys[2].v); });
  r = job(a2, `return CS.addText("T1", {text:"Hi", at: 100});`);
  check("missing font produces a warning, not a failure", () => { assert.equal(r.ok, true); assert.match(r.warnings.join(" "), /not found/); });
  r = job(a2, `return CS.addText("T1", {text:"Hi", style:"wobble"});`);
  check("bad style name is a clear error", () => { assert.equal(r.ok, false); assert.match(r.error, /Unknown text style/); });
  r = job(a2, `return CS.createScene({name:"T1", frames:10});`);
  check("refuses to overwrite an existing comp without replace", () => { assert.equal(r.ok, false); assert.match(r.error, /already exists/); });
  r = job(a2, `return CS.renderFrame("T1", 50, ${JSON.stringify(path.join(process.env.AE_BRIDGE_DIR, "f.png"))});`);
  check("renderFrame writes a PNG", () => { assert.equal(r.ok, true); assert.ok(fs.existsSync(r.result.path)); });
  r = job(a2, `return CS.inspect("T1");`);
  check("inspect lists layers", () => { assert.equal(r.ok, true); assert.ok(r.result.layers.some((l) => l.type === "camera")); });
}

console.log("\n4. MCP server over stdio");
{
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, "server/index.js")], env: { ...process.env } }));
  const tools = (await client.listTools()).tools.map((t) => t.name).sort();
  check("tools listed", () => deq(tools, ["add_image", "add_shot", "add_text", "ae_status", "animate_layer", "build_storyboard", "create_scene",
    "get_style_guide", "inspect_comp", "move_camera", "place_scene", "render_frame", "run_extendscript", "split_cut", "undo"]));
  const g = await client.callTool({ name: "get_style_guide", arguments: {} });
  check("get_style_guide returns the guide + profile", () => { assert.match(g.content[0].text, /split-move/i); assert.match(g.content[0].text, /"cameraRig"/); });
  const s = await client.callTool({ name: "ae_status", arguments: {} });
  check("ae_status answers without crashing (AE open or not)", () => assert.match(s.content[0].text, /not running|Unsupported|"running": true/));
  const res2 = await client.listResources();
  check("style resources exposed", () => assert.equal(res2.resources.length, 2));
  await client.close();
}
console.log(`\n${passed} checks passed${process.exitCode ? " – SOME FAILED" : ""}`);

console.log("\n5. shape-built UI + theme");
{
  const a3 = makeAE();
  const sb = { main: "Main", replace: true, theme: profile.themes.violet, scenes: [
    { name: "U01", at: 0, exit: "whip", shots: [
      { name: "U01A", frames: 120, elements: [
        { type: "eyebrow", text: "AIA · AI Integration Automation", y: -200 },
        { type: "card", title: "Engineers", subtitle: "read the docs, write it all", icon: "people", x: -420, at: 10 },
        { type: "connector", from: [-200, 0], to: [200, 0], at: 20, dashed: true },
        { type: "card", title: "One CRM app", subtitle: "in its own repo", icon: "doc", x: 420, at: 30 },
        { type: "chip", text: "8–22 active months", tone: "warn", y: 260, at: 40 } ] },
      { name: "U01B", frames: 150, enter: { dir: "down" }, elements: [
        { type: "checklist", title: "New CRM integration", y: -40, items: [{ text: "Connect the account", at: 10 }, { text: "Find the caller", at: 40 }] },
        { type: "stat", value: "779", label: "commits per repo", x: 500, at: 60 },
        { type: "track", steps: ["Sign-in", "Contact base", "Sidebar views"], y: 300, at: 80 } ] } ] },
    { name: "U02", at: 270, shots: [{ name: "U02A", frames: 60, elements: [{ type: "text", text: "This is AIA", accent: ["AIA"] }] }] } ] };
  const r = job(a3, `return CS.buildStoryboard(${JSON.stringify(sb)});`);
  check("UI storyboard builds", () => assert.equal(r.ok, true, r.error + " line " + r.line));
  if (r.ok) {
    const U = comp(a3, "U01");
    check("violet palette + base colour applied", () => {
      deq(layer(U, "BG Blob Top").property("ADBE Effect Parade").property(3).property("ADBE 4ColorGradient-0002").value, profile.palettes.violet[0]); });
    check("card = shape + parented text, text fades with the card", () => {
      const card = layer(U, "Card Engineers"); const kids = U._layers.filter((l) => l.parent === card);
      assert.equal(kids.length, 2); assert.equal(kids[0].property("ADBE Transform Group").property("ADBE Opacity").keys.length, 2);
      assert.equal(card.property("ADBE Effect Parade").property("Camera Lens Blur").property(1).keys.length, 2); });
    check("checklist rows tick in on their own frames", () => {
      const row = layer(U, "Row Find the caller"); assert.equal(Math.round(row.inPoint * 30), 160); });
    check("track progress keyed between steps", () => {
      const p = layer(U, "Track progress"); const rv = p.property("ADBE Root Vectors Group");
      assert.equal(rv.property(rv.numProperties).property("ADBE Vector Trim End").keys.length, 4); });
    check("accent colour = violet accent on text", () => {
      const t = comp(a3, "U02")._layers.find((l) => l.kind === "text");
      const acc = t.property("ADBE Text Properties").property("ADBE Text Animators").property(2).property("ADBE Text Animator Properties").property(1);
      deq(acc.value, profile.themes.violet.accentColor.concat([1])); });
    check("scenes placed at their own start frames in Main", () => {
      const M = comp(a3, "Main"); deq(M._layers.map((l) => Math.round(l.startTime * 30)).sort((a, b) => a - b), [0, 270]); });
    const r2 = job(a3, `return CS.buildStoryboard(${JSON.stringify(sb)});`);
    check("rebuild replaces scenes without duplicating them in Main", () => { assert.equal(r2.ok, true, r2.error); assert.equal(comp(a3, "Main")._layers.length, 2); });
  }
}
console.log(`\n${passed} checks passed${process.exitCode ? " – SOME FAILED" : ""}`);
