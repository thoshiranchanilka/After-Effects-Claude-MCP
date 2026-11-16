/*  AE Style Exporter  v4.0
    ------------------------------------------------------------
    Dumps an After Effects project to JSON so Claude can learn your
    animation style: keyframes + easing, layer timing / transitions,
    text animators, typography, effects, expressions, shapes, masks.

    Writes three files per project:
      <name>.full.json     everything (every comp, layer, changed property, camera paths)
      <name>.summary.json  compact style statistics (start here with Claude)
      <name>.camera.json   3D camera work: world-space moves, ease shape, camera
                           handoffs, scene-to-scene joins and 3D scene layout

    Camera analysis adds a temporary hidden null ("__style_exporter_probe__") to
    each comp, reads camera world positions through expressions, then deletes it.
    Your project is left as it was (run it on a saved copy if you want to be safe).

    HOW TO RUN
      1. AE > Settings > Scripting & Expressions >
         tick "Allow Scripts to Write Files and Access Network"
      2. Open your project, select (or open) the MAIN comp
      3. File > Scripts > Run Script File... > pick this file
      4. In the dialog: confirm the main comp, choose options, Export

    Only the main comp and the precomps nested inside it are exported -
    unused / leftover comps in the project are ignored.

    Batch mode opens each .aep, picks its main comp automatically
    (render queue comp > comp named main/final/master > biggest comp tree),
    exports it, and closes the project WITHOUT saving.
    ExtendScript is ES3 - no let/const/arrow functions on purpose.
*/

(function AEStyleExporter() {

    // ---------------- settings ----------------
    var MAX_KEYS_PER_PROP = 300;     // safety cap for very dense keyframe data
    var MAX_SHAPE_VERTS   = 64;      // shape paths bigger than this are summarised
    var MAX_EXPR_CHARS    = 4000;
    var ROUND             = 10000;   // 4 decimal places
    var SKIP_GROUPS = {               // noise we never need
        "ADBE Audio Group": true
    };
    var SKIP_IF_2D = {
        "ADBE Material Options Group": true,
        "ADBE Extrsn Options Group": true,
        "ADBE Plane Options Group": true
    };

    // ---------------- JSON (ES3 has none) ----------------
    function esc(s) {
        s = String(s);
        var out = "", c, code;
        for (var i = 0; i < s.length; i++) {
            c = s.charAt(i); code = s.charCodeAt(i);
            if (c === "\"") out += "\\\"";
            else if (c === "\\") out += "\\\\";
            else if (c === "\n") out += "\\n";
            else if (c === "\r") out += "\\r";
            else if (c === "\t") out += "\\t";
            else if (code < 32) { var h = code.toString(16); while (h.length < 4) h = "0" + h; out += "\\u" + h; }
            else out += c;
        }
        return "\"" + out + "\"";
    }
    function isArr(v) { return v instanceof Array || Object.prototype.toString.call(v) === "[object Array]"; }
    function stringify(v, ind, cur) {
        cur = cur || "";
        var nxt = cur + ind, parts = [], k;
        if (v === null || v === undefined) return "null";
        if (typeof v === "number") return isFinite(v) ? String(v) : "null";
        if (typeof v === "boolean") return v ? "true" : "false";
        if (typeof v === "string") return esc(v);
        if (isArr(v)) {
            if (v.length === 0) return "[]";
            var simple = true;
            for (k = 0; k < v.length; k++) if (typeof v[k] === "object" && v[k] !== null) { simple = false; break; }
            for (k = 0; k < v.length; k++) parts.push(stringify(v[k], ind, nxt));
            return simple ? "[" + parts.join(", ") + "]" : "[\n" + nxt + parts.join(",\n" + nxt) + "\n" + cur + "]";
        }
        for (k in v) if (v.hasOwnProperty(k) && v[k] !== undefined)
            parts.push(esc(k) + ": " + stringify(v[k], ind, nxt));
        if (parts.length === 0) return "{}";
        return "{\n" + nxt + parts.join(",\n" + nxt) + "\n" + cur + "}";
    }

    // ---------------- helpers ----------------
    function r(n) { return (typeof n === "number") ? Math.round(n * ROUND) / ROUND : n; }
    function rv(v) {
        if (typeof v === "number") return r(v);
        if (isArr(v)) { var o = []; for (var i = 0; i < v.length; i++) o.push(rv(v[i])); return o; }
        return v;
    }
    function safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }
    function f(t, fps) { return Math.round(t * fps * 100) / 100; }   // seconds -> frames
    function bump(map, key, n) { key = String(key); map[key] = (map[key] || 0) + (n || 1); }
    function pushU(arr, v) { for (var i = 0; i < arr.length; i++) if (arr[i] === v) return; arr.push(v); }

    function enumName(enumObj, val) {
        try { for (var k in enumObj) if (enumObj[k] === val) return k; } catch (e1) {}
        try {
            var ps = enumObj.reflect.properties;
            for (var i = 0; i < ps.length; i++) if (enumObj[ps[i].name] === val) return ps[i].name;
        } catch (e2) {}
        return val;
    }
    var INTERP = {}; INTERP[KeyframeInterpolationType.LINEAR] = "linear";
    INTERP[KeyframeInterpolationType.BEZIER] = "bezier"; INTERP[KeyframeInterpolationType.HOLD] = "hold";

    // ---------------- style stats (summary file) ----------------
    var S;
    function resetStats() {
        S = {
            layerTypes: {}, blendModes: {}, trackMattes: {},
            animatedProps: {}, interpolation: {},
            easeOutInfluence: {}, easeInInfluence: {}, easePairs: {},
            segmentFrames: {}, firstKeyOffsetFrames: {},
            effects: {}, textAnimatorProps: {}, textSelectorShapes: {},
            fonts: {}, fontSizes: {}, tracking: {}, leading: {}, textColors: {},
            expressions: [], layerOverlapFrames: {}, layerDurationsFrames: {},
            motionBlurLayers: 0, threeDLayers: 0, compSettings: [],
            cam: {
                count: 0, twoNode: 0, rigged: 0, dof: 0,
                focalMm: {}, moveFrames: {}, moveTypes: {}, easeLabels: {}, peakAtPct: {},
                handoffTypes: {}, joinOverlap: {}, joinTransitions: {}, examples: [],
                rigEase: {}, rigSegFrames: {}, holdFrames: {}, drift: {}
            },
            textRecipes: {}, textRecipeExamples: []
        };
    }
    function bucket(n, step) { return Math.round(n / step) * step; }

    // ---------------- TextDocument ----------------
    function dumpTextDoc(td) {
        var o = {};
        var keys = ["text", "font", "fontFamily", "fontStyle", "fontSize", "tracking", "leading",
            "autoLeading", "applyFill", "fillColor", "applyStroke", "strokeColor", "strokeWidth",
            "strokeOverFill", "justification", "allCaps", "smallCaps", "fauxBold", "fauxItalic",
            "baselineShift", "horizontalScale", "verticalScale", "tsume", "boxText", "boxTextSize",
            "lineJoinType", "firstLineIndent", "spaceBefore", "spaceAfter", "superscript", "subscript"];
        for (var i = 0; i < keys.length; i++) {
            var k = keys[i];
            var v = safe(function () { return td[k]; }, undefined);
            if (v === undefined || v === null) continue;
            if (k === "justification") v = enumName(ParagraphJustification, v);
            o[k] = rv(v);
        }
        if (o.text && o.text.length > 500) o.text = o.text.substring(0, 500) + "...";
        return o;
    }
    function statTextDoc(td) {
        if (td.font) bump(S.fonts, td.font + (td.fontStyle ? " / " + td.fontStyle : ""));
        if (td.fontSize) bump(S.fontSizes, Math.round(td.fontSize));
        if (td.tracking !== undefined) bump(S.tracking, Math.round(td.tracking));
        if (td.leading !== undefined && !td.autoLeading) bump(S.leading, Math.round(td.leading));
        if (td.applyFill && td.fillColor) bump(S.textColors, rgbHex(td.fillColor));
    }
    function rgbHex(c) {
        function h(x) { var s = Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16); return s.length < 2 ? "0" + s : s; }
        return "#" + h(c[0]) + h(c[1]) + h(c[2]);
    }

    // ---------------- values ----------------
    function dumpValue(prop, v) {
        var t = prop.propertyValueType;
        if (t === PropertyValueType.TEXT_DOCUMENT) return dumpTextDoc(v);
        if (t === PropertyValueType.SHAPE) {
            var n = v.vertices ? v.vertices.length : 0;
            var o = { closed: v.closed, vertexCount: n };
            if (n <= MAX_SHAPE_VERTS) { o.vertices = rv(v.vertices); o.inTangents = rv(v.inTangents); o.outTangents = rv(v.outTangents); }
            return o;
        }
        if (t === PropertyValueType.MARKER) {
            return { comment: v.comment, duration: r(v.duration), chapter: v.chapter || undefined };
        }
        if (t === PropertyValueType.LAYER_INDEX || t === PropertyValueType.MASK_INDEX) return v;
        return rv(v);
    }

    function dumpEase(arr) {
        var o = [];
        for (var i = 0; i < arr.length; i++) o.push({ speed: r(arr[i].speed), influence: r(arr[i].influence) });
        return o;
    }

    // ---------------- a single property ----------------
    function dumpProperty(prop, fps, path, ctx) {
        var vt = prop.propertyValueType;
        if (vt === PropertyValueType.NO_VALUE || vt === PropertyValueType.CUSTOM_VALUE) return null;

        var numKeys = safe(function () { return prop.numKeys; }, 0);
        var hasExpr = safe(function () { return prop.canSetExpression && prop.expressionEnabled && prop.expression !== ""; }, false);
        var modified = safe(function () { return prop.isModified; }, true);
        var isSourceText = prop.matchName === "ADBE Text Document";
        if (numKeys === 0 && !hasExpr && !modified && !isSourceText) return null;

        var o = { name: prop.name, matchName: prop.matchName };
        if (numKeys === 0) {
            var val = safe(function () { return prop.value; }, undefined);
            if (val !== undefined) o.value = dumpValue(prop, val);
            if (isSourceText && val) statTextDoc(val);
        }
        if (hasExpr) {
            var ex = prop.expression;
            o.expression = ex.length > MAX_EXPR_CHARS ? ex.substring(0, MAX_EXPR_CHARS) + "..." : ex;
            if (S.expressions.length < 200) S.expressions.push({ comp: ctx.comp, layer: ctx.layer, prop: path, expression: ex.substring(0, 600) });
        }
        if (numKeys > 0) {
            bump(S.animatedProps, prop.name);
            var isSpatial = safe(function () { return prop.isSpatial; }, false);
            var keys = [], n = Math.min(numKeys, MAX_KEYS_PER_PROP);
            for (var k = 1; k <= n; k++) {
                var key = { t: r(prop.keyTime(k)), frame: f(prop.keyTime(k) - ctx.layerStart, fps) };
                key.value = safe(function () { return dumpValue(prop, prop.keyValue(k)); }, null);
                if (vt === PropertyValueType.TEXT_DOCUMENT && key.value) statTextDoc(prop.keyValue(k));
                key.inInterp = INTERP[prop.keyInInterpolationType(k)];
                key.outInterp = INTERP[prop.keyOutInterpolationType(k)];
                bump(S.interpolation, key.inInterp + "->" + key.outInterp);
                var inE = safe(function () { return prop.keyInTemporalEase(k); }, null);
                var outE = safe(function () { return prop.keyOutTemporalEase(k); }, null);
                if (inE) key.easeIn = dumpEase(inE);
                if (outE) key.easeOut = dumpEase(outE);
                key.temporalContinuous = safe(function () { return prop.keyTemporalContinuous(k); }, undefined);
                key.temporalAutoBezier = safe(function () { return prop.keyTemporalAutoBezier(k); }, undefined);
                if (isSpatial) {
                    key.spatialIn = safe(function () { return rv(prop.keyInSpatialTangent(k)); }, undefined);
                    key.spatialOut = safe(function () { return rv(prop.keyOutSpatialTangent(k)); }, undefined);
                    key.spatialAutoBezier = safe(function () { return prop.keySpatialAutoBezier(k); }, undefined);
                    key.roving = safe(function () { return prop.keyRoving(k); }, undefined);
                }
                var lbl = safe(function () { return prop.keyLabel(k); }, 0);
                if (lbl) key.label = lbl;
                keys.push(key);
            }
            if (numKeys > n) o.truncatedKeys = numKeys - n;
            o.keyframes = keys;

            // segments = the actual "moves": duration + ease shape between consecutive keys
            var segs = [];
            for (var s = 0; s < keys.length - 1; s++) {
                var a = keys[s], b = keys[s + 1];
                var seg = { from: a.frame, to: b.frame, frames: Math.round((b.frame - a.frame) * 100) / 100, interp: a.outInterp + "->" + b.inInterp };
                if (a.easeOut && b.easeIn) {
                    seg.outInfluence = Math.round(a.easeOut[0].influence);
                    seg.inInfluence = Math.round(b.easeIn[0].influence);
                    seg.outSpeed = a.easeOut[0].speed; seg.inSpeed = b.easeIn[0].speed;
                    if (a.outInterp !== "hold") {
                        bump(S.easeOutInfluence, bucket(seg.outInfluence, 5));
                        bump(S.easeInInfluence, bucket(seg.inInfluence, 5));
                        bump(S.easePairs, bucket(seg.outInfluence, 5) + "/" + bucket(seg.inInfluence, 5));
                    }
                }
                bump(S.segmentFrames, Math.round(seg.frames));
                segs.push(seg);
            }
            if (segs.length) o.segments = segs;
            bump(S.firstKeyOffsetFrames, Math.round(keys[0].frame));
        }
        return o;
    }

    // ---------------- recursive property walk ----------------
    function walk(group, fps, path, ctx, depth) {
        var out = [];
        var n = safe(function () { return group.numProperties; }, 0);
        for (var i = 1; i <= n; i++) {
            var p = safe(function () { return group.property(i); }, null);
            if (!p) continue;
            var mn = p.matchName;
            if (SKIP_GROUPS[mn]) continue;
            if (SKIP_IF_2D[mn] && !ctx.is3D) continue;
            var pPath = path ? path + " > " + p.name : p.name;

            if (p.propertyType === PropertyType.PROPERTY) {
                var d = dumpProperty(p, fps, pPath, ctx);
                if (d) out.push(d);
            } else {
                var isEffect = group.matchName === "ADBE Effect Parade";
                var isMaskOrShapeItem = group.matchName === "ADBE Mask Parade" || mn.indexOf("ADBE Vector") === 0;
                var isAnimator = group.matchName === "ADBE Text Animators";
                if (isEffect) bump(S.effects, p.name === mn ? mn : (p.matchName + " (" + p.name + ")"));
                var kids = walk(p, fps, pPath, ctx, depth + 1);
                if (kids.length || isEffect || isMaskOrShapeItem || isAnimator) {
                    var g = { name: p.name, matchName: mn };
                    var en = safe(function () { return p.canSetEnabled ? p.enabled : undefined; }, undefined);
                    if (en === false) g.enabled = false;
                    if (group.matchName === "ADBE Mask Parade") {
                        g.maskMode = safe(function () { return enumName(MaskMode, p.maskMode); }, undefined);
                        g.inverted = safe(function () { return p.inverted; }, undefined);
                    }
                    if (isAnimator) safe(function () { statAnimator(p, fps, ctx); }, null);
                    g.props = kids;
                    out.push(g);
                }
            }
        }
        return out;
    }

    function fmtVal(v) {
        if (typeof v === "number") return String(rnd(v, 1));
        if (isArr(v)) { var a = []; for (var i = 0; i < v.length; i++) a.push(rnd(v[i], 1)); return "[" + a.join(",") + "]"; }
        return String(v);
    }
    // only the animator properties you actually set, plus how the selector is animated
    function statAnimator(anim, fps, ctx) {
        var used = [], i, j;
        var props = safe(function () { return anim.property("ADBE Text Animator Properties"); }, null);
        if (props) for (i = 1; i <= props.numProperties; i++) {
            var p = props.property(i);
            if (!p || p.propertyType !== PropertyType.PROPERTY || !p.name) continue;
            if (!safe(function () { return p.isModified || p.numKeys > 0; }, false)) continue;
            bump(S.textAnimatorProps, p.name);
            used.push(p.name + " " + fmtVal(safe(function () { return p.value; }, "")));
        }
        var sels = safe(function () { return anim.property("ADBE Text Selectors"); }, null), selDesc = [];
        var shapeNames = { 1: "Square", 2: "Ramp Up", 3: "Ramp Down", 4: "Triangle", 5: "Round", 6: "Smooth" };
        var basedNames = { 1: "Characters", 2: "Characters Excluding Spaces", 3: "Words", 4: "Lines" };
        if (sels) for (j = 1; j <= sels.numProperties; j++) {
            var sel = sels.property(j);
            var adv = safe(function () { return sel.property("ADBE Text Range Advanced"); }, null);
            var shape = adv ? safe(function () { return adv.property("ADBE Text Range Shape").value; }, null) : null;
            var basedOn = adv ? safe(function () { return adv.property("ADBE Text Range Type2").value; }, null) : null;
            var d = (basedNames[basedOn] || "?") + "/" + (shapeNames[shape] || "?");
            bump(S.textSelectorShapes, (shapeNames[shape] || shape || sel.name) + (basedOn ? " / " + (basedNames[basedOn] || basedOn) : ""));
            for (var k = 1; k <= sel.numProperties; k++) {
                var sp = sel.property(k);
                var nk = safe(function () { return sp.propertyType === PropertyType.PROPERTY ? sp.numKeys : 0; }, 0);
                if (nk < 2) continue;
                var oe = safe(function () { return Math.round(sp.keyOutTemporalEase(1)[0].influence); }, "?");
                var ie = safe(function () { return Math.round(sp.keyInTemporalEase(nk)[0].influence); }, "?");
                d += ", " + sp.name + " " + fmtVal(sp.keyValue(1)) + "->" + fmtVal(sp.keyValue(nk)) +
                     " in " + Math.round((sp.keyTime(nk) - sp.keyTime(1)) * fps) + "f (ease " + oe + "/" + ie + ")";
            }
            selDesc.push(d);
        }
        var recipe = (used.length ? used.join(" + ") : "(no properties)") + "  |  " + selDesc.join("; ");
        bump(S.textRecipes, recipe);
        if (S.textRecipeExamples.length < 15) S.textRecipeExamples.push({ comp: ctx.comp, layer: ctx.layer, recipe: recipe });
    }

    // ---------------- layers ----------------
    function layerType(L) {
        if (L instanceof TextLayer) return "text";
        if (L instanceof ShapeLayer) return "shape";
        if (L instanceof CameraLayer) return "camera";
        if (L instanceof LightLayer) return "light";
        if (L.nullLayer) return "null";
        if (L.adjustmentLayer) return "adjustment";
        if (L.source instanceof CompItem) return "precomp";
        if (L.source && L.source.mainSource instanceof SolidSource) return "solid";
        if (L.source && L.source.mainSource instanceof FileSource) {
            return L.source.hasVideo && L.source.duration > 0 ? "footage" : (L.source.hasVideo ? "image" : "audio");
        }
        return "av";
    }

    function dumpLayer(L, comp) {
        var fps = comp.frameRate, type = layerType(L);
        bump(S.layerTypes, type);
        var o = {
            index: L.index, name: L.name, type: type,
            inFrame: f(L.inPoint, fps), outFrame: f(L.outPoint, fps), startFrame: f(L.startTime, fps),
            durationFrames: f(L.outPoint - L.inPoint, fps)
        };
        bump(S.layerDurationsFrames, bucket(o.durationFrames, 5));
        if (L.parent) o.parent = L.parent.index + ": " + L.parent.name;
        if (!L.enabled) o.visible = false;
        if (L.shy) o.shy = true;
        if (L.label) o.label = L.label;
        var ao = safe(function () { return L.autoOrient; }, null);
        if (ao !== null && ao !== AutoOrientType.NO_AUTO_ORIENT) o.autoOrient = enumName(AutoOrientType, ao);
        if (L instanceof CameraLayer) {
            o.camera = { twoNode: ao === AutoOrientType.CAMERA_OR_POINT_OF_INTEREST, rig: parentChain(L) };
        }
        if (L instanceof AVLayer) {
            o.blendMode = enumName(BlendingMode, L.blendingMode);
            bump(S.blendModes, o.blendMode);
            if (L.stretch !== 100) o.stretch = L.stretch;
            if (L.threeDLayer) { o.threeD = true; S.threeDLayers++; }
            if (L.motionBlur) { o.motionBlur = true; S.motionBlurLayers++; }
            if (L.collapseTransformation) o.collapse = true;
            if (L.timeRemapEnabled) o.timeRemap = true;
            if (L.hasTrackMatte) {
                o.trackMatte = enumName(TrackMatteType, L.trackMatteType);
                o.matteLayer = safe(function () { return L.trackMatteLayer ? L.trackMatteLayer.index + ": " + L.trackMatteLayer.name : undefined; }, undefined);
                bump(S.trackMattes, o.trackMatte);
            }
            if (L.isTrackMatte) o.isTrackMatte = true;
            if (L.source) {
                o.source = L.source.name;
                if (L.source instanceof CompItem) o.precompId = L.source.id;
                if (L.source.mainSource instanceof SolidSource) o.solidColor = rgbHex(L.source.mainSource.color);
            }
            if (L.effectsActive === false) o.effectsOff = true;
        }
        var ctx = { comp: comp.name, layer: L.name, is3D: safe(function () { return L.threeDLayer; }, false), layerStart: 0 };
        o.properties = walk(L, fps, "", ctx, 0);
        return o;
    }

    // =====================================================================
    //  3D CAMERA ANALYSIS
    //  A hidden probe null is added to the comp, given expressions that read
    //  each camera's WORLD position / facing / zoom (so null rigs and parenting
    //  are included), sampled every frame, then removed again.
    // =====================================================================
    var MAX_SAMPLES = 3000;       // per camera; longer shots sample every 2+ frames
    var PATH_POINTS = 600;        // world-space path points kept in .full.json
    var MAX_LAYOUT = 300;         // 3D layers whose world position is recorded
    var SPEED_EPS = 0.05;         // px/frame  -> "camera is moving"
    var ANG_EPS = 0.02;           // deg/frame -> "camera is turning"
    var ZOOM_EPS = 0.02;          // %/frame   -> "camera is zooming"
    var NEAR_CUT_FRAMES = 12;     // window for "what else animates around a cut"
    var WHIP_PX = 60;             // on-screen px/frame above which a cut counts as a whip
    var PRE_FOLDERS = {};

    function vsub(a, b) { return [a[0] - b[0], a[1] - b[1], (a[2] || 0) - (b[2] || 0)]; }
    function vadd(a, b) { return [a[0] + b[0], a[1] + b[1], (a[2] || 0) + (b[2] || 0)]; }
    function vdot(a, b) { return a[0] * b[0] + a[1] * b[1] + (a[2] || 0) * (b[2] || 0); }
    function vlen(a) { return Math.sqrt(vdot(a, a)); }
    function vnorm(a) { var l = vlen(a) || 1; return [a[0] / l, a[1] / l, (a[2] || 0) / l]; }
    function vang(a, b) {
        var la = vlen(a), lb = vlen(b);
        if (!la || !lb) return 0;
        var d = Math.max(-1, Math.min(1, vdot(a, b) / (la * lb)));
        return Math.acos(d) * 180 / Math.PI;
    }
    function rnd(n, dp) { var m = Math.pow(10, dp); return Math.round(n * m) / m; }
    function rvec(v, dp) { return [rnd(v[0], dp), rnd(v[1], dp), rnd(v[2] || 0, dp)]; }
    function focalMm(zoom, w) { return rnd(zoom * 36 / w, 1); }                       // 36mm film, horizontal
    function fovDeg(zoom, w) { return rnd(2 * Math.atan(w / 2 / zoom) * 180 / Math.PI, 1); }

    function isTransformAnimated(L) {
        var tg = safe(function () { return L.property("ADBE Transform Group"); }, null);
        if (!tg) return false;
        for (var i = 1; i <= tg.numProperties; i++) {
            var p = tg.property(i);
            if (safe(function () { return p.numKeys > 0 || (p.expressionEnabled && p.expression !== ""); }, false)) return true;
        }
        return false;
    }
    function parentChain(L) {
        var arr = [], p = L.parent, guard = 0;
        while (p && guard++ < 20) {
            arr.push({ index: p.index, name: p.name, type: layerType(p), animated: isTransformAnimated(p) });
            p = p.parent;
        }
        return arr;
    }

    // ---- probe null ----
    function makeProbe(comp) {
        var nul = comp.layers.addNull(comp.duration);
        nul.name = "__style_exporter_probe__";
        nul.property("ADBE Effect Parade").addProperty("ADBE Slider Control");
        nul.threeDLayer = true;
        nul.moveToEnd();
        nul.enabled = false;
        var src = nul.source;
        var tg = nul.property("ADBE Transform Group");
        return {
            layer: nul, src: src, folder: src ? src.parentFolder : null,
            pos: tg.property("ADBE Position"), anc: tg.property("ADBE Anchor Point"),
            scl: tg.property("ADBE Scale"),
            zoom: nul.property("ADBE Effect Parade").property(1).property(1)
        };
    }
    function probeTarget(pr, idx, isCam) {
        var L = "thisComp.layer(" + idx + ")";
        pr.pos.expression = isCam ? L + ".toWorld([0,0,0])" : "var L=" + L + "; L.toWorld(L.anchorPoint)";
        pr.anc.expression = "mul(" + L + ".toWorldVec([0,0,1]),1000)";    // facing direction
        pr.scl.expression = "mul(" + L + ".toWorldVec([0,-1,0]),1000)";   // camera 'up'
        pr.zoom.expression = isCam ? L + ".zoom" : "0";
        pr.pos.valueAtTime(0, false);
        var err = safe(function () { return pr.pos.expressionError || pr.anc.expressionError || pr.zoom.expressionError; }, "");
        if (err) throw new Error("probe expression failed: " + err);
    }
    function probeSample(pr, t) {
        return {
            p: pr.pos.valueAtTime(t, false),
            f: vnorm(pr.anc.valueAtTime(t, false)),
            u: vnorm(pr.scl.valueAtTime(t, false)),
            z: pr.zoom.valueAtTime(t, false)
        };
    }
    function probeRemove(pr) {
        try { pr.layer.remove(); } catch (e1) {}
        try { if (pr.src) pr.src.remove(); } catch (e2) {}
        try {
            var fo = pr.folder;
            if (fo && fo !== app.project.rootFolder && fo.numItems === 0 && !PRE_FOLDERS[fo.id]) fo.remove();
        } catch (e3) {}
    }

    // ---- turn a run of samples into a described "camera move" ----
    function describeMove(smp, a, b, spd, ang, zr, step, comp, ctx) {
        var cumP = [0], cumA = [0], cumZ = [0], tp = 0, ta = 0, tz = 0, k;
        for (k = a + 1; k <= b; k++) {
            tp += spd[k] * step; ta += ang[k] * step; tz += zr[k] * step;
            cumP.push(tp); cumA.push(ta); cumZ.push(tz);
        }
        var driver = tp >= 2 ? "position" : (ta >= 0.5 ? "rotation" : "zoom");
        var cum = driver === "position" ? cumP : (driver === "rotation" ? cumA : cumZ);
        var dv = driver === "position" ? spd : (driver === "rotation" ? ang : zr);
        var total = cum[cum.length - 1] || 1;
        var F0 = smp[a].frame, F1 = smp[b].frame, T = (F1 - F0) || 1;

        // ease fingerprint: % of the move completed at 10%,20%..90% of its duration
        var fp = [];
        for (var q = 1; q <= 9; q++) {
            var tq = F0 + T * q / 10, val = total;
            for (k = 0; k < cum.length - 1; k++) {
                var fa = smp[a + k].frame, fb = smp[a + k + 1].frame;
                if (tq >= fa && tq <= fb) { val = cum[k] + (cum[k + 1] - cum[k]) * ((tq - fa) / ((fb - fa) || 1)); break; }
            }
            fp.push(rnd(val / total, 2));
        }
        var peak = 0, peakK = a + 1;
        for (k = a + 1; k <= b; k++) if (dv[k] > peak) { peak = dv[k]; peakK = k; }
        var peakAt = rnd(((smp[peakK].frame - step / 2) - F0) / T, 2);

        var label;
        if (fp[0] <= 0.04 && fp[8] >= 0.96) label = "slow start + slow landing";
        else if (fp[0] <= 0.04) label = "slow start, hard stop";
        else if (fp[8] >= 0.96) label = "fast start, soft landing";
        else label = "near constant speed";
        var meanSpeed = total / T;
        if (peak > meanSpeed * 1.15) {
            if (peakAt <= 0.35) label += " (front-loaded)";
            else if (peakAt >= 0.65) label += " (back-loaded)";
        }

        var pa = smp[a], pb = smp[b];
        var disp = vsub(pb.p, pa.p), straight = vlen(disp);
        var dolly = vdot(disp, pa.f), ped = vdot(disp, pa.u);
        var truck = Math.sqrt(Math.max(0, straight * straight - dolly * dolly - ped * ped));
        var rot = vang(pa.f, pb.f), zoomChange = pa.z ? (pb.z - pa.z) / pa.z * 100 : 0;
        var types = [];
        if (straight > 1) {
            if (Math.abs(dolly) > straight * 0.3) types.push(dolly > 0 ? "push in" : "pull out");
            if (truck > straight * 0.3) types.push("truck");
            if (Math.abs(ped) > straight * 0.3) types.push(ped > 0 ? "crane up" : "crane down");
        }
        if (rot > 3) types.push(straight > 50 ? "orbit/arc" : "pan/tilt");
        if (Math.abs(zoomChange) > 3) types.push(zoomChange > 0 ? "zoom in" : "zoom out");
        var typeLabel = types.length ? types.join(" + ") : "micro move";

        var mv = {
            fromFrame: F0, toFrame: F1, frames: rnd(T, 1), driver: driver, type: typeLabel,
            distancePx: rnd(tp, 0), straightPx: rnd(straight, 0),
            cameraRelativePx: { dolly: rnd(dolly, 0), truck: rnd(truck, 0), pedestal: rnd(ped, 0) },
            rotationDeg: rnd(rot, 1), totalTurnDeg: rnd(ta, 1),
            zoomChangePct: rnd(zoomChange, 1), focalMm: [focalMm(pa.z, comp.width), focalMm(pb.z, comp.width)],
            peakSpeed: rnd(peak, 2), peakSpeedUnit: driver === "position" ? "px/frame" : (driver === "rotation" ? "deg/frame" : "%zoom/frame"),
            peakAtPct: peakAt, ease: label, easeFingerprint: fp
        };
        bump(S.cam.moveFrames, bucket(T, 5));
        bump(S.cam.moveTypes, typeLabel);
        bump(S.cam.easeLabels, label);
        bump(S.cam.peakAtPct, bucket(peakAt * 100, 10));
        if (S.cam.examples.length < 40)
            S.cam.examples.push({ comp: ctx.comp, camera: ctx.camera, frames: mv.frames, type: typeLabel, distancePx: mv.distancePx, rotationDeg: mv.rotationDeg, ease: label, easeFingerprint: fp });
        return mv;
    }

    // per-sample motion: speed (px/frame), turn (deg/frame), zoom change (%/frame)
    function computeMotion(smp, step) {
        var spd = [0], ang = [0], zr = [0];
        for (var k = 1; k < smp.length; k++) {
            spd.push(vlen(vsub(smp[k].p, smp[k - 1].p)) / step);
            ang.push(vang(smp[k].f, smp[k - 1].f) / step);
            zr.push(Math.abs(smp[k].z - smp[k - 1].z) / step / Math.max(Math.abs(smp[k - 1].z), 1) * 100);
        }
        return { spd: spd, ang: ang, zr: zr };
    }

    // fallback when no keyframes drive the camera: threshold relative to ambient drift
    function findMoves(smp, M, step, comp, ctx) {
        var n = smp.length, moves = [], k;
        if (n < 2) return moves;
        var sorted = M.spd.slice(1).sort(function (a, b) { return a - b; });
        var eps = Math.max(SPEED_EPS, (sorted[Math.floor(sorted.length / 2)] || 0) * 3);
        var mv = [false];
        for (k = 1; k < n; k++) mv.push(M.spd[k] > eps || M.ang[k] > ANG_EPS || M.zr[k] > ZOOM_EPS);
        k = 1;
        while (k < n) {
            if (!mv[k]) { k++; continue; }
            var s = k, e = k, j = k + 1;
            while (j < n && (mv[j] || (j + 1 < n && mv[j + 1]))) { if (mv[j]) e = j; j++; }
            moves.push(describeMove(smp, s - 1, e, M.spd, M.ang, M.zr, step, comp, ctx));
            k = e + 1;
        }
        return moves;
    }

    function valuesDiffer(a, b) {
        if (typeof a === "number") return Math.abs(a - b) > 0.001;
        if (isArr(a)) { for (var i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 0.001) return true; return false; }
        return false;
    }

    // keyframed moves on the camera and every null in its rig (holds split moves; drift expressions don't)
    function collectMoveIntervals(L, comp) {
        var fps = comp.frameRate, segs = [], chain = [L], p = L.parent, g = 0, exprs = [], c, i, k;
        while (p && g++ < 20) { chain.push(p); p = p.parent; }
        for (c = 0; c < chain.length; c++) {
            var lay = chain[c], groups = [safe(function () { return lay.property("ADBE Transform Group"); }, null)];
            if (lay instanceof CameraLayer) groups.push(safe(function () { return lay.property("ADBE Camera Options Group"); }, null));
            for (var gi = 0; gi < groups.length; gi++) {
                var grp = groups[gi];
                if (!grp) continue;
                for (i = 1; i <= grp.numProperties; i++) {
                    var pr = safe(function () { return grp.property(i); }, null);
                    if (!pr || pr.propertyType !== PropertyType.PROPERTY) continue;
                    if (safe(function () { return pr.expressionEnabled && pr.expression !== ""; }, false)) pushU(exprs, lay.name + " > " + pr.name);
                    var n = safe(function () { return pr.numKeys; }, 0);
                    for (k = 1; k < n; k++) {
                        if (pr.keyOutInterpolationType(k) === KeyframeInterpolationType.HOLD) continue;
                        var va = pr.keyValue(k), vb = pr.keyValue(k + 1);
                        if (!valuesDiffer(va, vb)) continue;
                        var oe = safe(function () { return pr.keyOutTemporalEase(k)[0].influence; }, null);
                        var ie = safe(function () { return pr.keyInTemporalEase(k + 1)[0].influence; }, null);
                        segs.push({
                            t0: pr.keyTime(k), t1: pr.keyTime(k + 1), layer: lay.name, prop: pr.name,
                            fromFrame: f(pr.keyTime(k), fps), toFrame: f(pr.keyTime(k + 1), fps),
                            frames: rnd((pr.keyTime(k + 1) - pr.keyTime(k)) * fps, 1),
                            outInfluence: oe === null ? null : Math.round(oe), inInfluence: ie === null ? null : Math.round(ie),
                            interp: INTERP[pr.keyOutInterpolationType(k)] + "->" + INTERP[pr.keyInInterpolationType(k + 1)],
                            from: rv(va), to: rv(vb)
                        });
                    }
                }
            }
        }
        segs.sort(function (x, y) { return x.t0 - y.t0; });
        var ivs = [], cur = null, tol = 0.5 / fps;
        for (i = 0; i < segs.length; i++) {
            var sg = segs[i];
            if (cur && sg.t0 <= cur.t1 + tol) { if (sg.t1 > cur.t1) cur.t1 = sg.t1; cur.segs.push(sg); }
            else { cur = { t0: sg.t0, t1: sg.t1, segs: [sg] }; ivs.push(cur); }
        }
        return { intervals: ivs, expressions: exprs };
    }

    function movesFromIntervals(smp, M, ivs, step, comp, ctx) {
        var fps = comp.frameRate, moves = [], lastEnd = null;
        var first = smp[0].frame, last = smp[smp.length - 1].frame;
        for (var i = 0; i < ivs.length; i++) {
            var f0 = Math.max(ivs[i].t0 * fps, first), f1 = Math.min(ivs[i].t1 * fps, last);
            if (f1 - f0 < 2) continue;
            var a = 0, b = smp.length - 1, k;
            for (k = 0; k < smp.length; k++) if (smp[k].frame <= f0 + 0.01) a = k;
            for (k = smp.length - 1; k >= 0; k--) if (smp[k].frame >= f1 - 0.01) b = k;
            if (b <= a) continue;
            var mv = describeMove(smp, a, b, M.spd, M.ang, M.zr, step, comp, ctx);
            mv.fromFrame = rnd(f0, 1); mv.toFrame = rnd(f1, 1); mv.frames = rnd(f1 - f0, 1);
            if (lastEnd !== null) { mv.holdBeforeFrames = rnd(f0 - lastEnd, 1); bump(S.cam.holdFrames, bucket(f0 - lastEnd, 2)); }
            lastEnd = f1;
            var sgs = ivs[i].segs, keep = [], easeCount = {};
            for (k = 0; k < sgs.length; k++) {
                var sg = sgs[k], copy = {};
                for (var key in sg) if (sg.hasOwnProperty(key) && key !== "t0" && key !== "t1") copy[key] = sg[key];
                if (keep.length < 10) keep.push(copy);
                if (sg.outInfluence !== null) {
                    var ek = bucket(sg.outInfluence, 5) + "/" + bucket(sg.inInfluence, 5);
                    bump(easeCount, ek); bump(S.cam.rigEase, ek);
                }
                bump(S.cam.rigSegFrames, bucket(sg.frames, 2));
            }
            mv.keyframes = keep;
            var best = null, bc = 0;
            for (var ek2 in easeCount) if (easeCount[ek2] > bc) { bc = easeCount[ek2]; best = ek2; }
            if (best) mv.keyframeEase = best + " (out/in influence %)";
            moves.push(mv);
        }
        return moves;
    }

    // ambient motion outside the keyframed moves (e.g. a sine / wiggle drift on a control null)
    function estimateDrift(smp, ivs, fps, M) {
        var inMove = [], k, i, best = 0, sp = 0, cnt = 0;
        for (k = 0; k < smp.length; k++) {
            var fr = smp[k].frame, m = false;
            for (i = 0; i < ivs.length; i++) if (fr >= ivs[i].t0 * fps - 2 && fr <= ivs[i].t1 * fps + 2) { m = true; break; }
            inMove.push(m);
        }
        k = 0;
        while (k < smp.length) {
            if (inMove[k]) { k++; continue; }
            var s = k;
            while (k < smp.length && !inMove[k]) k++;
            if (k - s < 4) continue;
            var c = [0, 0, 0];
            for (i = s; i < k; i++) c = vadd(c, smp[i].p);
            c = [c[0] / (k - s), c[1] / (k - s), c[2] / (k - s)];
            for (i = s; i < k; i++) { best = Math.max(best, vlen(vsub(smp[i].p, c))); if (i > s) { sp += M.spd[i]; cnt++; } }
        }
        return cnt ? { amplitudePx: rnd(best, 1), meanSpeedPxPerFrame: rnd(sp / cnt, 2) } : null;
    }

    function analyzeOneCamera(comp, idx, pr) {
        var L = comp.layer(idx), fps = comp.frameRate;
        var o = { index: idx, name: L.name };
        S.cam.count++;
        o.twoNode = safe(function () { return L.autoOrient === AutoOrientType.CAMERA_OR_POINT_OF_INTEREST; }, undefined);
        if (o.twoNode) S.cam.twoNode++;
        o.rig = parentChain(L);
        if (o.rig.length) S.cam.rigged++;
        o.depthOfField = safe(function () { return L.property("ADBE Camera Options Group").property("ADBE Camera Depth of Field").value == 1; }, undefined);
        if (o.depthOfField) S.cam.dof++;

        progress("  " + comp.name + "  >  sampling camera '" + L.name + "'");
        probeTarget(pr, idx, true);
        var t0 = Math.max(L.inPoint, 0), t1 = Math.min(L.outPoint, comp.duration);
        var total = Math.round((t1 - t0) * fps);
        if (total < 1) return o;
        var step = Math.max(CAM_STEP, Math.ceil(total / MAX_SAMPLES));
        var smp = [];
        for (var fr = 0; fr <= total; fr += step) {
            var t = t0 + fr / fps, s = probeSample(pr, t);
            s.frame = Math.round(t * fps * 100) / 100;
            smp.push(s);
        }
        if (smp[smp.length - 1].frame < t1 * fps - 0.5) {            // always include the last frame
            var sl = probeSample(pr, t1 - 1 / fps); sl.frame = Math.round((t1 * fps - 1) * 100) / 100; smp.push(sl);
        }
        o.sampleStepFrames = step;
        o.focalMm = { start: focalMm(smp[0].z, comp.width), end: focalMm(smp[smp.length - 1].z, comp.width) };
        o.fovDeg = { start: fovDeg(smp[0].z, comp.width), end: fovDeg(smp[smp.length - 1].z, comp.width) };
        bump(S.cam.focalMm, bucket(o.focalMm.start, 5));

        var M = computeMotion(smp, step), ctx = { comp: comp.name, camera: L.name };
        var KI = collectMoveIntervals(L, comp);
        if (KI.intervals.length) {
            o.moveSource = "keyframes on camera + rig nulls";
            o.moves = movesFromIntervals(smp, M, KI.intervals, step, comp, ctx);
        } else {
            o.moveSource = "measured speed (no keyframes found)";
            o.moves = findMoves(smp, M, step, comp, ctx);
        }
        if (KI.expressions.length) {
            o.driftExpressions = KI.expressions;
            var dr = estimateDrift(smp, KI.intervals, fps, M);
            if (dr) { o.drift = dr; bump(S.cam.drift, bucket(dr.amplitudePx, 2) + "px"); }
        }

        // world-space path: [frame, x, y, z, facingX, facingY, facingZ, zoom]
        var every = Math.max(1, Math.ceil(smp.length / PATH_POINTS)), path = [];
        for (var k = 0; k < smp.length; k += every) path.push(pathPt(smp[k]));
        if ((smp.length - 1) % every !== 0) path.push(pathPt(smp[smp.length - 1]));
        o.path = path;
        return o;
    }
    function pathPt(s) { return [s.frame, rnd(s.p[0], 1), rnd(s.p[1], 1), rnd(s.p[2] || 0, 1), rnd(s.f[0], 3), rnd(s.f[1], 3), rnd(s.f[2], 3), rnd(s.z, 1)]; }

    // which camera is actually rendering on each frame (top-most active camera wins)
    function activeShots(comp, cams, content3D) {
        var fps = comp.frameRate, durF = Math.round(comp.duration * fps), shots = [], cur = null, i;
        for (var fr = 0; fr < durF; fr++) {
            var t = (fr + 0.01) / fps, act = -1;
            for (var c = 0; c < cams.length; c++) {
                var L = comp.layer(cams[c]);
                if (L.enabled && L.inPoint <= t && t < L.outPoint) { act = cams[c]; break; }
            }
            if (!cur || cur.index !== act) {
                if (cur) { cur.toFrame = fr; shots.push(cur); }
                cur = { index: act, camera: act > 0 ? comp.layer(act).name : "(default comp camera)", fromFrame: fr };
            }
        }
        if (cur) { cur.toFrame = durF; shots.push(cur); }
        // default-camera stretches with no visible 3D layer are just 2D sections, not camera shots
        for (i = 0; i < shots.length; i++) {
            var sh = shots[i];
            if (sh.index > 0) continue;
            var has3D = false;
            for (var j = 0; j < content3D.length; j++) {
                var LL = comp.layer(content3D[j]);
                if (LL.inPoint * fps < sh.toFrame && LL.outPoint * fps > sh.fromFrame) { has3D = true; break; }
            }
            if (!has3D) { sh.camera = "(2D section - no camera)"; sh.twoD = true; }
        }
        return shots;
    }

    // ---- transition classification: what actually hides / carries the cut ----
    function screenSpeed(v, s) {
        var d = Math.max(50, Math.abs(s.p[2] || 0));
        return Math.sqrt(v[0] * v[0] + v[1] * v[1]) * (s.z || 1) / d + Math.abs(v[2] || 0) / d * 960;
    }
    function evidenceFrom(lists) {
        var ev = { blur: [], fade: [] };
        for (var i = 0; i < lists.length; i++) {
            var L = lists[i];
            if (!L) continue;
            for (var j = 0; j < L.length; j++) {
                var it = L[j], props = it.props || (it.prop ? [it.prop] : []);
                for (var k = 0; k < props.length; k++) {
                    var nm = it.layer ? it.layer + " > " + props[k] : props[k];
                    if (/blur/i.test(props[k])) pushU(ev.blur, nm);
                    else if (/opacity/i.test(props[k]) && !/Text >/.test(props[k])) pushU(ev.fade, nm);
                }
            }
        }
        return ev;
    }
    function classifyTransition(o) {
        // o: {invisible, whip, blur[], fade[], dirAng, ratio, sOut, sIn}
        if (o.invisible) return "invisible camera switch (cameras matched)";
        var parts = [];
        if (o.whip) parts.push("whip (fast camera move + motion blur)");
        if (o.blur && o.blur.length) parts.push("blur transition");
        if (o.fade && o.fade.length) parts.push("opacity fade");
        var motion;
        if (o.dirAng !== null && o.dirAng !== undefined && o.dirAng < 25) motion = (o.ratio > 0.6 && o.ratio < 1.6) ? "motion carried through" : "same direction, speed changes";
        else if (o.sOut < 0.5 && o.sIn < 0.5) motion = "camera still";
        else motion = "camera direction changes";
        if (!parts.length) return motion === "motion carried through" ? "motion-matched cut" : (motion === "same direction, speed changes" ? "direction-matched cut" : "straight cut (" + motion + ")");
        return parts.join(" + ") + ", " + motion;
    }

    // how the switch from one camera to the next is made
    function analyzeHandoff(comp, A, B, pr, layerDumps) {
        var fps = comp.frameRate, F = B.fromFrame, t = F / fps, dt = 1 / fps;
        var h = { atFrame: F, from: A.camera, to: B.camera };
        h.animationAroundCut = keyedNear(layerDumps, F, NEAR_CUT_FRAMES, {});
        var ev = evidenceFrom([h.animationAroundCut]);
        if (ev.blur.length) h.blurAroundCut = ev.blur;
        if (ev.fade.length) h.fadeAroundCut = ev.fade;
        if (A.index < 1 || B.index < 1) { h.type = "to/from default camera"; bump(S.cam.handoffTypes, h.type); return h; }
        probeTarget(pr, A.index, true);
        var a2 = probeSample(pr, t - 2 * dt), a1 = probeSample(pr, t - dt), a0 = probeSample(pr, t);
        probeTarget(pr, B.index, true);
        var b0 = probeSample(pr, t), b1 = probeSample(pr, t + dt);
        var vOut = vsub(a1.p, a2.p), vIn = vsub(b1.p, b0.p);
        var sOut = vlen(vOut), sIn = vlen(vIn);
        var gapSame = vlen(vsub(b0.p, a0.p)), gapExtrap = vlen(vsub(b0.p, vadd(a1.p, vOut)));
        var dirAng = (sOut > 0.1 && sIn > 0.1) ? vang(vOut, vIn) : null;
        var facingGap = vang(a1.f, b0.f), zoomRatio = a1.z ? b0.z / a1.z : 1;
        var scrOut = screenSpeed(vOut, a1), scrIn = screenSpeed(vIn, b0);
        h.positionGapPx = rnd(Math.min(gapSame, gapExtrap), 1);
        h.facingGapDeg = rnd(facingGap, 2);
        h.zoomRatio = rnd(zoomRatio, 3);
        h.speedOut = rnd(sOut, 2); h.speedIn = rnd(sIn, 2);
        h.screenSpeedOutPx = rnd(scrOut, 1); h.screenSpeedInPx = rnd(scrIn, 1);
        h.directionChangeDeg = dirAng === null ? null : rnd(dirAng, 1);
        var ratio = sOut > 0.1 ? sIn / sOut : null;
        h.type = classifyTransition({
            invisible: h.positionGapPx < 2 && facingGap < 0.5 && Math.abs(zoomRatio - 1) < 0.01,
            whip: scrOut > WHIP_PX || scrIn > WHIP_PX, blur: ev.blur, fade: ev.fade,
            dirAng: dirAng, ratio: ratio, sOut: sOut, sIn: sIn
        });
        bump(S.cam.handoffTypes, h.type);
        return h;
    }

    function analyzeCameras(comp, layerDumps) {
        var cams = [], layout = [], content3D = [], i;
        for (i = 1; i <= comp.numLayers; i++) {
            var L = comp.layer(i);
            if (L instanceof CameraLayer) cams.push(i);
            else if (L instanceof AVLayer && L.threeDLayer) {
                if (layout.length < MAX_LAYOUT) layout.push(i);
                if (!L.nullLayer && !L.adjustmentLayer && L.enabled) content3D.push(i);
            }
        }
        if (!cams.length && !layout.length) return null;
        var res = { renderer: safe(function () { return comp.renderer; }, undefined), cameras: [], shots: [], handoffs: [], layout3D: [] };
        var pr = makeProbe(comp);
        try {
            for (i = 0; i < cams.length; i++) {
                try { res.cameras.push(analyzeOneCamera(comp, cams[i], pr)); }
                catch (e) { res.cameras.push({ index: cams[i], name: comp.layer(cams[i]).name, error: e.toString() + (e.line ? " (line " + e.line + ")" : "") }); }
            }
            if (cams.length) {
                res.shots = activeShots(comp, cams, content3D);
                for (i = 1; i < res.shots.length; i++) {
                    if (res.shots[i - 1].twoD || res.shots[i].twoD) continue;
                    try { res.handoffs.push(analyzeHandoff(comp, res.shots[i - 1], res.shots[i], pr, layerDumps)); }
                    catch (e2) { res.handoffs.push({ atFrame: res.shots[i].fromFrame, error: e2.toString() }); }
                }
            }
            // where things sit in 3D space (how scenes are laid out for the camera to travel between)
            var fps = comp.frameRate;
            for (i = 0; i < layout.length; i++) {
                try {
                    var LL = comp.layer(layout[i]);
                    probeTarget(pr, layout[i], false);
                    var tm = Math.max(0, Math.min(comp.duration, (LL.inPoint + LL.outPoint) / 2));
                    var s = probeSample(pr, tm);
                    res.layout3D.push({ index: layout[i], name: LL.name, type: layerType(LL),
                        inFrame: f(LL.inPoint, fps), outFrame: f(LL.outPoint, fps),
                        worldPos: rvec(s.p, 0), facing: rvec(s.f, 2), parent: LL.parent ? LL.parent.name : undefined });
                } catch (e3) {}
            }
        } finally {
            probeRemove(pr);
        }
        return res;
    }

    // ---- what animates near a given frame (used for cuts and scene joins) ----
    function keyedNearLayer(d, frame, win) {
        var out = [];
        function rec(props, prefix) {
            if (!props) return;
            for (var i = 0; i < props.length; i++) {
                var p = props[i], path = prefix ? prefix + " > " + p.name : p.name;
                if (p.keyframes) {
                    var ks = [];
                    for (var k = 0; k < p.keyframes.length; k++) {
                        var kf = p.keyframes[k];
                        if (kf.frame >= frame - win && kf.frame <= frame + win) {
                            var v = kf.value;
                            ks.push({ frame: kf.frame, value: (typeof v === "number" || (isArr(v) && v.length <= 4)) ? v : "(complex)" });
                        }
                    }
                    if (ks.length) out.push({ prop: path, keys: ks });
                }
                if (p.props) rec(p.props, path);
            }
        }
        rec(d.properties, "");
        return out;
    }
    function keyedNear(layerDumps, frame, win, exclude) {
        var out = [];
        for (var i = 0; i < layerDumps.length && out.length < 15; i++) {
            var d = layerDumps[i];
            if (!d || exclude[d.index] || !d.properties) continue;
            var r2 = keyedNearLayer(d, frame, win);
            if (r2.length) {
                var names = [];
                for (var j = 0; j < r2.length; j++) names.push(r2[j].prop);
                out.push({ layer: d.index + ": " + d.name, type: d.type, blendMode: d.blendMode, props: names });
            }
        }
        return out;
    }

    // scene-to-scene joins: consecutive precomp layers that touch or overlap
    function findSceneJoins(comp, layerDumps) {
        var pcs = [], joins = [], i;
        for (i = 0; i < layerDumps.length; i++) {
            var d = layerDumps[i];
            if (d && d.type === "precomp" && d.visible !== false) pcs.push(d);
        }
        pcs.sort(function (x, y) { return x.inFrame - y.inFrame; });
        for (i = 1; i < pcs.length; i++) {
            var A = pcs[i - 1], B = pcs[i], gap = B.inFrame - A.outFrame;
            if (gap > 2 || B.inFrame <= A.inFrame) continue;
            var ex = {}; ex[A.index] = true; ex[B.index] = true;
            var j = {
                from: A.name, to: B.name, fromCompId: A.precompId, toCompId: B.precompId,
                atFrame: B.inFrame, overlapFrames: rnd(-gap, 2),
                fromInnerEndFrame: rnd(A.outFrame - A.startFrame, 2), toInnerStartFrame: rnd(B.inFrame - B.startFrame, 2),
                fromLayerFlags: { threeD: !!A.threeD, collapse: !!A.collapse, blendMode: A.blendMode, trackMatte: A.trackMatte, stretch: A.stretch, timeRemap: A.timeRemap },
                toLayerFlags: { threeD: !!B.threeD, collapse: !!B.collapse, blendMode: B.blendMode, trackMatte: B.trackMatte, stretch: B.stretch, timeRemap: B.timeRemap },
                fromAnimNearEnd: keyedNearLayer(A, A.outFrame, 20),
                toAnimNearStart: keyedNearLayer(B, B.inFrame, 20),
                otherLayersAnimatingAtJoin: keyedNear(layerDumps, B.inFrame, NEAR_CUT_FRAMES, ex)
            };
            bump(S.cam.joinOverlap, bucket(-gap, 2));
            joins.push(j);
        }
        return joins;
    }

    // after every comp is dumped: link each scene join to the cameras inside both precomps
    function camMotionAt(ca, frame) {
        if (!ca || !ca.cameras || !ca.cameras.length) return null;
        var idx = -1, i;
        for (i = 0; i < ca.shots.length; i++) if (frame >= ca.shots[i].fromFrame && frame < ca.shots[i].toFrame) { idx = ca.shots[i].index; break; }
        if (idx < 1) return null;
        var cam = null;
        for (i = 0; i < ca.cameras.length; i++) if (ca.cameras[i].index === idx) cam = ca.cameras[i];
        if (!cam || !cam.path || cam.path.length < 2) return null;
        var P = cam.path, k = 0;
        while (k < P.length - 2 && P[k + 1][0] < frame) k++;
        var df = (P[k + 1][0] - P[k][0]) || 1;
        var v = [(P[k + 1][1] - P[k][1]) / df, (P[k + 1][2] - P[k][2]) / df, (P[k + 1][3] - P[k][3]) / df];
        var scr = screenSpeed(v, { p: [P[k][1], P[k][2], P[k][3]], z: P[k][7] });
        return { camera: cam.name, atInnerFrame: frame, speedPxPerFrame: rnd(vlen(v), 2), screenSpeedPx: rnd(scr, 1),
                 direction: rvec(vnorm(v), 3), facing: [P[k][4], P[k][5], P[k][6]], zoom: P[k][7] };
    }
    function linkJoinsToCameras(comps) {
        var byId = {}, i, j;
        for (i = 0; i < comps.length; i++) byId[comps[i].id] = comps[i];
        for (i = 0; i < comps.length; i++) {
            var js = comps[i].sceneJoins;
            if (!js) continue;
            for (j = 0; j < js.length; j++) {
                var J = js[j], A = byId[J.fromCompId], B = byId[J.toCompId];
                var mA = A ? camMotionAt(A.cameraAnalysis, J.fromInnerEndFrame - 1) : null;
                var mB = B ? camMotionAt(B.cameraAnalysis, J.toInnerStartFrame) : null;
                if (mA) mA.focalMm = focalMm(mA.zoom, A.width);
                if (mB) mB.focalMm = focalMm(mB.zoom, B.width);
                J.cameraLeavingScene = mA; J.cameraEnteringScene = mB;
                // what animates INSIDE each scene around the join (blur / fades usually live in there)
                if (A && A.layers) J.insideLeavingSceneNearEnd = keyedNear(A.layers, J.fromInnerEndFrame, NEAR_CUT_FRAMES, {});
                if (B && B.layers) J.insideEnteringSceneNearStart = keyedNear(B.layers, J.toInnerStartFrame, NEAR_CUT_FRAMES, {});
                var ev = evidenceFrom([J.fromAnimNearEnd, J.toAnimNearStart, J.otherLayersAnimatingAtJoin, J.insideLeavingSceneNearEnd, J.insideEnteringSceneNearStart]);
                if (ev.blur.length) J.blurAroundJoin = ev.blur;
                if (ev.fade.length) J.fadeAroundJoin = ev.fade;
                var dirA = null, ratio = null;
                if (mA && mB) {
                    dirA = (mA.speedPxPerFrame > 0.5 && mB.speedPxPerFrame > 0.5) ? vang(mA.direction, mB.direction) : null;
                    ratio = mA.speedPxPerFrame > 0.1 ? mB.speedPxPerFrame / mA.speedPxPerFrame : null;
                    J.cameraDirectionChangeDeg = dirA === null ? null : rnd(dirA, 1);
                    J.cameraFacingChangeDeg = rnd(vang(mA.facing, mB.facing), 1);
                    J.cameraSpeedRatio = ratio === null ? null : rnd(ratio, 2);
                }
                J.transition = classifyTransition({
                    invisible: false,
                    whip: (mA && mA.screenSpeedPx > WHIP_PX) || (mB && mB.screenSpeedPx > WHIP_PX),
                    blur: ev.blur, fade: ev.fade, dirAng: dirA, ratio: ratio,
                    sOut: mA ? mA.speedPxPerFrame : 0, sIn: mB ? mB.speedPxPerFrame : 0
                });
                bump(S.cam.joinTransitions, J.transition);
            }
        }
    }
    // ---------------- comps ----------------
    function dumpComp(comp) {
        var fps = comp.frameRate;
        var o = {
            id: comp.id, name: comp.name, folder: comp.parentFolder ? comp.parentFolder.name : "",
            width: comp.width, height: comp.height, pixelAspect: comp.pixelAspect,
            fps: r(fps), durationFrames: Math.round(comp.duration * fps), durationSec: r(comp.duration),
            bgColor: rgbHex(comp.bgColor), motionBlur: comp.motionBlur,
            shutterAngle: comp.shutterAngle, numLayers: comp.numLayers
        };
        S.compSettings.push(comp.width + "x" + comp.height + " @" + r(fps));
        var markers = safe(function () {
            var mp = comp.markerProperty, arr = [];
            for (var m = 1; m <= mp.numKeys; m++) arr.push({ frame: f(mp.keyTime(m), fps), comment: mp.keyValue(m).comment });
            return arr;
        }, null);
        if (markers && markers.length) o.markers = markers;

        var layers = [];
        for (var i = 1; i <= comp.numLayers; i++) {
            var d = safe(function () { return dumpLayer(comp.layer(i), comp); }, null);
            if (d) layers.push(d);
            else layers.push({ index: i, error: "could not read layer" });
        }
        o.layers = layers;

        // timeline view: who overlaps whom (this is where transitions show up)
        var tl = [];
        for (var a = 1; a <= comp.numLayers; a++) {
            var L = comp.layer(a);
            tl.push({ i: a, name: L.name, inF: f(L.inPoint, fps), outF: f(L.outPoint, fps) });
        }
        tl.sort(function (x, y) { return x.inF - y.inF; });
        for (var t = 0; t < tl.length - 1; t++) {
            var ov = tl[t].outF - tl[t + 1].inF;
            if (ov > 0 && ov < tl[t].outF - tl[t].inF) bump(S.layerOverlapFrames, bucket(ov, 2));
        }
        o.timeline = tl;

        var joins = findSceneJoins(comp, layers);
        if (joins.length) o.sceneJoins = joins;
        if (DO_CAMERAS) try {
            var ca = analyzeCameras(comp, layers);
            if (ca) o.cameraAnalysis = ca;
        } catch (camErr) {
            o.cameraAnalysisError = camErr.toString() + (camErr.line ? " (line " + camErr.line + ")" : "");
        }
        return o;
    }

    // ---------------- top-level ----------------
    function topN(map, n) {
        var arr = [];
        for (var k in map) if (map.hasOwnProperty(k)) arr.push({ v: k, count: map[k] });
        arr.sort(function (a, b) { return b.count - a.count; });
        return arr.slice(0, n || 25);
    }

    // ---------------- main comp + its precomp tree ----------------
    var DO_CAMERAS = true, CAM_STEP = 2, PROG = null;

    function collectTree(root) {
        var out = [], seen = {};
        function rec(c) {
            if (seen[c.id]) return { name: c.name, id: c.id, alsoUsedAbove: true };
            seen[c.id] = true;
            out.push(c);
            var node = { name: c.name, id: c.id }, kids = [];
            for (var i = 1; i <= c.numLayers; i++) {
                var src = safe(function () { return c.layer(i).source; }, null);
                if (src instanceof CompItem) kids.push(rec(src));
            }
            if (kids.length) node.precomps = kids;
            return node;
        }
        var tree = rec(root);
        return { comps: out, tree: tree };
    }

    function isMainName(n) { return /(^|[^a-z])(main|final|master|render|export|full)([^a-z]|$)/i.test(n); }

    function autoMainComp(proj) {
        var best = null, bestScore = -1, i, c;
        function consider(c, bonus) {
            var score = bonus + collectTree(c).comps.length * 10 + Math.min(c.duration, 600) / 600;
            if (score > bestScore) { bestScore = score; best = c; }
        }
        var rq = safe(function () { return proj.renderQueue; }, null);
        if (rq) for (i = 1; i <= rq.numItems; i++) {
            c = safe(function () { return rq.item(i).comp; }, null);
            if (c) consider(c, 100000);
        }
        if (best) return best;
        for (i = 1; i <= proj.numItems; i++) {
            c = proj.item(i);
            if (c instanceof CompItem && safe(function () { return c.usedIn.length === 0; }, true))
                consider(c, isMainName(c.name) ? 1000 : 0);
        }
        if (best) return best;
        for (i = 1; i <= proj.numItems; i++) if (proj.item(i) instanceof CompItem) consider(proj.item(i), 0);
        return best;
    }

    function progressOpen() {
        try {
            var w = new Window("palette", "AE Style Exporter");
            w.orientation = "column"; w.alignChildren = "fill"; w.margins = 14;
            var t = w.add("statictext", undefined, "Starting..."); t.characters = 60;
            var b = w.add("progressbar", undefined, 0, 100); b.preferredSize.width = 420;
            w.show();
            return { w: w, t: t, b: b };
        } catch (e) { return null; }
    }
    function progress(msg, frac) {
        if (!PROG) return;
        try { PROG.t.text = msg; if (frac !== undefined) PROG.b.value = Math.round(frac * 100); PROG.w.update(); } catch (e) {}
    }
    function progressClose() { if (PROG) { try { PROG.w.close(); } catch (e) {} } PROG = null; }
    function cleanName(n) { return String(n).replace(/[\/\\:\*\?"<>\|]/g, "_"); }

    function exportProject(outFolder, mainComp) {
        var proj = app.project;
        if (!mainComp) throw new Error("No main comp found in this project.");
        resetStats();
        var projName = proj.file ? decodeURI(proj.file.name).replace(/\.aepx?$/i, "") : "Untitled";
        var base = cleanName(projName + " - " + mainComp.name);
        var i;
        PRE_FOLDERS = {};
        for (i = 1; i <= proj.numItems; i++) if (proj.item(i) instanceof FolderItem) PRE_FOLDERS[proj.item(i).id] = true;

        // only the main comp and the precomps nested inside it
        var treeInfo = collectTree(mainComp), compItems = treeInfo.comps;
        var comps = [];
        for (i = 0; i < compItems.length; i++) {
            progress(projName + ":  comp " + (i + 1) + " / " + compItems.length + "  -  " + compItems[i].name, i / compItems.length);
            comps.push(dumpComp(compItems[i]));
        }
        progress("Linking scene joins and writing files...", 1);
        linkJoinsToCameras(comps);

        var camSummary = {
            cameras: S.cam.count, twoNodeCameras: S.cam.twoNode, camerasOnNullRigs: S.cam.rigged, camerasWithDOF: S.cam.dof,
            focalLengthMm: topN(S.cam.focalMm, 10),
            moveDurationsFrames: topN(S.cam.moveFrames, 20), moveTypes: topN(S.cam.moveTypes, 20),
            easeShapes: topN(S.cam.easeLabels), speedPeakAtPctOfMove: topN(S.cam.peakAtPct),
            cameraHandoffs: topN(S.cam.handoffTypes), sceneJoinOverlapFrames: topN(S.cam.joinOverlap, 10),
            sceneJoinTransitions: topN(S.cam.joinTransitions),
            cameraKeyframeEase: topN(S.cam.rigEase, 15), cameraKeyframeMoveFrames: topN(S.cam.rigSegFrames, 20),
            holdBetweenMovesFrames: topN(S.cam.holdFrames, 15), ambientDrift: topN(S.cam.drift, 10),
            exampleMoves: S.cam.examples
        };

        // camera-focused file: everything about cameras and scene transitions, minus raw paths
        var camComps = [];
        for (i = 0; i < comps.length; i++) {
            var c = comps[i];
            if (!c.cameraAnalysis && !c.sceneJoins) continue;
            var ca = c.cameraAnalysis, cams = [];
            if (ca) for (var k = 0; k < ca.cameras.length; k++) {
                var src = ca.cameras[k], cp = {};
                for (var key in src) if (src.hasOwnProperty(key) && key !== "path") cp[key] = src[key];
                cams.push(cp);
            }
            camComps.push({
                name: c.name, id: c.id, size: c.width + "x" + c.height, fps: c.fps, durationFrames: c.durationFrames,
                renderer: ca ? ca.renderer : undefined, cameras: cams,
                shots: ca ? ca.shots : undefined, handoffs: ca ? ca.handoffs : undefined,
                sceneJoins: c.sceneJoins, layout3D: ca ? ca.layout3D : undefined,
                cameraAnalysisError: c.cameraAnalysisError
            });
        }
        var camFile = {
            project: base, mainComp: mainComp.name,
            howToRead: {
                worldSpace: "All camera positions are WORLD space (null rigs / parenting included), sampled every frame via a temporary probe.",
                moves: "A move = a keyframed move on the camera or any null in its rig (holds split moves). keyframes = the exact keyframe segments (influence %, frames) behind the move. cameraRelativePx: dolly (+forward), truck (sideways), pedestal (+up).",
                drift: "Ambient motion from expressions on the rig (e.g. sine drift on a control null), measured outside the moves.",
                easeFingerprint: "Fraction of the move completed at 10%,20%..90% of its duration. Linear = 0.1..0.9. Strong ease-out landing = e.g. [0.15,0.38,0.58,0.73,0.84,0.91,0.96,0.99,1.0].",
                peakAtPct: "When the camera is fastest within the move (0 = start, 1 = end).",
                shots: "Which camera layer is rendering each frame (top-most active camera wins).",
                handoffs: "Switch from one camera to another inside one comp. type says what hides/carries the cut: whip (fast move + motion blur), blur transition, opacity fade, motion carried through. positionGapPx is only meaningful when both cameras frame the same layers.",
                sceneJoins: "Consecutive precomp layers that touch/overlap in a parent comp: transition type, blur/fade around the join (inside both scenes too) and how the cameras INSIDE each precomp are moving when they meet.",
                layout3D: "World position of each 3D layer at its mid-point: shows how scenes are arranged in space."
            },
            stats: camSummary,
            comps: camComps
        };

        var full = {
            exporter: "AE Style Exporter 4.0",
            aeVersion: app.version,
            project: proj.file ? decodeURI(proj.file.fsName) : "Untitled",
            mainComp: mainComp.name,
            compTree: treeInfo.tree,
            cameraSampleEveryFrames: DO_CAMERAS ? CAM_STEP : "camera analysis off",
            exportedAt: new Date().toString(),
            bitsPerChannel: proj.bitsPerChannel,
            compCount: comps.length,
            comps: comps
        };
        var summary = {
            project: base, mainComp: mainComp.name, compsExported: comps.length,
            note: "Counts across all comps. easePairs = 'outInfluence/inInfluence' (%) bucketed to 5. segmentFrames = frames between consecutive keyframes.",
            compSettings: topN((function () { var m = {}; for (var c = 0; c < S.compSettings.length; c++) bump(m, S.compSettings[c]); return m; })(), 10),
            layerTypes: topN(S.layerTypes), blendModes: topN(S.blendModes), trackMattes: topN(S.trackMattes),
            mostAnimatedProps: topN(S.animatedProps, 30), interpolation: topN(S.interpolation),
            easePairs: topN(S.easePairs, 20), easeOutInfluence: topN(S.easeOutInfluence), easeInInfluence: topN(S.easeInInfluence),
            moveDurationsFrames: topN(S.segmentFrames, 30), layerOverlapFrames: topN(S.layerOverlapFrames, 15),
            layerDurationsFrames: topN(S.layerDurationsFrames, 15),
            effects: topN(S.effects, 40), textAnimatorProps: topN(S.textAnimatorProps), textSelectorShapes: topN(S.textSelectorShapes),
            textAnimatorRecipes: topN(S.textRecipes, 15), textAnimatorExamples: S.textRecipeExamples,
            fonts: topN(S.fonts), fontSizes: topN(S.fontSizes), tracking: topN(S.tracking), leading: topN(S.leading), textColors: topN(S.textColors),
            motionBlurLayers: S.motionBlurLayers, threeDLayers: S.threeDLayers,
            expressionCount: S.expressions.length, expressions: S.expressions.slice(0, 60),
            camera: camSummary
        };
        writeFile(new File(outFolder.fsName + "/" + base + ".full.json"), stringify(full, " "));
        writeFile(new File(outFolder.fsName + "/" + base + ".summary.json"), stringify(summary, "  "));
        writeFile(new File(outFolder.fsName + "/" + base + ".camera.json"), stringify(camFile, "  "));
        return base;
    }

    function writeFile(file, text) {
        file.encoding = "UTF-8";
        file.lineFeed = "Unix";
        if (!file.open("w")) throw new Error("Cannot write " + file.fsName + " - is 'Allow Scripts to Write Files' turned on?");
        file.write(text);
        file.close();
    }

    // ---------------- UI ----------------
    function showDialog() {
        var proj = app.project, all = [], roots = [], others = [], i, c;
        for (i = 1; i <= proj.numItems; i++) if (proj.item(i) instanceof CompItem) all.push(proj.item(i));
        for (i = 0; i < all.length; i++) {
            c = all[i];
            if (safe(function () { return c.usedIn.length === 0; }, true)) roots.push({ c: c, n: collectTree(c).comps.length });
            else others.push({ c: c, n: 0 });
        }
        roots.sort(function (a, b) { return b.n - a.n; });
        others.sort(function (a, b) { return a.c.name.toLowerCase() < b.c.name.toLowerCase() ? -1 : 1; });
        var list = roots.concat(others);

        var w = new Window("dialog", "AE Style Exporter");
        w.orientation = "column"; w.alignChildren = "fill"; w.margins = 16;

        var modeP = w.add("panel", undefined, "Export");
        modeP.alignChildren = "left"; modeP.margins = 12;
        var rbOne = modeP.add("radiobutton", undefined, "This project: main comp + its precomps only");
        var compG = modeP.add("group");
        compG.add("statictext", undefined, "Main comp:");
        var dd = compG.add("dropdownlist", undefined, []);
        dd.preferredSize.width = 360;
        for (i = 0; i < list.length; i++) {
            var it = list[i];
            dd.add("item", it.n ? it.c.name + "   (" + (it.n - 1) + " precomps inside)" : "     " + it.c.name + "   (used inside another comp)");
        }
        var rbBatch = modeP.add("radiobutton", undefined, "Batch: a folder of .aep files (main comp picked automatically)");

        var optP = w.add("panel", undefined, "Options");
        optP.alignChildren = "left"; optP.margins = 12;
        var cbCam = optP.add("checkbox", undefined, "Analyse 3D cameras (moves, handoffs, scene joins)");
        cbCam.value = true;
        var stepG = optP.add("group");
        stepG.add("statictext", undefined, "Camera sampling:");
        var ddStep = stepG.add("dropdownlist", undefined, ["every frame (most precise, slowest)", "every 2 frames (recommended)", "every 4 frames (fastest)"]);
        ddStep.selection = 1;
        cbCam.onClick = function () { ddStep.enabled = cbCam.value; };

        var btns = w.add("group"); btns.alignment = "right";
        btns.add("button", undefined, "Cancel", { name: "cancel" });
        btns.add("button", undefined, "Export", { name: "ok" });

        // preselect: the comp you have open / selected, else the auto-detected main comp
        var pre = safe(function () { return proj.activeItem instanceof CompItem ? proj.activeItem : null; }, null);
        if (!pre) pre = safe(function () { var sel = proj.selection; for (var k = 0; k < sel.length; k++) if (sel[k] instanceof CompItem) return sel[k]; return null; }, null);
        if (!pre && list.length) pre = autoMainComp(proj);
        for (i = 0; i < list.length; i++) if (pre && list[i].c.id === pre.id) dd.selection = i;
        if (!dd.selection && list.length) dd.selection = 0;

        function sync() { dd.enabled = rbOne.value; }
        rbOne.onClick = sync; rbBatch.onClick = sync;
        if (list.length) rbOne.value = true; else { rbBatch.value = true; rbOne.enabled = false; }
        sync();

        if (w.show() !== 1) return null;
        return {
            batch: rbBatch.value,
            mainComp: (rbOne.value && dd.selection) ? list[dd.selection.index].c : null,
            cameras: cbCam.value,
            step: [1, 2, 4][ddStep.selection ? ddStep.selection.index : 1]
        };
    }

    var opts = showDialog();
    if (!opts) return;
    DO_CAMERAS = opts.cameras;
    CAM_STEP = opts.step;
    var outFolder = Folder.selectDialog("Choose where to save the JSON files");
    if (!outFolder) return;
    var started = new Date().getTime();
    function secs() { return Math.round((new Date().getTime() - started) / 1000) + "s"; }

    if (!opts.batch) {
        if (!opts.mainComp) { alert("Pick a main comp."); return; }
        PROG = progressOpen();
        app.beginUndoGroup("AE Style Exporter");
        try {
            var name = exportProject(outFolder, opts.mainComp);
            progressClose();
            alert("Done in " + secs() + "\n\n" + name + ".full.json\n" + name + ".summary.json\n" + name + ".camera.json\n\n" + outFolder.fsName);
        } catch (e) {
            progressClose();
            alert("Export failed: " + e.toString() + (e.line ? " (line " + e.line + ")" : ""));
        }
        app.endUndoGroup();
        return;
    }

    var inFolder = Folder.selectDialog("Choose the folder containing your .aep projects");
    if (!inFolder) return;
    var files = inFolder.getFiles(function (fl) { return fl instanceof File && /\.aepx?$/i.test(fl.name); });
    if (!files.length) { alert("No .aep files in that folder."); return; }
    if (!confirm("Export " + files.length + " project(s)?\nYour current project will be closed (you'll be asked to save it).")) return;
    if (!app.project.close(CloseOptions.PROMPT_TO_SAVE_CHANGES)) return;

    var ok = [], fail = [];
    PROG = progressOpen();
    app.beginSuppressDialogs();
    for (var i = 0; i < files.length; i++) {
        try {
            progress("Opening " + decodeURI(files[i].name) + "  (" + (i + 1) + " / " + files.length + ")", 0);
            app.open(files[i]);
            var main = autoMainComp(app.project);
            var n = exportProject(outFolder, main);
            ok.push(n);
            app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
        } catch (err) {
            fail.push(decodeURI(files[i].name) + ": " + err.toString());
            try { app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES); } catch (e2) {}
        }
    }
    app.endSuppressDialogs(false);
    progressClose();
    alert("Exported " + ok.length + " / " + files.length + " projects in " + secs() + " to:\n" + outFolder.fsName +
          "\n\n" + ok.join("\n") + (fail.length ? "\n\nFailed:\n" + fail.join("\n") : ""));
})();
