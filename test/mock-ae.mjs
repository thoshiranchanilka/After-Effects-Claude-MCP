// Minimal simulated After Effects scripting DOM for testing the style library outside AE.
// It models property trees (by matchName), keyframes, eases, layers, comps, files.
// Unknown method calls throw, so typos in the library surface here.
import fs from "node:fs";
import vm from "node:vm";

export function makeAE({ fonts = ["GoogleSansFlex-Regular", "Inter-Regular"] } = {}) {
  const PVT = { NO_VALUE: 1, ThreeD_SPATIAL: 2, ThreeD: 3, TwoD_SPATIAL: 4, TwoD: 5, OneD: 6, COLOR: 7, CUSTOM_VALUE: 8, MARKER: 9, LAYER_INDEX: 10, MASK_INDEX: 11, SHAPE: 12, TEXT_DOCUMENT: 13 };
  const KIT = { LINEAR: 6612, BEZIER: 6613, HOLD: 6614 };
  const log = [];
  class KeyframeEase { constructor(speed, influence) { if (influence < 0.1 || influence > 100) throw new Error("influence out of range " + influence); this.speed = speed; this.influence = influence; } }
  const GROUPS = new Set(["ADBE Transform Group", "ADBE Effect Parade", "ADBE Root Vectors Group", "ADBE Vector Group", "ADBE Vectors Group",
    "ADBE Vector Transform Group", "ADBE Text Properties", "ADBE Text Animators", "ADBE Text Animator", "ADBE Text Selectors", "ADBE Text Selector",
    "ADBE Text Expressible Selector", "ADBE Text Animator Properties", "ADBE Text Range Advanced", "ADBE Camera Options Group",
    "ADBE Vector Shape - Rect", "ADBE Vector Graphic - Fill", "ADBE Vector Filter - Roughen", "ADBE Vector Shape - Ellipse", "ADBE Vector Shape - Group",
    "ADBE Vector Graphic - Stroke", "ADBE Vector Filter - Trim", "ADBE Vector Stroke Dashes"]);
  const isEffect = (mn) => /^ADBE (Gaussian Blur 2|Box Blur2|4ColorGradient|Noise2|Posterize|Slider Control|Drop Shadow|Camera Lens Blur|Exposure2)$/.test(mn);
  // which children a group gets automatically
  const AUTO = {
    "ADBE Transform Group": ["ADBE Anchor Point", "ADBE Position", "ADBE Scale", "ADBE Orientation", "ADBE Rotate X", "ADBE Rotate Y", "ADBE Rotate Z", "ADBE Opacity"],
    "ADBE Text Selector": ["ADBE Text Percent Start", "ADBE Text Percent End", "ADBE Text Index Start", "ADBE Text Index End", "ADBE Text Range Advanced"],
    "ADBE Text Range Advanced": ["ADBE Text Range Units", "ADBE Text Range Type2", "ADBE Text Range Shape", "ADBE Text Selector Smoothness"],
    "ADBE Text Expressible Selector": ["ADBE Text Range Type2", "ADBE Text Expressible Amount"],
    "ADBE Text Animator": ["ADBE Text Selectors", "ADBE Text Animator Properties"],
    "ADBE Text Properties": ["ADBE Text Document", "ADBE Text Animators"],
    "ADBE Camera Options Group": ["ADBE Camera Zoom", "ADBE Camera Depth of Field"],
    "ADBE Vector Group": ["ADBE Vectors Group", "ADBE Vector Transform Group"],
    "ADBE Vector Transform Group": ["ADBE Vector Position"],
    "ADBE Vector Shape - Rect": ["ADBE Vector Rect Size", "ADBE Vector Rect Roundness"],
    "ADBE Vector Shape - Ellipse": ["ADBE Vector Ellipse Size"],
    "ADBE Vector Shape - Group": ["ADBE Vector Shape"],
    "ADBE Vector Graphic - Stroke": ["ADBE Vector Stroke Color", "ADBE Vector Stroke Width", "ADBE Vector Stroke Line Cap", "ADBE Vector Stroke Line Join", "ADBE Vector Stroke Dashes"],
    "ADBE Vector Filter - Trim": ["ADBE Vector Trim Start", "ADBE Vector Trim End", "ADBE Vector Trim Offset"],
    "ADBE Vector Graphic - Fill": ["ADBE Vector Fill Color"],
    "ADBE Vector Filter - Roughen": ["ADBE Vector Roughen Size", "ADBE Vector Roughen Detail", "ADBE Vector Roughen Points", "ADBE Vector Temporal Freq", "ADBE Vector Correlation", "ADBE Vector Random Seed"],
  };
  const EFFECT_PARAMS = { "ADBE Gaussian Blur 2": 3, "ADBE Box Blur2": 4, "ADBE 4ColorGradient": 12, "ADBE Noise2": 3, "ADBE Posterize": 1, "ADBE Slider Control": 1, "ADBE Drop Shadow": 6, "ADBE Camera Lens Blur": 21, "ADBE Exposure2": 5 };
  function vtype(mn) {
    if (/Position$|Anchor Point$/.test(mn) && !/Vector|Text Position 3D/.test(mn)) return PVT.ThreeD_SPATIAL;
    if (/Scale$|Orientation$|Text Position 3D|Expressible Amount/.test(mn)) return PVT.ThreeD;
    if (/Rect Size|Vector Position|Text Blur|4ColorGradient-000[1357]/.test(mn)) return PVT.TwoD;
    if (/Color|4ColorGradient-000[2468]|Drop Shadow-0001/.test(mn)) return PVT.COLOR;
    if (mn === "ADBE Text Document") return PVT.TEXT_DOCUMENT;
    if (mn === "ADBE Vector Shape") return PVT.SHAPE;
    if (mn === "ADBE Vector Ellipse Size") return PVT.TwoD;
    return PVT.OneD;
  }
  function defVal(mn) {
    const t = vtype(mn);
    if (mn === "ADBE Position") return [960, 540, 0];
    if (mn === "ADBE Scale") return [100, 100, 100];
    if (mn === "ADBE Opacity" || mn === "ADBE Text Percent End") return 100;
    if (t === PVT.ThreeD || t === PVT.ThreeD_SPATIAL) return [0, 0, 0];
    if (t === PVT.TwoD) return [0, 0];
    if (t === PVT.COLOR) return [1, 1, 1, 1];
    return 0;
  }
  class Prop {
    constructor(mn, parent, name) {
      this.matchName = mn; this.parentProperty = parent; this.name = name || mn.replace(/^ADBE (Vector |Text )?/, "");
      this.propertyType = 1; this.propertyValueType = vtype(mn); this._v = defVal(mn); this.keys = []; this.expression = ""; this.expressionEnabled = false; this.expressionError = "";
      this.isModified = false;
    }
    get value() { return this._v; }
    get numKeys() { return this.keys.length; }
    _dims(v) { const t = this.propertyValueType; const want = t === PVT.ThreeD || t === PVT.ThreeD_SPATIAL ? 3 : t === PVT.TwoD ? 2 : t === PVT.COLOR ? 4 : 1;
      if (t === PVT.TEXT_DOCUMENT) return;
      if (t === PVT.SHAPE) { if (!v || !v.vertices) throw new Error("shape value needs vertices"); return; } const n = Array.isArray(v) ? v.length : 1;
      if (n !== want) throw new Error(`${this.matchName}: value has ${n} dims, expected ${want}`); }
    setValue(v) { if (this.keys.length) throw new Error(this.matchName + ": setValue on a keyframed property"); this._dims(v); this._v = v; this.isModified = true; }
    setValueAtTime(t, v) { this._dims(v); let k = this.keys.find((k) => Math.abs(k.t - t) < 1e-6);
      if (!k) { k = { t, inI: KIT.LINEAR, outI: KIT.LINEAR, inE: null, outE: null }; this.keys.push(k); this.keys.sort((a, b) => a.t - b.t); }
      k.v = v; this.isModified = true; }
    _k(i) { const k = this.keys[i - 1]; if (!k) throw new Error(`${this.matchName}: no key ${i} (have ${this.keys.length})`); return k; }
    nearestKeyIndex(t) { let best = 1, bd = 1e9; this.keys.forEach((k, i) => { const d = Math.abs(k.t - t); if (d < bd) { bd = d; best = i + 1; } }); return best; }
    keyTime(i) { return this._k(i).t; } keyValue(i) { return this._k(i).v; }
    keyInInterpolationType(i) { return this._k(i).inI; } keyOutInterpolationType(i) { return this._k(i).outI; }
    setInterpolationTypeAtKey(i, a, b) { const k = this._k(i); if (![6612, 6613, 6614].includes(a)) throw new Error("bad interp"); k.inI = a; k.outI = b === undefined ? a : b; }
    _ed() { const t = this.propertyValueType; return t === PVT.ThreeD ? 3 : t === PVT.TwoD ? 2 : t === PVT.COLOR ? 4 : 1; }
    keyInTemporalEase(i) { const k = this._k(i); return k.inE || Array.from({ length: this._ed() }, () => new KeyframeEase(0, 16.666667)); }
    keyOutTemporalEase(i) { const k = this._k(i); return k.outE || Array.from({ length: this._ed() }, () => new KeyframeEase(0, 16.666667)); }
    setTemporalEaseAtKey(i, inE, outE) { const k = this._k(i); const n = this._ed();
      if (inE.length !== n || (outE && outE.length !== n)) throw new Error(`${this.matchName}: ease array length ${inE.length}, expected ${n}`);
      k.inE = inE; k.outE = outE || inE; }
    setSpatialAutoBezierAtKey(i) { this._k(i); } setSpatialContinuousAtKey(i) { this._k(i); }
    setSpatialTangentsAtKey(i, a, b) { this._k(i); if (a.length !== 3 || b.length !== 3) throw new Error("tangent dims"); }
    valueAtTime(t) { if (!this.keys.length) return this._v; const ks = this.keys;
      if (t <= ks[0].t) return ks[0].v; if (t >= ks[ks.length - 1].t) return ks[ks.length - 1].v;
      for (let i = 0; i < ks.length - 1; i++) if (t >= ks[i].t && t <= ks[i + 1].t) { const u = (t - ks[i].t) / (ks[i + 1].t - ks[i].t);
        const a = ks[i].v, b = ks[i + 1].v; return Array.isArray(a) ? a.map((x, j) => x + (b[j] - x) * u) : a + (b - a) * u; } }
  }
  class Group {
    constructor(mn, parent, name) { this.matchName = mn; this.parentProperty = parent; this.name = name || mn; this.propertyType = 3; this.children = [];
      for (const c of AUTO[mn] || []) this._make(c);
      if (isEffect(mn)) for (let i = 1; i <= EFFECT_PARAMS[mn]; i++) this.children.push(new Prop(`${mn}-${String(i).padStart(4, "0")}`, this)); }
    _make(mn) { const c = GROUPS.has(mn) || isEffect(mn) || mn === "ADBE Text Animator" ? new Group(mn, this) : new Prop(mn, this); this.children.push(c); return c; }
    get numProperties() { return this.children.length; }
    property(k) { if (typeof k === "number") { const c = this.children[k - 1]; if (!c) throw new Error(`${this.matchName}.property(${k}) out of range`); return c; }
      return this.children.find((c) => c.matchName === k || c.name === k) || null; }
    canAddProperty() { return true; }
    addProperty(mn) { const ok = GROUPS.has(mn) || isEffect(mn) || mn === "ADBE Vector Stroke Dash 1" || /^ADBE (Text (Position 3D|Opacity|Tracking Amount|Blur|Fill Color)|Text Selector|Text Expressible Selector|Text Animator)$/.test(mn);
      if (!ok) throw new Error("addProperty: unknown matchName " + mn); return this._make(mn); }
  }
  let layerSeq = 0;
  class Layer {
    constructor(comp, kind, name) { this.containingComp = comp; this.kind = kind; this.name = name; this.id = ++layerSeq; this.inPoint = 0; this.outPoint = comp.duration;
      this.startTime = 0; this._3d = false; this.motionBlur = false; this.parent = null; this.enabled = true; this.label = 0; this.locked = false;
      this.nullLayer = kind === "null"; this.adjustmentLayer = false; this.autoOrient = 1;
      this.root = new Group("root", null); this.root.children.push(new Group("ADBE Transform Group", this.root), new Group("ADBE Effect Parade", this.root));
      if (kind === "shape") this.root.children.push(new Group("ADBE Root Vectors Group", this.root));
      if (kind === "text") this.root.children.push(new Group("ADBE Text Properties", this.root));
      if (kind === "camera") this.root.children.push(new Group("ADBE Camera Options Group", this.root)); }
    get threeDLayer() { return this._3d; } set threeDLayer(v) { if (this.kind === "camera") throw new Error("camera has no threeDLayer"); this._3d = v; }
    get index() { return this.containingComp._layers.indexOf(this) + 1; }
    property(k) { return this.root.property(k); }
    moveToEnd() { const a = this.containingComp._layers; a.splice(a.indexOf(this), 1); a.push(this); }
    sourceRectAtTime() { return { left: -300, top: -60, width: 600, height: 80 }; }
    remove() { const a = this.containingComp._layers; a.splice(a.indexOf(this), 1); }
    openInViewer() {}
  }
  class TextDocument { constructor(t) { this.text = t; this._font = "ArialMT"; this.fontSize = 36; this.fillColor = [1, 1, 1]; this.applyFill = true; this.applyStroke = false; this.tracking = 0; this.justification = 7413; this.autoLeading = true; this.leading = 0; }
    get font() { return this._font; } set font(f) { this._font = fonts.includes(f) ? f : this._font; }
    resetCharStyle() {} resetParagraphStyle() {} }
  class Item { constructor(name) { this.name = name; this.id = ++layerSeq; this.parentFolder = null; } remove() { const i = project._items.indexOf(this); if (i >= 0) project._items.splice(i, 1); } }
  class FolderItem extends Item {}
  class FootageItem extends Item { constructor(file) { super(file.name); this.file = file; this.width = 2400; this.height = 1500; this.hasVideo = true; this.mainSource = {}; this.duration = 0; } }
  class CompItem extends Item {
    constructor(name, w, h, pa, dur, fps) { super(name); Object.assign(this, { width: w, height: h, pixelAspect: pa, duration: dur, frameRate: fps });
      this._layers = []; this.renderers = ["ADBE Advanced 3d", "ADBE Calder"]; this.renderer = "ADBE Advanced 3d"; this.motionBlur = false; this.shutterAngle = 180; this.bgColor = [0, 0, 0];
      const comp = this;
      this.layers = {
        addSolid: (c, n) => comp._add(new Layer(comp, "solid", n)),
        addShape: () => comp._add(new Layer(comp, "shape", "Shape Layer " + (comp._layers.length + 1))),
        addNull: (d) => { const L = comp._add(new Layer(comp, "null", "Null " + (comp._layers.length + 1))); if (d) L.outPoint = d; return L; },
        addCamera: (n, c) => { if (!Array.isArray(c) || c.length !== 2) throw new Error("addCamera centerPoint must be [x,y]"); const L = comp._add(new Layer(comp, "camera", n)); L.autoOrient = 2; return L; },
        addText: (t) => { const L = comp._add(new Layer(comp, "text", t)); const doc = L.property("ADBE Text Properties").property("ADBE Text Document"); doc._v = new TextDocument(t); return L; },
        add: (item) => { const L = comp._add(new Layer(comp, item instanceof CompItem ? "precomp" : "av", item.name)); L.source = item; return L; },
      }; }
    get numLayers() { return this._layers.length; }
    layer(i) { const L = this._layers[i - 1]; if (!L) throw new Error("no layer " + i); return L; }
    _add(L) { this._layers.unshift(L); return L; }
    saveFrameToPng(t, f) { fs.writeFileSync(f.fsName, "PNG"); }
    openInViewer() {}
  }
  class TextLayer extends Layer {} class ShapeLayer extends Layer {} class CameraLayer extends Layer {} class AVLayer extends Layer {}
  // patch instanceof checks: make kinds map to classes
  const kindClass = { text: TextLayer, shape: ShapeLayer, camera: CameraLayer, solid: AVLayer, null: AVLayer, av: AVLayer, precomp: AVLayer };
  const origAdd = CompItem.prototype._add;
  CompItem.prototype._add = function (L) { Object.setPrototypeOf(L, kindClass[L.kind].prototype); return origAdd.call(this, L); };
  Object.setPrototypeOf(TextLayer.prototype, AVLayer.prototype); Object.setPrototypeOf(ShapeLayer.prototype, AVLayer.prototype);
  Object.setPrototypeOf(CameraLayer.prototype, Layer.prototype);

  const project = {
    _items: [], file: null, activeItem: null, selection: [], renderQueue: { numItems: 0, items: {} },
    get numItems() { return this._items.length; }, item(i) { return this._items[i - 1]; },
    items: { addComp: (...a) => { const c = new CompItem(...a); project._items.push(c); return c; }, addFolder: (n) => { const f = new FolderItem(n); project._items.push(f); return f; } },
    importFile: (io) => { const f = new FootageItem(io.file); project._items.push(f); return f; },
  };
  let undoDepth = 0;
  const app = { project, version: "25.0 (mock)", beginUndoGroup() { undoDepth++; }, endUndoGroup() { undoDepth--; }, executeCommand(id) { log.push("cmd " + id); }, _undoDepth: () => undoDepth };
  class File {
    constructor(p) { this.fsName = p; this.name = p.split("/").pop(); this.encoding = ""; }
    get exists() { return fs.existsSync(this.fsName) || /\.(png|jpg|mp4|mov)$/i.test(this.fsName); }
    get parent() { return { fsName: this.fsName.split("/").slice(0, -1).join("/") }; }
    open() { this._buf = ""; return true; } write(s) { this._buf += s; } close() { fs.writeFileSync(this.fsName, this._buf); } remove() { try { fs.unlinkSync(this.fsName); } catch {} return true; }
  }
  const ctx = {
    app, File, Folder: class { constructor(p) { this.fsName = p; } }, ImportOptions: class { constructor(f) { this.file = f; } },
    KeyframeEase, CompItem, FolderItem, FootageItem, TextLayer, ShapeLayer, CameraLayer, AVLayer,
    PropertyValueType: PVT, KeyframeInterpolationType: KIT, AutoOrientType: { NO_AUTO_ORIENT: 1, CAMERA_OR_POINT_OF_INTEREST: 2, ALONG_PATH: 3 },
    ParagraphJustification: { LEFT_JUSTIFY: 7413, RIGHT_JUSTIFY: 7414, CENTER_JUSTIFY: 7415 }, RQItemStatus: { QUEUED: 1 },
    Shape: class { constructor() { this.vertices = []; this.closed = true; } },
    console,
  };
  vm.createContext(ctx);
  return { ctx, app, project, log, run: (src) => vm.runInContext(src, ctx, { filename: "job.jsx" }) };
}
