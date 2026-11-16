/*  Claude Style Library for After Effects  (CS.*)
    ------------------------------------------------------------------
    Builds scenes in the house style learned from three SaaS explainer projects.
    Loaded automatically in front of every job the MCP server sends.
    CS.profile is injected by the server from style/profile.json.

    ExtendScript = ES3: no let/const/arrow functions, no JSON object.
    Frames are always comp frames (integers at 30 fps) unless noted.
*/
var CS = (typeof CS !== "undefined" && CS) ? CS : {};

(function (CS) {

    // ------------------------------------------------------------ basics
    function P() { if (!CS.profile) throw new Error("Style profile not loaded"); return CS.profile; }
    function isArr(v) { return v instanceof Array || Object.prototype.toString.call(v) === "[object Array]"; }
    function clone(v) { if (isArr(v)) { var a = []; for (var i = 0; i < v.length; i++) a.push(clone(v[i])); return a; } return v; }
    function vadd(a, b) { var o = []; for (var i = 0; i < a.length; i++) o.push(a[i] + (b[i] || 0)); return o; }
    function vsub(a, b) { var o = []; for (var i = 0; i < a.length; i++) o.push(a[i] - (b[i] || 0)); return o; }
    function num(v, d) { return (typeof v === "number" && !isNaN(v)) ? v : d; }
    function pick(o, k, d) { return (o && o[k] !== undefined && o[k] !== null) ? o[k] : d; }
    CS._warnings = [];
    function warn(msg) { CS._warnings.push(String(msg)); }
    CS.warn = warn;

    // ------------------------------------------------------------ JSON out (ES3)
    function esc(s) {
        s = String(s); var out = "", c, code;
        for (var i = 0; i < s.length; i++) {
            c = s.charAt(i); code = s.charCodeAt(i);
            if (c === "\"") out += "\\\""; else if (c === "\\") out += "\\\\";
            else if (c === "\n") out += "\\n"; else if (c === "\r") out += "\\r"; else if (c === "\t") out += "\\t";
            else if (code < 32) { var h = code.toString(16); while (h.length < 4) h = "0" + h; out += "\\u" + h; }
            else out += c;
        }
        return "\"" + out + "\"";
    }
    CS.stringify = function (v) {
        if (v === null || v === undefined) return "null";
        if (typeof v === "number") return isFinite(v) ? String(Math.round(v * 10000) / 10000) : "null";
        if (typeof v === "boolean") return v ? "true" : "false";
        if (typeof v === "string") return esc(v);
        if (isArr(v)) { var a = []; for (var i = 0; i < v.length; i++) a.push(CS.stringify(v[i])); return "[" + a.join(",") + "]"; }
        if (typeof v === "object") {
            var p = [];
            for (var k in v) if (v.hasOwnProperty(k) && v[k] !== undefined && typeof v[k] !== "function") p.push(esc(k) + ":" + CS.stringify(v[k]));
            return "{" + p.join(",") + "}";
        }
        return esc(String(v));
    };

    // ------------------------------------------------------------ lookup
    CS.comp = function (name) {
        if (name && typeof name === "object" && name instanceof CompItem) return name;
        if (!name) {
            var a = app.project.activeItem;
            if (a instanceof CompItem) return a;
            throw new Error("No comp given and no active comp");
        }
        for (var i = 1; i <= app.project.numItems; i++) {
            var it = app.project.item(i);
            if (it instanceof CompItem && it.name === name) return it;
        }
        throw new Error("Comp not found: " + name);
    };
    CS.findComp = function (name) { try { return CS.comp(name); } catch (e) { return null; } };
    CS.layer = function (comp, name) {
        comp = CS.comp(comp);
        if (typeof name === "number") return comp.layer(name);
        for (var i = 1; i <= comp.numLayers; i++) if (comp.layer(i).name === name) return comp.layer(i);
        throw new Error("Layer not found in '" + comp.name + "': " + name);
    };
    CS.findLayer = function (comp, name) { try { return CS.layer(comp, name); } catch (e) { return null; } };
    CS.folder = function (name) {
        for (var i = 1; i <= app.project.numItems; i++) {
            var it = app.project.item(i);
            if (it instanceof FolderItem && it.name === name) return it;
        }
        return app.project.items.addFolder(name);
    };
    function tr(layer, mn) { return layer.property("ADBE Transform Group").property(mn); }
    CS.tr = tr;
    function fpsOf(comp) { return comp.frameRate; }
    function sec(comp, frames) { return frames / comp.frameRate; }
    CS.sec = sec;

    CS.trim = function (layer, comp, f0, f1) {
        var t0 = sec(comp, f0), t1 = sec(comp, f1);
        if (t1 <= t0) t1 = t0 + 1 / comp.frameRate;
        try {
            if (t0 >= layer.outPoint) { layer.outPoint = t1; layer.inPoint = t0; }
            else { layer.inPoint = t0; layer.outPoint = t1; }
        } catch (e) { warn("trim failed on '" + layer.name + "': " + e); }
    };

    // ------------------------------------------------------------ effects
    // values: { "0001": v, "0003": v }  -> sets "<matchName>-0001" etc.
    CS.addEffect = function (layer, matchName, displayName, values) {
        var parade = layer.property("ADBE Effect Parade");
        if (!parade.canAddProperty(matchName)) throw new Error("Effect not available: " + matchName);
        parade.addProperty(matchName);
        var idx = layer.property("ADBE Effect Parade").numProperties;
        var fx = layer.property("ADBE Effect Parade").property(idx);
        if (displayName) fx.name = displayName;
        if (values) for (var k in values) if (values.hasOwnProperty(k)) {
            var p = layer.property("ADBE Effect Parade").property(idx).property(matchName + "-" + k);
            if (p) { try { p.setValue(values[k]); } catch (e) { warn(matchName + "-" + k + ": " + e); } }
        }
        return idx;
    };
    CS.effectProp = function (layer, idx, matchName, param) {
        return layer.property("ADBE Effect Parade").property(idx).property(matchName + "-" + param);
    };
    function findEffect(layer, matchName, name) {
        var parade = layer.property("ADBE Effect Parade");
        for (var i = 1; i <= parade.numProperties; i++) {
            var fx = parade.property(i);
            if (fx.matchName === matchName && (!name || fx.name === name)) return i;
        }
        return 0;
    }

    // ------------------------------------------------------------ keyframes & eases
    function easeDims(prop) {
        var t = prop.propertyValueType;
        if (t === PropertyValueType.ThreeD_SPATIAL || t === PropertyValueType.TwoD_SPATIAL) return 1;
        if (t === PropertyValueType.ThreeD) return 3;
        if (t === PropertyValueType.TwoD) return 2;
        if (t === PropertyValueType.COLOR) return 4;
        return 1;
    }
    function easeArr(prop, influence) {
        var a = [], n = easeDims(prop);
        influence = Math.max(0.1, Math.min(100, influence));
        for (var i = 0; i < n; i++) a.push(new KeyframeEase(0, influence));
        return a;
    }
    function isSpatial(prop) {
        var t = prop.propertyValueType;
        return t === PropertyValueType.ThreeD_SPATIAL || t === PropertyValueType.TwoD_SPATIAL;
    }
    CS.EASES = function () {
        var e = P().cameraMoves.eases, im = P().images.enter, out = {};
        for (var k in e) if (e.hasOwnProperty(k)) out[k] = e[k];
        out.linear = { outInfluence: 16.67, inInfluence: 16.67, outLinear: true, inLinear: true };
        out.pop = { outInfluence: 16.67, inInfluence: im.blurPop.inInfluence, outLinear: true };
        out.soft = { outInfluence: 85, inInfluence: 85 };
        out.exit = { outInfluence: 85, inInfluence: 16.67, inLinear: true };
        return out;
    };
    function easeSpec(e) {
        if (!e) e = "glide";
        if (typeof e === "string") {
            var all = CS.EASES();
            if (!all[e]) throw new Error("Unknown ease '" + e + "'. Use one of: glide, glideStrong, punch, pop, soft, exit, linear");
            return all[e];
        }
        return e;
    }
    CS.easeSpec = easeSpec;

    // keyframe prop from frame f0 (value v0) to f1 (value v1) with an ease spec
    CS.animate = function (prop, comp, f0, f1, v0, v1, ease) {
        var es = easeSpec(ease);
        var t0 = sec(comp, f0), t1 = sec(comp, f1);
        prop.setValueAtTime(t0, v0);
        prop.setValueAtTime(t1, v1);
        var k0 = prop.nearestKeyIndex(t0), k1 = prop.nearestKeyIndex(t1);
        var BZ = KeyframeInterpolationType.BEZIER, LN = KeyframeInterpolationType.LINEAR;
        // start key: outgoing side
        prop.setInterpolationTypeAtKey(k0, prop.keyInInterpolationType(k0), es.outLinear ? LN : BZ);
        // end key: incoming side
        prop.setInterpolationTypeAtKey(k1, es.inLinear ? LN : BZ, prop.keyOutInterpolationType(k1));
        if (!es.outLinear) prop.setTemporalEaseAtKey(k0, prop.keyInTemporalEase(k0), easeArr(prop, es.outInfluence));
        if (!es.inLinear) prop.setTemporalEaseAtKey(k1, easeArr(prop, es.inInfluence), prop.keyOutTemporalEase(k1));
        if (isSpatial(prop)) {
            var z = []; for (var i = 0; i < (isArr(v0) ? v0.length : 1); i++) z.push(0);
            var ks = [k0, k1];
            for (var j = 0; j < 2; j++) {
                try {
                    prop.setSpatialAutoBezierAtKey(ks[j], false);
                    prop.setSpatialContinuousAtKey(ks[j], false);
                    prop.setSpatialTangentsAtKey(ks[j], z, z);
                } catch (e2) {}
            }
        }
        return [k0, k1];
    };
    // value of a property ignoring expressions
    function rawAt(prop, comp, frame) { return clone(prop.valueAtTime(sec(comp, frame), true)); }

    // ------------------------------------------------------------ scene / comp
    CS.createScene = function (o) {
        o = o || {};
        var c = P().comp;
        var frames = num(o.frames, 300);
        var name = o.name || "Scene";
        if (CS.findComp(name)) {
            if (o.replace) { CS.comp(name).remove(); }
            else throw new Error("A comp named '" + name + "' already exists (pass replace:true to rebuild it)");
        }
        var comp = app.project.items.addComp(name, c.width, c.height, c.pixelAspect, frames / c.fps, c.fps);
        comp.parentFolder = CS.folder(o.folder || "Claude Scenes");
        try {
            var rs = comp.renderers, ok = false;
            for (var i = 0; i < rs.length; i++) if (rs[i] === c.renderer) ok = true;
            if (ok) comp.renderer = c.renderer; else warn("Renderer " + c.renderer + " not available; using " + comp.renderer);
        } catch (e) { warn("Could not set renderer: " + e); }
        comp.motionBlur = c.motionBlur;
        comp.shutterAngle = c.shutterAngle;
        comp.bgColor = c.bgColor;
        if (o.background !== false) CS.addBackground(comp, o.palette);
        CS.ensureControlNull(comp);
        return comp;
    };

    CS.palette = function (p) {
        var pals = P().palettes;
        if (!p) return pals.blue;
        if (typeof p === "string") { if (!pals[p]) throw new Error("Unknown palette '" + p + "' (have: blue, warm)"); return pals[p]; }
        if (isArr(p) && p.length === 4) {
            var out = [];
            for (var i = 0; i < 4; i++) out.push(p[i].length === 3 ? [p[i][0], p[i][1], p[i][2], 1] : p[i]);
            return out;
        }
        throw new Error("palette must be 'blue', 'warm' or 4 RGB colours (0-1)");
    };

    CS.addBackground = function (comp, palette) {
        comp = CS.comp(comp);
        var c = P().comp, bg = P().background, b = bg.blob, cols = CS.palette(palette);
        var base = comp.layers.addSolid(CS._baseColor || c.baseSolidColor, "BG Base", comp.width, comp.height, 1, comp.duration);
        base.locked = false;
        var blobLayers = [];
        for (var i = 0; i < bg.blobs.length; i++) {
            var spec = bg.blobs[i];
            var L = comp.layers.addShape();
            L.name = spec.name;
            L.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
            L.property("ADBE Root Vectors Group").property(1).name = "Rectangle 1";
            L.property("ADBE Root Vectors Group").property(1).property("ADBE Vectors Group").addProperty("ADBE Vector Shape - Rect");
            L.property("ADBE Root Vectors Group").property(1).property("ADBE Vectors Group").property(1).property("ADBE Vector Rect Size").setValue(b.rectSize);
            L.property("ADBE Root Vectors Group").property(1).property("ADBE Vectors Group").addProperty("ADBE Vector Graphic - Fill");
            L.property("ADBE Root Vectors Group").property(1).property("ADBE Vectors Group").property(2).property("ADBE Vector Fill Color").setValue(b.fill);
            L.property("ADBE Root Vectors Group").property(1).property("ADBE Vector Transform Group").property("ADBE Vector Position").setValue(b.rectOffset);
            L.property("ADBE Root Vectors Group").addProperty("ADBE Vector Filter - Roughen");
            var wg = function () { return L.property("ADBE Root Vectors Group").property(2); };
            wg().property("ADBE Vector Roughen Size").setValue(b.wiggle.size);
            wg().property("ADBE Vector Roughen Detail").setValue(b.wiggle.detail);
            wg().property("ADBE Vector Roughen Points").setValue(b.wiggle.points);
            wg().property("ADBE Vector Temporal Freq").setValue(b.wiggle.wigglesPerSecond);
            wg().property("ADBE Vector Correlation").setValue(b.wiggle.correlation);
            wg().property("ADBE Vector Random Seed").setValue(b.wiggle.seed + i);
            CS.addEffect(L, "ADBE Gaussian Blur 2", "Gaussian Blur", { "0001": b.gaussianBlur, "0003": 0 });
            CS.addEffect(L, "ADBE Box Blur2", "Fast Box Blur", { "0001": b.boxBlur.radius, "0002": b.boxBlur.iterations, "0004": 0 });
            CS.addEffect(L, "ADBE 4ColorGradient", "4-Color Gradient", {
                "0001": b.gradientPoints[0], "0002": cols[0], "0003": b.gradientPoints[1], "0004": cols[1],
                "0005": b.gradientPoints[2], "0006": cols[2], "0007": b.gradientPoints[3], "0008": cols[3]
            });
            CS.addEffect(L, "ADBE Noise2", "Noise", { "0001": b.noise });
            CS.addEffect(L, "ADBE Posterize", "Posterize", { "0001": b.posterize });
            L.threeDLayer = true;
            tr(L, "ADBE Position").setValue(spec.position);
            tr(L, "ADBE Scale").setValue([b.scale, b.scale, b.scale]);
            tr(L, "ADBE Rotate Z").setValue(spec.zRotation || 0);
            tr(L, "ADBE Opacity").setValue(b.opacity);
            blobLayers.push(L);
        }
        // keep the background at the bottom of the stack: blobs, then base solid
        for (var j = 0; j < blobLayers.length; j++) blobLayers[j].moveToEnd();
        base.moveToEnd();
        return { base: base.name, blobs: bg.blobs.length };
    };

    CS.ensureControlNull = function (comp) {
        comp = CS.comp(comp);
        var ex = CS.findLayer(comp, "Control Null");
        if (ex) return ex;
        var rig = P().cameraRig.controlNull;
        var n = comp.layers.addNull(comp.duration);
        n.name = "Control Null";
        n.threeDLayer = true;
        n.label = 2;
        var sliders = [["TC - freq", rig.drift.freq], ["TC - ampX", rig.drift.ampX], ["TC - ampY", rig.drift.ampY], ["TC - ampZ", rig.drift.ampZ]];
        for (var i = 0; i < sliders.length; i++) CS.addEffect(n, "ADBE Slider Control", sliders[i][0], { "0001": sliders[i][1] });
        tr(n, "ADBE Position").setValue(rig.position);
        tr(n, "ADBE Position").expression = rig.expression;
        return n;
    };

    // ------------------------------------------------------------ camera shots
    function ctrlName(shot) { return "Camera_Controller " + shot; }
    function camName(shot) { return "Camera " + shot; }
    CS.shotLayers = function (comp, shot) {
        comp = CS.comp(comp);
        return { ctrl: CS.layer(comp, ctrlName(shot)), cam: CS.layer(comp, camName(shot)) };
    };

    // o: { name, start, end, offset:[x,y,z] (controller rest offset), overshoot:bool }
    CS.addShot = function (comp, o) {
        comp = CS.comp(comp);
        if (!o || !o.name) throw new Error("addShot needs a name");
        if (CS.findLayer(comp, ctrlName(o.name))) throw new Error("Shot '" + o.name + "' already exists in " + comp.name);
        var rig = P().cameraRig, cn = CS.ensureControlNull(comp);
        var start = num(o.start, 0), end = num(o.end, Math.round(comp.duration * comp.frameRate));
        var ctrl = comp.layers.addNull(comp.duration);
        ctrl.name = ctrlName(o.name);
        ctrl.threeDLayer = true;
        ctrl.label = 11;
        ctrl.parent = cn;
        tr(ctrl, "ADBE Position").setValue(o.offset || [0, 0, 0]);
        if (o.overshoot) tr(ctrl, "ADBE Position").expression = rig.overshootExpression;
        var cam = comp.layers.addCamera(camName(o.name), [comp.width / 2, comp.height / 2]);
        cam.autoOrient = AutoOrientType.NO_AUTO_ORIENT;
        cam.property("ADBE Camera Options Group").property("ADBE Camera Zoom").setValue(rig.camera.zoom);
        cam.parent = ctrl;
        tr(cam, "ADBE Position").setValue(rig.camera.localPosition);
        try { tr(cam, "ADBE Orientation").setValue([0, 0, 0]); } catch (e) {}
        CS.trim(ctrl, comp, start, end);
        CS.trim(cam, comp, start, end);
        return { shot: o.name, camera: cam.name, controller: ctrl.name, start: start, end: end };
    };

    var DIRS = { down: [0, 1, 0], up: [0, -1, 0], left: [-1, 0, 0], right: [1, 0, 0], "in": [0, 0, 1], out: [0, 0, -1] };
    var DEFAULT_DIST = function (dir, ease) {
        var d = P().cameraMoves.typicalDistancePx;
        if (dir === "in" || dir === "out") return ease === "punch" ? d.dollyPunch : d.dolly;
        if (dir === "left" || dir === "right") return d.truck;
        return d.crane;
    };
    // move spec -> controller delta.  {dir:'down', dist:390} or {by:[x,y,z]}
    CS.moveVector = function (m) {
        if (!m) throw new Error("move spec missing");
        if (m.by) return [num(m.by[0], 0), num(m.by[1], 0), num(m.by[2], 0)];
        var u = DIRS[m.dir];
        if (!u) throw new Error("Unknown move dir '" + m.dir + "' (down, up, left, right, in, out)");
        var dist = num(m.dist, DEFAULT_DIST(m.dir, m.ease));
        return [u[0] * dist, u[1] * dist, u[2] * dist];
    };
    CS.moveDefaults = function (m) {
        var ease = m.ease || "glide";
        var es = easeSpec(ease);
        return { ease: ease, frames: num(m.frames, es.frames || 40) };
    };

    // camera move on one shot: {at, frames, dir/dist or by, ease}
    CS.moveCamera = function (comp, shot, m) {
        comp = CS.comp(comp);
        var L = CS.shotLayers(comp, shot), pos = tr(L.ctrl, "ADBE Position");
        var d = CS.moveDefaults(m), by = CS.moveVector(m);
        var at = num(m.at, 0);
        var v0 = rawAt(pos, comp, at);
        CS.animate(pos, comp, at, at + d.frames, v0, vadd(v0, by), d.ease);
        return { shot: shot, from: at, to: at + d.frames, by: by, ease: d.ease };
    };

    // the signature cut: same move split across two shots, cut at its midpoint
    // m: {at (cut frame), dir/dist or by, frames (40), ease}
    CS.splitCut = function (comp, fromShot, toShot, m) {
        comp = CS.comp(comp);
        var d = CS.moveDefaults(m), by = CS.moveVector(m);
        var half = Math.round(d.frames / 2), at = num(m.at, 0);
        var A = fromShot ? CS.shotLayers(comp, fromShot) : null, B = toShot ? CS.shotLayers(comp, toShot) : null;
        var res = { cutAt: at, by: by, frames: d.frames, ease: d.ease };
        if (A) {
            var pa = tr(A.ctrl, "ADBE Position"), a0 = rawAt(pa, comp, at - half);
            CS.animate(pa, comp, at - half, at + d.frames - half, a0, vadd(a0, by), d.ease);
            CS.trim(A.ctrl, comp, Math.round(A.ctrl.inPoint * comp.frameRate), at);
            CS.trim(A.cam, comp, Math.round(A.cam.inPoint * comp.frameRate), at);
            res.from = fromShot;
        }
        if (B) {
            var pb = tr(B.ctrl, "ADBE Position"), rest = rawAt(pb, comp, at + d.frames - half);
            CS.animate(pb, comp, at - half, at + d.frames - half, vsub(rest, by), rest, d.ease);
            var bOut = Math.round(B.cam.outPoint * comp.frameRate);
            CS.trim(B.ctrl, comp, at, bOut);
            CS.trim(B.cam, comp, at, bOut);
            res.to = toShot;
        }
        return res;
    };

    // ------------------------------------------------------------ text
    function textProps(L) { return L.property("ADBE Text Properties"); }
    function animators(L) { return textProps(L).property("ADBE Text Animators"); }
    function addAnimator(L, name, props) {
        animators(L).addProperty("ADBE Text Animator");
        var idx = animators(L).numProperties;
        animators(L).property(idx).name = name;
        for (var i = 0; i < props.length; i++) {
            animators(L).property(idx).property("ADBE Text Animator Properties").addProperty(props[i][0]);
            var p = animators(L).property(idx).property("ADBE Text Animator Properties").property(props[i][0]);
            if (p) { try { p.setValue(props[i][1]); } catch (e) { warn("text animator " + props[i][0] + ": " + e); } }
        }
        return idx;
    }
    function addSelector(L, idx, matchName) {
        animators(L).property(idx).property("ADBE Text Selectors").addProperty(matchName || "ADBE Text Selector");
        var n = animators(L).property(idx).property("ADBE Text Selectors").numProperties;
        return function () { return animators(L).property(idx).property("ADBE Text Selectors").property(n); };
    }
    function advanced(sel, mn, v) {
        try { sel().property("ADBE Text Range Advanced").property(mn).setValue(v); } catch (e) { warn("selector " + mn + ": " + e); }
    }
    var BASED_ON = { characters: 1, charactersExcludingSpaces: 2, words: 3, lines: 4 };

    function revealBlurRise(L, comp, at, frames) {
        var r = P().text.reveals.blurRise;
        var idx = addAnimator(L, "Reveal", [
            ["ADBE Text Position 3D", r.animator.position], ["ADBE Text Opacity", r.animator.opacity],
            ["ADBE Text Tracking Amount", r.animator.trackingAmount], ["ADBE Text Blur", r.animator.blur]
        ]);
        var sel = addSelector(L, idx);
        advanced(sel, "ADBE Text Range Type2", BASED_ON.words);
        advanced(sel, "ADBE Text Range Shape", 1);
        CS.animate(sel().property("ADBE Text Percent Start"), comp, at, at + num(frames, r.start.frames), 0, 100,
            { outInfluence: r.start.outInfluence, inInfluence: r.start.inInfluence });
    }
    function revealBounce(L, comp, at) {
        var r = P().text.reveals.bounceWords;
        var idx = addAnimator(L, "Bounce", [
            ["ADBE Text Position 3D", r.animator.position], ["ADBE Text Opacity", r.animator.opacity], ["ADBE Text Blur", r.animator.blur]
        ]);
        var sel = addSelector(L, idx, "ADBE Text Expressible Selector");
        try { sel().property("ADBE Text Range Type2").setValue(BASED_ON.words); } catch (e) { warn("bounce based-on: " + e); }
        sel().property("ADBE Text Expressible Amount").expression = r.expressionSelector;
    }
    function revealFadeHighlight(L, comp, at, frames) {
        var r = P().text.reveals.fadeHighlight, f = num(frames, r.fade.frames);
        var i1 = addAnimator(L, "Fade", [["ADBE Text Opacity", 0]]);
        var s1 = addSelector(L, i1);
        advanced(s1, "ADBE Text Range Type2", BASED_ON.words);
        try { s1().property("ADBE Text Range Advanced").property("ADBE Text Selector Smoothness").setValue(0); } catch (e) {}
        CS.animate(s1().property("ADBE Text Percent Start"), comp, at, at + f, 0, 100, { outLinear: true, inInfluence: r.fade.inInfluence });
        var accent = P().text.accentColor;
        var i2 = addAnimator(L, "Tint", [["ADBE Text Fill Color", [accent[0], accent[1], accent[2], 1]], ["ADBE Text Blur", r.tint.blur]]);
        var s2 = addSelector(L, i2);
        advanced(s2, "ADBE Text Range Type2", BASED_ON.words);
        try { s2().property("ADBE Text Range Advanced").property("ADBE Text Selector Smoothness").setValue(0); } catch (e2) {}
        CS.animate(s2().property("ADBE Text Percent Start"), comp, at + r.tint.delayFrames, at + r.tint.delayFrames + f, 0, 100,
            { outLinear: true, inInfluence: r.fade.inInfluence });
    }
    function revealCharFade(L, comp, at, frames) {
        var r = P().text.reveals.charFade;
        var idx = addAnimator(L, "Fade", [["ADBE Text Opacity", 0]]);
        var sel = addSelector(L, idx);
        advanced(sel, "ADBE Text Range Type2", BASED_ON.characters);
        CS.animate(sel().property("ADBE Text Percent Start"), comp, at, at + num(frames, r.frames), 0, 100,
            { outLinear: true, inInfluence: r.inInfluence });
    }
    function accentRanges(text, words) {
        var out = [], lower = text.toLowerCase();
        for (var i = 0; i < words.length; i++) {
            var w = String(words[i]); if (!w) continue;
            var from = 0, found = false, k;
            while ((k = lower.indexOf(w.toLowerCase(), from)) >= 0) { out.push([k, k + w.length]); from = k + w.length; found = true; }
            if (!found) warn("accent word not found in text: '" + w + "'");
        }
        return out;
    }

    // o: {text, at, end, x, y, z, style, frames, accent:[...], size, scale, color, leading, align, exit:'fade'|'cut', parent, name}
    CS.addText = function (comp, o) {
        comp = CS.comp(comp);
        if (!o || !o.text) throw new Error("addText needs text");
        var T = P().text;
        var L = comp.layers.addText(String(o.text));
        if (o.name) L.name = o.name;
        var src = textProps(L).property("ADBE Text Document");
        var td = src.value;
        try { td.resetCharStyle(); } catch (e0) {}
        try { td.resetParagraphStyle(); } catch (e1) {}
        td.font = o.font || T.font;
        td.fontSize = num(o.size, T.fontSize);
        td.applyFill = true;
        var col = o.color || T.color;
        td.fillColor = [col[0], col[1], col[2]];
        td.applyStroke = false;
        td.tracking = num(o.tracking, T.tracking);
        var just = { left: ParagraphJustification.LEFT_JUSTIFY, right: ParagraphJustification.RIGHT_JUSTIFY, center: ParagraphJustification.CENTER_JUSTIFY };
        td.justification = just[o.align || T.justification] || ParagraphJustification.CENTER_JUSTIFY;
        try { td.autoLeading = false; td.leading = num(o.leading, T.leading); } catch (e2) {}
        src.setValue(td);
        try {
            var applied = textProps(L).property("ADBE Text Document").value.font;
            if (applied !== (o.font || T.font)) warn("Font '" + (o.font || T.font) + "' not found – AE used '" + applied + "'. Install " + (T.fontFamily || "the profile font") + ".");
        } catch (e3) {}
        L.threeDLayer = true;
        L.motionBlur = true;
        var r = L.sourceRectAtTime(0, false), al = o.align || T.justification;
        var ax = al === "left" ? r.left : (al === "right" ? r.left + r.width : r.left + r.width / 2);
        tr(L, "ADBE Anchor Point").setValue([ax, r.top + r.height / 2, 0]);
        var s = num(o.scale, T.layerScale);
        tr(L, "ADBE Scale").setValue([s, s, s]);
        if (o.parent) { L.parent = (typeof o.parent === "object") ? o.parent : CS.layer(comp, o.parent); tr(L, "ADBE Position").setValue([num(o.x, 0), num(o.y, 0), num(o.z, 0)]); }
        else tr(L, "ADBE Position").setValue([comp.width / 2 + num(o.x, 0), comp.height / 2 + num(o.y, 0), num(o.z, 0)]);

        var at = num(o.at, 0);
        var style = o.style || "blurRise";
        if (style === "blurRise") revealBlurRise(L, comp, at, o.frames);
        else if (style === "bounceWords") revealBounce(L, comp, at);
        else if (style === "fadeHighlight") revealFadeHighlight(L, comp, at, o.frames);
        else if (style === "charFade") revealCharFade(L, comp, at, o.frames);
        else if (style !== "none") throw new Error("Unknown text style '" + style + "' (blurRise, bounceWords, fadeHighlight, charFade, none)");

        if (o.accent && o.accent.length) {
            var ranges = accentRanges(String(o.text), o.accent), ac = o.accentColor || T.accentColor;
            for (var i = 0; i < ranges.length; i++) {
                var ai = addAnimator(L, "Accent " + (i + 1), [["ADBE Text Fill Color", [ac[0], ac[1], ac[2], 1]]]);
                var sel = addSelector(L, ai);
                advanced(sel, "ADBE Text Range Units", 2);
                advanced(sel, "ADBE Text Range Type2", BASED_ON.characters);
                try { sel().property("ADBE Text Index Start").setValue(ranges[i][0]); sel().property("ADBE Text Index End").setValue(ranges[i][1]); }
                catch (e4) { warn("accent range: " + e4); }
            }
        }
        var end = num(o.end, Math.round(comp.duration * comp.frameRate));
        CS.trim(L, comp, at, end);
        if (o.exit === "fade") {
            var ef = P().text.exit.frames;
            CS.animate(tr(L, "ADBE Opacity"), comp, end - ef, end, 100, 0, "linear");
        }
        return { layer: L.name, index: L.index, at: at, end: end, style: style, exit: o.exit === "fade" ? "fade" : null };
    };

    // ------------------------------------------------------------ footage / images
    CS.importFile = function (path) {
        var f = new File(path);
        if (!f.exists) throw new Error("File not found: " + path);
        for (var i = 1; i <= app.project.numItems; i++) {
            var it = app.project.item(i);
            if (it instanceof FootageItem && it.file && it.file.fsName === f.fsName) return it;
        }
        var item = app.project.importFile(new ImportOptions(f));
        item.parentFolder = CS.folder("Claude Assets");
        return item;
    };

    function addShadows(L) {
        var sh = P().images.shadow;
        for (var i = 0; i < sh.length; i++) {
            CS.addEffect(L, "ADBE Drop Shadow", "Drop Shadow" + (i ? " " + (i + 1) : ""), {
                "0001": sh[i].color, "0002": sh[i].opacity, "0003": sh[i].direction, "0004": sh[i].distance, "0005": sh[i].softness
            });
        }
    }
    function lensBlurIdx(L) {
        var i = findEffect(L, "ADBE Camera Lens Blur");
        return i || CS.addEffect(L, "ADBE Camera Lens Blur", "Camera Lens Blur", { "0001": 0 });
    }

    // enter / exit animations shared by images and any 3D layer
    CS.enter = function (comp, layer, type, at, frames) {
        comp = CS.comp(comp);
        var L = (typeof layer === "string" || typeof layer === "number") ? CS.layer(comp, layer) : layer;
        var spec = P().images.enter[type || "blurPop"];
        if (!spec) throw new Error("Unknown enter '" + type + "' (blurPop, blurPopSoft, logoTumble, videoPop)");
        var f = num(frames, spec.frames), es = spec.outLinear ? { outLinear: true, inInfluence: spec.inInfluence } : { outInfluence: spec.outInfluence, inInfluence: spec.inInfluence };
        if (spec.lensBlur) {
            var bi = lensBlurIdx(L);
            CS.animate(CS.effectProp(L, bi, "ADBE Camera Lens Blur", "0001"), comp, at, at + f, spec.lensBlur[0], spec.lensBlur[1], es);
        }
        if (spec.opacity) CS.animate(tr(L, "ADBE Opacity"), comp, at, at + f, spec.opacity[0], spec.opacity[1], es);
        if (spec.riseFromPx) {
            var pos = tr(L, "ADBE Position"), p1 = rawAt(pos, comp, at + f);
            CS.animate(pos, comp, at, at + f, vadd(p1, [0, spec.riseFromPx, 0]), p1, es);
        }
        if (spec.orientationFrom) CS.animate(tr(L, "ADBE Orientation"), comp, at, at + f, spec.orientationFrom, [0, 0, 0], es);
        if (spec.scaleFrom) {
            var sc = tr(L, "ADBE Scale"), s1 = rawAt(sc, comp, at + f);
            CS.animate(sc, comp, at, at + f, [s1[0] * spec.scaleFrom, s1[1] * spec.scaleFrom, s1[2] * spec.scaleFrom], s1, es);
        }
        if (spec.exposureFrom) {
            var ei = CS.addEffect(L, "ADBE Exposure2", "Exposure", {});
            CS.animate(CS.effectProp(L, ei, "ADBE Exposure2", "0003"), comp, at, at + f, spec.exposureFrom, 0, es);
        }
        return { layer: L.name, enter: type || "blurPop", from: at, to: at + f };
    };
    CS.exit = function (comp, layer, type, at, frames) {
        comp = CS.comp(comp);
        var L = (typeof layer === "string" || typeof layer === "number") ? CS.layer(comp, layer) : layer;
        var spec = P().images.exit[type || "blurOut"];
        if (!spec) throw new Error("Unknown exit '" + type + "' (blurOut)");
        var f = num(frames, spec.frames), es = { outInfluence: spec.outInfluence, inInfluence: spec.inInfluence, inLinear: true };
        var bi = lensBlurIdx(L);
        CS.animate(CS.effectProp(L, bi, "ADBE Camera Lens Blur", "0001"), comp, at, at + f, spec.lensBlur[0], spec.lensBlur[1], es);
        CS.animate(tr(L, "ADBE Opacity"), comp, at, at + f, spec.opacity[0], spec.opacity[1], es);
        if (spec.dropPx) {
            var pos = tr(L, "ADBE Position"), p0 = rawAt(pos, comp, at);
            CS.animate(pos, comp, at, at + f, p0, vadd(p0, [0, spec.dropPx, 0]), es);
        }
        return { layer: L.name, exit: type || "blurOut", from: at, to: at + f };
    };

    // o: {file, at, end, x, y, z, width | scale, enter, enterFrames, exit, exitAt, shadow, float, parent, name}
    CS.addImage = function (comp, o) {
        comp = CS.comp(comp);
        if (!o || !o.file) throw new Error("addImage needs file");
        var item = CS.importFile(o.file);
        var L = comp.layers.add(item);
        if (o.name) L.name = o.name;
        L.threeDLayer = true;
        L.motionBlur = true;
        var s = o.width ? (o.width / item.width) * 100 : num(o.scale, 100);
        tr(L, "ADBE Scale").setValue([s, s, s]);
        if (o.parent) { L.parent = (typeof o.parent === "object") ? o.parent : CS.layer(comp, o.parent); tr(L, "ADBE Position").setValue([num(o.x, 0), num(o.y, 0), num(o.z, 0)]); }
        else tr(L, "ADBE Position").setValue([comp.width / 2 + num(o.x, 0), comp.height / 2 + num(o.y, 0), num(o.z, 0)]);
        if (o.shadow !== false && !(item.mainSource && !item.hasVideo)) addShadows(L);
        var at = num(o.at, 0), end = num(o.end, Math.round(comp.duration * comp.frameRate));
        if (o.enter !== "none") CS.enter(comp, L, o.enter || "blurPop", at, o.enterFrames);
        if (o.exit && o.exit !== "none") {
            var xf = num(o.exitFrames, P().images.exit.blurOut.frames);
            CS.exit(comp, L, o.exit === true ? "blurOut" : o.exit, num(o.exitAt, end - xf), xf);
        }
        if (o.float) tr(L, "ADBE Position").expression = P().images.float;
        CS.trim(L, comp, at, end);
        return { layer: L.name, index: L.index, at: at, end: end, scale: Math.round(s * 100) / 100, source: item.name,
                 exit: (o.exit && o.exit !== "none") ? (o.exit === true ? "blurOut" : o.exit) : null };
    };

    // blur transition on a set of layers: mode 'out' (0->40, fade out) or 'in' (40->0, fade in)
    CS.blurTransition = function (comp, o) {
        comp = CS.comp(comp);
        var names = o.layers || [], res = [];
        for (var i = 0; i < names.length; i++) {
            var L = CS.layer(comp, names[i]);
            if (o.mode === "in") res.push(CS.enter(comp, L, "blurPopSoft", o.at, o.frames));
            else res.push(CS.exit(comp, L, "blurOut", o.at, o.frames));
        }
        return res;
    };

    // ------------------------------------------------------------ main comp
    CS.ensureMain = function (name, frames) {
        var c = P().comp, m = CS.findComp(name || "Main");
        if (m) {
            var need = frames / c.fps;
            if (m.duration < need) m.duration = need;
            return m;
        }
        m = app.project.items.addComp(name || "Main", c.width, c.height, c.pixelAspect, frames / c.fps, c.fps);
        m.motionBlur = true; m.shutterAngle = c.shutterAngle; m.bgColor = c.bgColor;
        return m;
    };
    CS.placeScene = function (main, scene, at) {
        main = CS.comp(main); scene = CS.comp(scene);
        for (var i = main.numLayers; i >= 1; i--) { var ex = main.layer(i); if (ex.source && (ex.source.id === scene.id || (ex.source instanceof CompItem && ex.source.name === scene.name))) ex.remove(); }
        var L = main.layers.add(scene);
        L.startTime = sec(main, at);
        var end = at + Math.round(scene.duration * scene.frameRate);
        CS.trim(L, main, at, end);
        return { layer: L.name, at: at, end: end };
    };

    // ------------------------------------------------------------ shape-built UI (minimal SaaS)
    // All UI pieces are 3D layers. A "group" = one parent shape layer + children parented to it.
    // x/y are offsets from comp centre (or from the parent when parent is given), in px.
    function ui() { return P().ui; }
    function rgb4(c) { return c.length === 3 ? [c[0], c[1], c[2], 1] : c; }
    CS.color = function (c) {
        if (isArr(c)) return rgb4(c);
        var u = ui(), t = P().text;
        if (c === "accent") return rgb4(t.accentColor);
        if (c === "text") return rgb4(t.color);
        if (u.colors[c]) return rgb4(u.colors[c]);
        throw new Error("Unknown colour '" + c + "' (accent, text, " + (function () { var a = []; for (var k in u.colors) a.push(k); return a.join(", "); })() + ")");
    };
    function shapeLayer(comp, name) {
        var L = comp.layers.addShape();
        L.name = name || "UI";
        L.threeDLayer = true;
        L.motionBlur = true;
        return L;
    }
    function place(comp, L, o) {
        if (o.parent) {
            L.parent = (typeof o.parent === "string") ? CS.layer(comp, o.parent) : o.parent;
            tr(L, "ADBE Position").setValue([num(o.x, 0), num(o.y, 0), num(o.z, 0)]);
        } else tr(L, "ADBE Position").setValue([comp.width / 2 + num(o.x, 0), comp.height / 2 + num(o.y, 0), num(o.z, 0)]);
    }
    // add one vector group: kind 'rect' | 'ellipse' | 'path'; returns group index
    function vgroup(L, name, kind, geo, fill, stroke, strokeW, offset) {
        var root = function () { return L.property("ADBE Root Vectors Group"); };
        root().addProperty("ADBE Vector Group");
        var gi = root().numProperties;
        var g = function () { return root().property(gi); };
        var c = function () { return g().property("ADBE Vectors Group"); };
        g().name = name;
        if (kind === "rect") {
            c().addProperty("ADBE Vector Shape - Rect");
            c().property(1).property("ADBE Vector Rect Size").setValue([geo.w, geo.h]);
            c().property(1).property("ADBE Vector Rect Roundness").setValue(num(geo.r, 0));
        } else if (kind === "ellipse") {
            c().addProperty("ADBE Vector Shape - Ellipse");
            c().property(1).property("ADBE Vector Ellipse Size").setValue([geo.w, geo.h]);
        } else {
            c().addProperty("ADBE Vector Shape - Group");
            var s = new Shape(); s.vertices = geo.pts; s.closed = !!geo.closed;
            if (geo.inT) s.inTangents = geo.inT;
            if (geo.outT) s.outTangents = geo.outT;
            c().property(1).property("ADBE Vector Shape").setValue(s);
        }
        if (stroke) {
            c().addProperty("ADBE Vector Graphic - Stroke");
            var st = c().property(c().numProperties);
            st.property("ADBE Vector Stroke Color").setValue(rgb4(stroke));
            c().property(c().numProperties).property("ADBE Vector Stroke Width").setValue(num(strokeW, 1));
            try { c().property(c().numProperties).property("ADBE Vector Stroke Line Cap").setValue(2); } catch (e) {}
            try { c().property(c().numProperties).property("ADBE Vector Stroke Line Join").setValue(2); } catch (e1) {}
        }
        if (fill) {
            c().addProperty("ADBE Vector Graphic - Fill");
            c().property(c().numProperties).property("ADBE Vector Fill Color").setValue(rgb4(fill));
        }
        if (offset) g().property("ADBE Vector Transform Group").property("ADBE Vector Position").setValue(offset);
        return gi;
    }
    CS.vgroup = vgroup;
    function softShadow(L, strength) {
        var s = ui().shadow, k = num(strength, 1);
        CS.addEffect(L, "ADBE Drop Shadow", "Drop Shadow", {
            "0001": s.color, "0002": s.opacity * k, "0003": 180, "0004": s.distance, "0005": s.softness });
    }
    // simple line icons drawn inside a shape layer, centred at offset, size ~ s px
    CS.icon = function (L, name, s, col, offset) {
        var rootG = function () { return L.property("ADBE Root Vectors Group"); };
        var n0 = rootG().numProperties;
        CS._drawIcon(L, name, s, col, offset);
        var n1 = rootG().numProperties;
        for (var j = 0; j < n1 - n0; j++) { try { rootG().property(n0 + 1 + j).moveTo(1 + j); } catch (e) { warn("icon order: " + e); } }
    };
    CS._drawIcon = function (L, name, s, col, offset) {
        s = num(s, 40); col = CS.color(col || "accent"); var h = s / 2, w = Math.max(2, s / 14);
        offset = offset || [0, 0];
        var o = function (p) { return [p[0] + offset[0], p[1] + offset[1]]; };
        if (name === "check") vgroup(L, "icon check", "path", { pts: [o([-h * 0.5, 0]), o([-h * 0.12, h * 0.38]), o([h * 0.55, -h * 0.4])] }, null, col, w * 1.3);
        else if (name === "cross") { vgroup(L, "icon x1", "path", { pts: [o([-h * 0.4, -h * 0.4]), o([h * 0.4, h * 0.4])] }, null, col, w * 1.3);
                                      vgroup(L, "icon x2", "path", { pts: [o([h * 0.4, -h * 0.4]), o([-h * 0.4, h * 0.4])] }, null, col, w * 1.3); }
        else if (name === "doc") { vgroup(L, "icon doc", "rect", { w: s * 0.7, h: s * 0.9, r: s * 0.12 }, null, col, w, offset);
                                    for (var i = 0; i < 3; i++) vgroup(L, "icon line" + i, "path", { pts: [o([-h * 0.36, -h * 0.35 + i * h * 0.35]), o([h * 0.36 - (i === 2 ? h * 0.25 : 0), -h * 0.35 + i * h * 0.35])] }, null, col, w); }
        else if (name === "person") { vgroup(L, "icon head", "ellipse", { w: s * 0.42, h: s * 0.42 }, null, col, w, [offset[0], offset[1] - h * 0.32]);
                                       vgroup(L, "icon body", "path", { pts: [o([-h * 0.62, h * 0.85]), o([-h * 0.45, h * 0.3]), o([h * 0.45, h * 0.3]), o([h * 0.62, h * 0.85])] }, null, col, w); }
        else if (name === "people") { CS._drawIcon(L, "person", s * 0.85, col, [offset[0] - s * 0.2, offset[1]]); CS._drawIcon(L, "person", s * 0.7, col, [offset[0] + s * 0.32, offset[1] + s * 0.06]); }
        else if (name === "code") { vgroup(L, "icon lt", "path", { pts: [o([-h * 0.25, -h * 0.45]), o([-h * 0.7, 0]), o([-h * 0.25, h * 0.45])] }, null, col, w * 1.2);
                                     vgroup(L, "icon gt", "path", { pts: [o([h * 0.25, -h * 0.45]), o([h * 0.7, 0]), o([h * 0.25, h * 0.45])] }, null, col, w * 1.2); }
        else if (name === "spark") vgroup(L, "icon spark", "path", { closed: true, pts: [o([0, -h]), o([h * 0.22, -h * 0.22]), o([h, 0]), o([h * 0.22, h * 0.22]), o([0, h]), o([-h * 0.22, h * 0.22]), o([-h, 0]), o([-h * 0.22, -h * 0.22])] }, col, null);
        else if (name === "phone") {
            // filled handset glyph, designed on a 24-unit grid centred at (12,12)
            var PV = [[3.5,4.5],[8,3],[9.5,7.5],[7.5,9.5],[14.5,16.5],[16.5,14.5],[21,16],[19.5,20.5]],
                PI = [[-1,8.5],[-1.6,0.1],[-0.4,-1.4],[1,-1],[-3.6,-0.4],[-1,1],[-1.4,-0.4],[1,-1.4]],
                PO = [[1.6,-0.9],[0.9,1.1],[0,1.4],[0.4,3.6],[1,-1],[1.4,0.1],[0.4,1.6],[-9,1]],
                k = s / 24 * 1.1, pv = [], pi = [], po = [];
            for (var q = 0; q < PV.length; q++) {
                pv.push(o([(PV[q][0] - 12) * k, (PV[q][1] - 12) * k]));
                pi.push([PI[q][0] * k, PI[q][1] * k]); po.push([PO[q][0] * k, PO[q][1] * k]);
            }
            vgroup(L, "icon phone", "path", { pts: pv, inT: pi, outT: po, closed: true }, col, null);
        }
        else if (name === "dot") vgroup(L, "icon dot", "ellipse", { w: s * 0.4, h: s * 0.4 }, col, null, 0, offset);
        else throw new Error("Unknown icon '" + name + "' (check, cross, doc, person, people, code, spark, phone, dot)");
    };

    // group entrance: parent rises + blurs in, children fade + unblur on the same timing
    CS.enterGroup = function (comp, parent, children, type, at, frames) {
        if (type === "none") return;
        CS.enter(comp, parent, type || "blurPop", at, frames);
        var spec = P().images.enter[type || "blurPop"], f = num(frames, spec.frames);
        var es = spec.outLinear ? { outLinear: true, inInfluence: spec.inInfluence } : { outInfluence: spec.outInfluence, inInfluence: spec.inInfluence };
        for (var i = 0; i < children.length; i++) {
            var c = children[i];
            CS.animate(tr(c, "ADBE Opacity"), comp, at, at + f, 0, 100, es);
        }
    };
    function uiText(comp, o, parent) {
        var r = CS.addText(comp, {
            text: o.text, parent: parent, x: num(o.x, 0), y: num(o.y, 0), z: -1, size: num(o.size, 34), scale: 100,
            color: o.color ? CS.color(o.color) : (o.muted ? CS.color("muted") : CS.color("text")).slice(0, 3),
            align: o.align || "center", style: "none", at: o.at, end: o.end, accent: o.accent, tracking: o.tracking, leading: o.leading
        });
        return CS.layer(comp, r.index);
    }

    // card: rounded white card, optional icon, title, subtitle
    // o: {name, x,y,z, w,h, title, subtitle, icon, iconColor, at, end, enter, fill, border, parent}
    CS.addCard = function (comp, o) {
        comp = CS.comp(comp); var u = ui();
        var w = num(o.w, 420), h = num(o.h, 200), at = num(o.at, 0), end = num(o.end, Math.round(comp.duration * comp.frameRate));
        var L = shapeLayer(comp, o.name || (o.ghost ? "Slot" : ("Card " + (o.title || ""))));
        if (o.ghost) {
            vgroup(L, "slot", "rect", { w: w, h: h, r: num(o.radius, u.radius) }, CS.color("accentSoft"), CS.color("border"), 1.5);
            tr(L, "ADBE Opacity").setValue(60);
        } else vgroup(L, "card", "rect", { w: w, h: h, r: num(o.radius, u.radius) }, CS.color(o.fill || "card"), CS.color(o.border || "border"), 1.5);
        if (o.icon) CS.icon(L, o.icon, num(o.iconSize, 54), o.iconColor || "text", [0, o.title ? -h * 0.2 : 0]);
        if (o.shadow !== false && !o.ghost) softShadow(L);
        if (o.title && !o.titleSize) o.titleSize = Math.min(40, Math.floor((w - 56) / (String(o.title).length * 0.53)));
        if (o.subtitle && !o.subtitleSize) o.subtitleSize = Math.min(28, Math.floor((w - 56) / (String(o.subtitle).length * 0.5)));
        place(comp, L, o);
        var kids = [];
        var ty = o.icon ? h * 0.12 : (o.subtitle ? -h * 0.08 : 0);
        if (o.title) kids.push(uiText(comp, { text: o.title, y: ty, size: num(o.titleSize, 40), at: at, end: end, accent: o.accent }, L));
        if (o.subtitle) kids.push(uiText(comp, { text: o.subtitle, y: ty + num(o.titleSize, 40) * 0.95, size: num(o.subtitleSize, 28), muted: true, at: at, end: end }, L));
        CS.trim(L, comp, at, end);
        if (o.ghost) { CS.animate(tr(L, "ADBE Opacity"), comp, at, at + 12, 0, 60, "pop"); }
        else if (o.enter !== "none") CS.enterGroup(comp, L, kids, o.enter || "blurPopSoft", at, o.enterFrames);
        if (o.float) tr(L, "ADBE Position").expression = P().images.float;
        return { layer: L.name, index: L.index, at: at, end: end, children: kids.length };
    };

    // chip / pill: o: {text, x,y, color: 'accent'|'warn'|'good'|'neutral', at, end, size, parent}
    CS.addChip = function (comp, o) {
        comp = CS.comp(comp); var u = ui();
        var tone = u.tones[o.tone || "accent"]; if (!tone) throw new Error("Unknown chip tone '" + o.tone + "' (" + (function () { var a = []; for (var k in u.tones) a.push(k); return a.join(", "); })() + ")");
        var size = num(o.size, 28), w = num(o.w, String(o.text).length * size * 0.56 + size * 1.6), h = size * 1.9;
        var at = num(o.at, 0), end = num(o.end, Math.round(comp.duration * comp.frameRate));
        var L = shapeLayer(comp, o.name || ("Chip " + o.text));
        vgroup(L, "chip", "rect", { w: w, h: h, r: h / 2 }, CS.color(tone.bg), null);
        if (o.icon) CS.icon(L, o.icon, size * 0.9, tone.fg, [-w / 2 + size * 0.9, 0]);
        place(comp, L, o);
        var t = uiText(comp, { text: o.text, size: size, color: tone.fg, x: o.icon ? size * 0.45 : 0, at: at, end: end }, L);
        CS.trim(L, comp, at, end);
        if (o.enter !== "none") CS.enterGroup(comp, L, [t], o.enter || "blurPopSoft", at, o.enterFrames || (o.enter === "rowIn" ? undefined : 15));
        return { layer: L.name, index: L.index, at: at, w: Math.round(w) };
    };

    // stat card: big value + label. o: {value, label, x,y, w,h, at, end, tone}
    CS.addStat = function (comp, o) {
        comp = CS.comp(comp); var u = ui();
        var w = num(o.w, 380), h = num(o.h, 230), at = num(o.at, 0), end = num(o.end, Math.round(comp.duration * comp.frameRate));
        var L = shapeLayer(comp, o.name || ("Stat " + o.value));
        vgroup(L, "card", "rect", { w: w, h: h, r: u.radius }, CS.color("card"), CS.color("border"), 1.5);
        softShadow(L);
        place(comp, L, o);
        var v = uiText(comp, { text: String(o.value), y: -h * 0.12, size: num(o.valueSize, 84), color: o.tone ? u.tones[o.tone].fg : "accent", at: at, end: end }, L);
        var l = uiText(comp, { text: o.label, y: h * 0.28, size: 28, muted: true, at: at, end: end }, L);
        CS.trim(L, comp, at, end);
        CS.enterGroup(comp, L, [v, l], o.enter || "blurPop", at, o.enterFrames);
        return { layer: L.name, index: L.index, at: at };
    };

    // checklist card: title + rows that tick in on their own frames
    // o: {title, items:[{text, at}], x,y, w, at, end, rowH}
    CS.addChecklist = function (comp, o) {
        comp = CS.comp(comp); var u = ui();
        var items = o.items || [], rowH = num(o.rowH, 92), w = num(o.w, 760);
        for (var wi = 0; wi < items.length; wi++) w = Math.max(w, String(items[wi].text).length * 36 * 0.5 + 200);
        var h = 110 + items.length * rowH, at = num(o.at, 0), end = num(o.end, Math.round(comp.duration * comp.frameRate));
        var L = shapeLayer(comp, o.name || ("Checklist " + (o.title || "")));
        vgroup(L, "card", "rect", { w: w, h: h, r: u.radius }, CS.color("card"), CS.color("border"), 1.5);
        softShadow(L);
        place(comp, L, o);
        var kids = [];
        var top = -h / 2;
        if (o.title) kids.push(uiText(comp, { text: o.title, x: -w / 2 + 48, y: top + 62, size: 30, muted: true, align: "left", at: at, end: end }, L));
        CS.trim(L, comp, at, end);
        CS.enterGroup(comp, L, kids, o.enter || "blurPopSoft", at, o.enterFrames);
        var made = [];
        for (var i = 0; i < items.length; i++) {
            var it = items[i], ia = num(it.at, at + 10 + i * 12), y = top + 110 + rowH * i + rowH / 2 - 10;
            var R = shapeLayer(comp, "Row " + it.text);
            vgroup(R, "tick bg", "ellipse", { w: 46, h: 46 }, CS.color(it.tone ? u.tones[it.tone].bg : "accentSoft"), null);
            CS.icon(R, it.icon || "check", 34, it.tone ? u.tones[it.tone].fg : "accent");
            R.parent = L;
            tr(R, "ADBE Position").setValue([-w / 2 + 70, y, -1]);
            var t = uiText(comp, { text: it.text, x: 46, y: 0, size: 36, align: "left", at: ia, end: end }, R);
            CS.trim(R, comp, ia, end);
            CS.enterGroup(comp, R, [t], "rowIn", ia);
            made.push(R.name);
        }
        return { layer: L.name, index: L.index, rows: made };
    };

    // connector line from a to b (offsets from centre), drawn on with trim paths; dashed optional
    // o: {from:[x,y], to:[x,y], at, frames, dashed, color, width, dot, parent}
    CS.addConnector = function (comp, o) {
        comp = CS.comp(comp);
        var at = num(o.at, 0), f = num(o.frames, 20), end = num(o.end, Math.round(comp.duration * comp.frameRate));
        var L = shapeLayer(comp, o.name || "Connector");
        var a = o.from, b = o.to;
        var gi = vgroup(L, "line", "path", { pts: [[a[0], a[1]], [b[0], b[1]]] }, null, CS.color(o.color || "line"), num(o.width, 4));
        if (o.dashed) {
            try {
                var st = L.property("ADBE Root Vectors Group").property(gi).property("ADBE Vectors Group").property(2);
                st.property("ADBE Vector Stroke Dashes").addProperty("ADBE Vector Stroke Dash 1");
                L.property("ADBE Root Vectors Group").property(gi).property("ADBE Vectors Group").property(2).property("ADBE Vector Stroke Dashes").property(1).setValue(num(o.dash, 14));
            } catch (e) { warn("dash: " + e); }
        }
        L.property("ADBE Root Vectors Group").addProperty("ADBE Vector Filter - Trim");
        var trim = L.property("ADBE Root Vectors Group").property(L.property("ADBE Root Vectors Group").numProperties);
        CS.animate(trim.property("ADBE Vector Trim End"), comp, at, at + f, 0, 100, { outInfluence: 60, inInfluence: 85 });
        if (o.dot !== false) {
            vgroup(L, "end dot", "ellipse", { w: 14, h: 14 }, CS.color(o.color || "line"), null, 0, [b[0], b[1]]);
        }
        tr(L, "ADBE Position").setValue([comp.width / 2, comp.height / 2, num(o.z, 0)]);
        tr(L, "ADBE Anchor Point").setValue([0, 0, 0]);
        CS.animate(tr(L, "ADBE Opacity"), comp, at, at + 6, 0, 100, "linear");
        CS.trim(L, comp, at, end);
        return { layer: L.name, index: L.index, at: at };
    };

    // horizontal stage track: numbered steps with a progress line that fills step by step
    // o: {steps:["Sign-in","Contact base","Sidebar views"], x,y, w, at, stepFrames, end, active}
    CS.addTrack = function (comp, o) {
        comp = CS.comp(comp); var u = ui();
        var steps = o.steps || [], w = num(o.w, 1100), n = steps.length, at = num(o.at, 0), sf = num(o.stepFrames, 24);
        var end = num(o.end, Math.round(comp.duration * comp.frameRate)), x0 = -w / 2, dx = n > 1 ? w / (n - 1) : 0;
        var base = shapeLayer(comp, o.name || "Track");
        vgroup(base, "rail", "path", { pts: [[x0, 0], [x0 + w, 0]] }, null, CS.color("rail"), 6);
        place(comp, base, o);
        CS.trim(base, comp, at, end);
        CS.animate(tr(base, "ADBE Opacity"), comp, at, at + 10, 0, 100, "linear");
        var prog = shapeLayer(comp, "Track progress");
        vgroup(prog, "fill", "path", { pts: [[x0, 0], [x0 + w, 0]] }, null, CS.color("accent"), 6);
        prog.property("ADBE Root Vectors Group").addProperty("ADBE Vector Filter - Trim");
        var trimEnd = function () { var r = prog.property("ADBE Root Vectors Group"); return r.property(r.numProperties).property("ADBE Vector Trim End"); };
        prog.parent = base; tr(prog, "ADBE Position").setValue([0, 0, -1]);
        trimEnd().setValue(0);
        CS.trim(prog, comp, at, end);
        var made = [];
        for (var i = 0; i < n; i++) {
            var sa = at + 6 + i * sf;
            var D = shapeLayer(comp, "Step " + (i + 1) + " " + steps[i]);
            vgroup(D, "dot", "ellipse", { w: 50, h: 50 }, CS.color("accent"), null);
            vgroup(D, "halo", "ellipse", { w: 74, h: 74 }, CS.color("accentSoft"), null);
            D.parent = base; tr(D, "ADBE Position").setValue([x0 + dx * i, 0, -2]);
            var num1 = uiText(comp, { text: String(i + 1), size: 26, color: [1, 1, 1], at: sa, end: end }, D);
            var lab = uiText(comp, { text: steps[i], y: 80, size: 36, at: sa, end: end }, D);
            CS.trim(D, comp, sa, end);
            CS.enterGroup(comp, D, [num1, lab], "blurPopSoft", sa, 15);
            if (i > 0) {
                var p0 = (i - 1) / (n - 1) * 100, p1 = i / (n - 1) * 100;
                CS.animate(trimEnd(), comp, sa - sf + 8, sa, p0, p1, { outInfluence: 60, inInfluence: 85 });
            }
            made.push(D.name);
        }
        return { layer: base.name, steps: made };
    };


    // panel: an app-window card with a title bar and rows that appear on their own frames
    // o: {title, x,y,z, w, rowH, at, end, dots, rows:[{label, value, at, tone, icon, highlight, size, muted}], footer:{text,tone,at}}
    CS.addPanel = function (comp, o) {
        comp = CS.comp(comp); var u = ui();
        var rows = o.rows || [], rowH = num(o.rowH, 72), w = num(o.w, 640), head = o.title ? 78 : 18;
        var footH = o.footer ? 96 : 0;
        var h = num(o.h, head + rows.length * rowH + 22 + footH), at = num(o.at, 0), end = num(o.end, Math.round(comp.duration * comp.frameRate));
        var L = shapeLayer(comp, o.name || ("Panel " + (o.title || "")));
        var top = -h / 2, left = -w / 2;
        if (o.title) vgroup(L, "header line", "path", { pts: [[left, top + head], [left + w, top + head]] }, null, CS.color("border"), 1.5);
        if (o.title && o.dots !== false) for (var d = 0; d < 3; d++) vgroup(L, "dot" + d, "ellipse", { w: 14, h: 14 }, CS.color("rail"), null, 0, [left + 34 + d * 24, top + head / 2]);
        vgroup(L, "panel", "rect", { w: w, h: h, r: num(o.radius, u.radius) }, CS.color(o.fill || "card"), CS.color(o.border || "border"), 1.5);
        if (o.shadow !== false) softShadow(L);
        place(comp, L, o);
        var kids = [];
        if (o.title) kids.push(uiText(comp, { text: o.title, x: left + (o.dots !== false ? 118 : 36), y: top + head / 2, size: 26, muted: true, align: "left", at: at, end: end }, L));
        CS.trim(L, comp, at, end);
        CS.enterGroup(comp, L, kids, o.enter || "blurPopSoft", at, o.enterFrames);
        var made = [];
        for (var i = 0; i < rows.length; i++) {
            var r = rows[i], ra = num(r.at, at + 8 + i * 6), y = top + head + 11 + rowH * i + rowH / 2;
            var R = shapeLayer(comp, "Row " + (r.label || r.value || i));
            var tone = r.tone ? u.tones[r.tone] : null;
            if (r.highlight) vgroup(R, "hl", "rect", { w: w - 24, h: rowH - 10, r: 14 }, CS.color(tone ? tone.bg : "accentSoft"), null);
            else if (i > 0) vgroup(R, "divider", "path", { pts: [[left + 30, -rowH / 2], [left + w - 30, -rowH / 2]] }, null, CS.color("rail"), 1.5);
            var lx = left + 36;
            if (r.icon) { CS.icon(R, r.icon, 30, tone ? tone.fg : "accent", [lx + 14, 0]); lx += 46; }
            R.parent = L;
            tr(R, "ADBE Position").setValue([0, y, -1]);
            var rk = [];
            if (r.label) rk.push(uiText(comp, { text: r.label, x: lx, y: 0, size: num(r.labelSize, 26), muted: true, align: "left", at: ra, end: end }, R));
            if (r.value) {
                var vleft = !r.label;
                rk.push(uiText(comp, { text: r.value, x: vleft ? lx : -left - 36, y: 0, size: num(r.size, vleft ? 32 : 28),
                    color: tone ? tone.fg : (r.muted ? "muted" : "text"), align: vleft ? "left" : "right", at: ra, end: end, accent: r.accent }, R));
            }
            CS.trim(R, comp, ra, end);
            CS.enterGroup(comp, R, rk, r.enter || "rowIn", ra);
            made.push(R.name);
        }
        if (o.footer) {
            var fa = num(o.footer.at, at + 20);
            var fc = CS.addChip(comp, { text: o.footer.text, tone: o.footer.tone || "accent", icon: o.footer.icon, size: num(o.footer.size, 28),
                parent: L, x: num(o.footer.x, 0), y: h / 2 - footH / 2 - 6, z: -1, at: fa, end: end, enter: "rowIn" });
            made.push(fc.layer);
        }
        if (o.float) tr(L, "ADBE Position").expression = P().images.float;
        return { layer: L.name, index: L.index, rows: made, h: h };
    };

    // eyebrow: small letter-spaced accent label above a headline
    CS.addEyebrow = function (comp, o) {
        var r = CS.addText(comp, { text: String(o.text).toUpperCase(), x: o.x, y: o.y, size: num(o.size, 30), scale: 100, tracking: 240,
            color: CS.color(o.color || "accent").slice(0, 3), style: o.style || "charFade", frames: 15, at: o.at, end: o.end });
        return r;
    };

    // slot-machine number roll: one digit column per character, staggered, overshoot, track-matted window.
    // o: {text:'63%', x,y,z, size(220), at, end, stagger(3), frames(22), spins(1), color, tracking, parent, name}
    CS.addSlotCounter = function (comp, o) {
        comp = CS.comp(comp);
        var T = P().text, text = String(o.text), size = num(o.size, 220), lead = Math.round(size * 1.05);
        var at = num(o.at, 0), end = num(o.end, Math.round(comp.duration * comp.frameRate));
        var st = num(o.stagger, 3), f = num(o.frames, 22), spins = num(o.spins, 1);
        var col = o.color ? CS.color(o.color) : CS.color("accent");
        function mk(str) {
            var L = comp.layers.addText(str);
            var src = L.property("ADBE Text Properties").property("ADBE Text Document"), td = src.value;
            try { td.resetCharStyle(); } catch (e0) {}
            try { td.resetParagraphStyle(); } catch (e1) {}
            td.font = o.font || T.font; td.fontSize = size; td.applyFill = true; td.fillColor = [col[0], col[1], col[2]];
            td.applyStroke = false; td.tracking = 0; td.justification = ParagraphJustification.CENTER_JUSTIFY;
            try { td.autoLeading = false; td.leading = lead; } catch (e2) {}
            src.setValue(td);
            L.threeDLayer = true; L.motionBlur = true;
            return L;
        }
        var N = comp.layers.addNull(); N.name = o.name || ("Slot " + text); N.threeDLayer = true; place(comp, N, o);
        tr(N, "ADBE Scale").setValue([100, 100, 100]);
        // measure: digits share the width of "0"; others measured on their own
        var ws = [], total = 0, gap = num(o.tracking, -2) / 100 * size, i, ch, m, r, glyph = null;
        for (i = 0; i < text.length; i++) {
            ch = text.charAt(i);
            m = mk(/[0-9]/.test(ch) ? "0" : ch); r = m.sourceRectAtTime(0, false);
            if (!glyph && /[0-9]/.test(ch)) glyph = { top: r.top, h: r.height };
            ws.push(r.width + size * 0.06); total += r.width + size * 0.06 + (i ? gap : 0); m.remove();
        }
        if (!glyph) glyph = { top: -size * 0.72, h: size * 0.72 };
        var cy = glyph.top + glyph.h / 2;
        var made = [], x = -total / 2, cols = [];
        for (i = 0; i < text.length; i++) {
            ch = text.charAt(i);
            var cx = x + ws[i] / 2, t0 = at + i * st, L;
            if (/[0-9]/.test(ch)) {
                var d = parseInt(ch, 10), lines = [];
                for (var k = 0; k <= spins * 10 + d; k++) lines.push(String(k % 10));
                L = mk(lines.join("\r")); L.name = "Slot col " + (i + 1) + " (" + ch + ")";
                L.parent = N;
                var y1 = -(lines.length - 1) * lead, pos = tr(L, "ADBE Position");
                CS.animate(pos, comp, t0, t0 + f, [cx, 0, 0], [cx, y1 - lead * 0.14, 0], { outInfluence: 30, inInfluence: 75 });
                CS.animate(pos, comp, t0 + f, t0 + f + 8, [cx, y1 - lead * 0.14, 0], [cx, y1, 0], "soft");
                cols.push(L);
            } else {
                L = mk(ch); L.name = "Slot sym " + (i + 1) + " (" + ch + ")"; L.parent = N;
                CS.animate(tr(L, "ADBE Position"), comp, t0, t0 + f, [cx, lead * 0.5, 0], [cx, 0, 0], { outInfluence: 30, inInfluence: 85 });
                cols.push(L);
            }
            CS.animate(tr(L, "ADBE Opacity"), comp, t0, t0 + 5, 0, 100, "linear");
            CS.trim(L, comp, at, end);
            made.push(L.name);
            x += ws[i] + gap;
        }
        // one matte window over every column (AE 2023+ setTrackMatte lets several layers share it)
        var M = shapeLayer(comp, "Slot window " + text);
        vgroup(M, "window", "rect", { w: total + size * 0.3, h: size * 1.0, r: 0 }, [1, 1, 1], null);
        M.parent = N; tr(M, "ADBE Position").setValue([0, cy, 0]);
        for (i = 0; i < cols.length; i++) {
            if (/^Slot col/.test(cols[i].name)) {
                try { cols[i].setTrackMatte(M, TrackMatteType.ALPHA); } catch (e3) { warn("setTrackMatte failed: " + e3); }
            }
        }
        M.enabled = false;
        CS.trim(M, comp, at, end); CS.trim(N, comp, at, end);
        return { layer: N.name, index: N.index, at: at, end: end, columns: made, width: Math.round(total) };
    };

    // dispatch for storyboard elements
    CS.addElement = function (comp, el) {
        var t = el.type;
        if (t === "slot") return CS.addSlotCounter(comp, el);
        if (t === "text") return CS.addText(comp, el);
        if (t === "image" || t === "video") { if (t === "video" && !el.enter) el.enter = "videoPop"; return CS.addImage(comp, el); }
        if (t === "card") return CS.addCard(comp, el);
        if (t === "chip") return CS.addChip(comp, el);
        if (t === "stat") return CS.addStat(comp, el);
        if (t === "checklist") return CS.addChecklist(comp, el);
        if (t === "connector") return CS.addConnector(comp, el);
        if (t === "track") return CS.addTrack(comp, el);
        if (t === "eyebrow") return CS.addEyebrow(comp, el);
        if (t === "panel") return CS.addPanel(comp, el);
        throw new Error("Unknown element type '" + t + "' (text, image, video, card, chip, stat, checklist, connector, track, eyebrow, panel)");
    };

    // ------------------------------------------------------------ storyboard builder
    /* spec = {
         main: "Main", palette: "blue", replace: true,
         scenes: [{ name: "S01", exit: "whip"|"blur"|"cut",
           shots: [{ name: "S01A", frames: 110,
                     enter: {dir:"down", dist:390, ease:"glide", frames:40},   // shared split-move from previous shot
                     moves: [{at: 60, dir:"in", ease:"punch"}],               // extra moves, frames relative to shot start
                     elements: [{type:"text", text:"…", at:0, y:0, style:"blurRise", accent:["CRA MCP"]},
                                {type:"image", file:"/abs/path.png", at:4, y:-150, width:900, enter:"blurPop", float:true}] }] }] } */
    var CYCLE = ["down", "out", "up", "in", "down", "right", "up", "left"];
    CS.buildStoryboard = function (spec) {
        if (!spec || !spec.scenes || !spec.scenes.length) throw new Error("storyboard needs scenes[]");
        var out = { main: null, scenes: [], warnings: [] }, cycle = 0, t = 0, i, j, k;
        var sceneComps = [], sceneAt = [];
        var th = spec.theme || {};
        if (th.accentColor) P().text.accentColor = th.accentColor;
        if (th.textColor) P().text.color = th.textColor;
        if (th.baseColor) { CS._baseColor = th.baseColor; P().comp.bgColor = th.baseColor; }
        if (th.palette && !spec.palette) spec.palette = th.palette;
        if (th.ui) for (var tk in th.ui) if (th.ui.hasOwnProperty(tk)) P().ui[tk] = th.ui[tk];
        for (i = 0; i < spec.scenes.length; i++) {
            var sc = spec.scenes[i];
            if (!sc.shots || !sc.shots.length) throw new Error("scene " + (sc.name || i) + " has no shots");
            var total = 0;
            for (j = 0; j < sc.shots.length; j++) total += num(sc.shots[j].frames, P().structure.shotLengthFrames.median);
            var comp = CS.createScene({ name: sc.name || ("S" + (i < 9 ? "0" : "") + (i + 1)), frames: total, palette: sc.palette || spec.palette, replace: spec.replace });
            var info = { comp: comp.name, frames: total, shots: [], cuts: [] }, f = 0, prev = null;
            for (j = 0; j < sc.shots.length; j++) {
                var sh = sc.shots[j], len = num(sh.frames, P().structure.shotLengthFrames.median);
                var nm = sh.name || (comp.name + String.fromCharCode(65 + j));
                CS.addShot(comp, { name: nm, start: f, end: f + len, overshoot: sh.overshoot, offset: sh.offset });
                var enter = sh.enter || { dir: CYCLE[cycle++ % CYCLE.length] };
                if (prev) {
                    info.cuts.push(CS.splitCut(comp, prev, nm, { at: f, dir: enter.dir, dist: enter.dist, by: enter.by, ease: enter.ease, frames: enter.frames }));
                } else if (i > 0 && spec.scenes[i - 1].exit === "whip") {
                    // second half of the move that left the previous scene
                    var wm = spec.scenes[i - 1]._whip;
                    if (wm) info.cuts.push(CS.splitCut(comp, null, nm, wm));
                } else if (sc.enterMove) {
                    // second half of a whip started by a scene built earlier
                    var em = {}; for (var ek in sc.enterMove) if (sc.enterMove.hasOwnProperty(ek)) em[ek] = sc.enterMove[ek];
                    em.at = 0;
                    info.cuts.push(CS.splitCut(comp, null, nm, em));
                }
                var moves = sh.moves || [];
                for (k = 0; k < moves.length; k++) {
                    var mv = {}; for (var key in moves[k]) if (moves[k].hasOwnProperty(key)) mv[key] = moves[k][key];
                    mv.at = f + num(moves[k].at, 0);
                    var dd = CS.moveDefaults(mv);
                    if (mv.at + dd.frames > f + len - 20) warn("shot " + nm + ": move at " + moves[k].at + " runs into the next cut");
                    CS.moveCamera(comp, nm, mv);
                }
                var els = sh.elements || [], made = [];
                for (k = 0; k < els.length; k++) {
                    var el = els[k], o2 = {};
                    for (var kk in el) if (el.hasOwnProperty(kk)) o2[kk] = el[kk];
                    o2.at = f + num(el.at, 0);
                    o2.end = f + len + (el.type === "image" ? 0 : 0);
                    if (el.exitAt !== undefined) o2.exitAt = f + el.exitAt;
                    // on a split-move cut the incoming shot's main elements are already there, carried by the camera
                    if ((prev || sc.enterMove || (i > 0 && spec.scenes[i - 1].exit === "whip")) && num(el.at, 0) <= 2 && el.enter === undefined &&
                        el.type !== "text" && el.type !== "eyebrow" && el.type !== "video") o2.enter = "none";
                    if (el.rows) { o2.rows = []; for (var ri = 0; ri < el.rows.length; ri++) { var rc = {}; for (var rk2 in el.rows[ri]) if (el.rows[ri].hasOwnProperty(rk2)) rc[rk2] = el.rows[ri][rk2]; if (rc.at !== undefined) rc.at = f + rc.at; o2.rows.push(rc); } }
                    if (el.footer) { o2.footer = {}; for (var fk in el.footer) if (el.footer.hasOwnProperty(fk)) o2.footer[fk] = el.footer[fk]; if (o2.footer.at !== undefined) o2.footer.at = f + o2.footer.at; }
                    if (el.items) { o2.items = []; for (var ii = 0; ii < el.items.length; ii++) { var itc = {}; for (var ik in el.items[ii]) if (el.items[ii].hasOwnProperty(ik)) itc[ik] = el.items[ii][ik]; if (itc.at !== undefined) itc.at = f + itc.at; o2.items.push(itc); } }
                    made.push(CS.addElement(comp, o2));
                }
                info.shots.push({ name: nm, start: f, end: f + len, enter: prev ? enter : null, elements: made });
                prev = nm; f += len;
            }
            // leaving the scene
            if (sc.exit === "whip" && (i < spec.scenes.length - 1 || sc.exitMove)) {
                var nextFirst = i < spec.scenes.length - 1 ? spec.scenes[i + 1].shots[0] : null;
                var wEnter = sc.exitMove || (nextFirst && nextFirst.enter) || { dir: CYCLE[cycle++ % CYCLE.length] };
                var wm2 = { at: total, dir: wEnter.dir, dist: wEnter.dist, by: wEnter.by, ease: wEnter.ease, frames: wEnter.frames };
                info.cuts.push(CS.splitCut(comp, prev, null, wm2));
                sc._whip = wm2; sc._whip.at = 0;
            } else if (sc.exit === "blur") {
                var names = [], lastShot = info.shots[info.shots.length - 1];
                for (k = 0; k < lastShot.elements.length; k++) if (!lastShot.elements[k].exit) names.push(lastShot.elements[k].layer);
                info.cuts.push({ blurOut: CS.blurTransition(comp, { layers: names, at: total - 15, frames: 15, mode: "out" }) });
            }
            sceneComps.push(comp);
            sceneAt.push(sc.at !== undefined ? sc.at : t);
            out.scenes.push(info);
            t = (sc.at !== undefined ? sc.at : t) + total;
        }
        var main = CS.ensureMain(spec.main || "Main", t);
        for (i = 0; i < sceneComps.length; i++) CS.placeScene(main, sceneComps[i], sceneAt[i]);
        out.main = { comp: main.name, frames: t };
        try { main.openInViewer(); } catch (e) {}
        return out;
    };

    // ------------------------------------------------------------ inspection & preview
    CS.status = function () {
        var comps = [];
        for (var i = 1; i <= app.project.numItems; i++) {
            var it = app.project.item(i);
            if (it instanceof CompItem) comps.push({ name: it.name, frames: Math.round(it.duration * it.frameRate), layers: it.numLayers, fps: it.frameRate });
        }
        var a = app.project.activeItem;
        return {
            aeVersion: app.version, project: app.project.file ? app.project.file.fsName : "(unsaved)",
            activeComp: (a instanceof CompItem) ? a.name : null, comps: comps
        };
    };
    CS.inspect = function (compName) {
        var comp = CS.comp(compName), layers = [];
        for (var i = 1; i <= comp.numLayers; i++) {
            var L = comp.layer(i), t = "av";
            if (L instanceof CameraLayer) t = "camera"; else if (L instanceof TextLayer) t = "text";
            else if (L instanceof ShapeLayer) t = "shape"; else if (L.nullLayer) t = "null";
            else if (L.source instanceof CompItem) t = "precomp";
            var o = { index: i, name: L.name, type: t, inFrame: Math.round(L.inPoint * comp.frameRate), outFrame: Math.round(L.outPoint * comp.frameRate) };
            if (L.parent) o.parent = L.parent.name;
            try { o.threeD = L.threeDLayer; } catch (e) {}
            if (t === "text") { try { o.text = L.property("ADBE Text Properties").property("ADBE Text Document").value.text; } catch (e2) {} }
            try { var p = L.property("ADBE Transform Group").property("ADBE Position"); o.position = p.value; o.positionKeys = p.numKeys; } catch (e3) {}
            layers.push(o);
        }
        return { comp: comp.name, frames: Math.round(comp.duration * comp.frameRate), fps: comp.frameRate, layers: layers };
    };

    // render one frame to PNG. Tries comp.saveFrameToPng, falls back to the render queue.
    CS.renderFrame = function (compName, frame, outPath) {
        var comp = CS.comp(compName), t = sec(comp, num(frame, 0)), f = new File(outPath);
        if (f.exists) f.remove();
        try {
            if (typeof comp.saveFrameToPng === "function" || comp.saveFrameToPng) {
                comp.saveFrameToPng(t, f);
                return { method: "saveFrameToPng", path: f.fsName };
            }
        } catch (e) { warn("saveFrameToPng failed (" + e + "), using render queue"); }
        var rq = app.project.renderQueue, disabled = [], i;
        for (i = 1; i <= rq.numItems; i++) {
            var q = rq.item(i);
            if (q.status === RQItemStatus.QUEUED) { q.render = false; disabled.push(i); }
        }
        var item = rq.items.add(comp);
        item.timeSpanStart = t;
        item.timeSpanDuration = 1 / comp.frameRate;
        var om = item.outputModule(1), tpl = null, tpls = om.templates;
        for (i = 0; i < tpls.length; i++) if (/png/i.test(tpls[i])) { tpl = tpls[i]; break; }
        if (!tpl) { item.remove(); throw new Error("No PNG output module template found"); }
        om.applyTemplate(tpl);
        var dir = f.parent, base = f.name.replace(/\.png$/i, "");
        om.file = new File(dir.fsName + "/" + base + "_[#####].png");
        try { rq.render(); } finally {
            try { item.remove(); } catch (e2) {}
            for (i = 0; i < disabled.length; i++) { try { rq.item(disabled[i]).render = true; } catch (e3) {} }
        }
        var files = dir.getFiles(base + "_*.png");
        if (!files.length) throw new Error("Render queue produced no file");
        files[0].rename(f.name);
        return { method: "renderQueue", path: f.fsName };
    };

    // ------------------------------------------------------------ job runner (used by the MCP bridge)
    CS.__run = function (fn, resultPath, label) {
        CS._warnings = [];
        var res, f = new File(resultPath), grouped = (label !== "undo");
        if (grouped) app.beginUndoGroup("Claude: " + (label || "job"));
        try {
            var r = fn();
            res = "{\"ok\":true,\"result\":" + CS.stringify(r === undefined ? null : r) + ",\"warnings\":" + CS.stringify(CS._warnings) + "}";
        } catch (e) {
            res = "{\"ok\":false,\"error\":" + CS.stringify(String(e && e.message ? e.message : e)) +
                  ",\"line\":" + CS.stringify(e && e.line ? e.line : null) + ",\"warnings\":" + CS.stringify(CS._warnings) + "}";
        } finally {
            if (grouped) app.endUndoGroup();
        }
        f.encoding = "UTF-8";
        f.open("w"); f.write(res); f.close();
        return res;
    };

}(CS));
