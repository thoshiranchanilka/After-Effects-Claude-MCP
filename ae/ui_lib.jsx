// Small 2D UI builder (shape layers + text) for flat SaaS boards. ES3. Set UI.C = comp before building.
var UI = { C: null, FPS: 30, FONT: "Inter-Regular" }; // set UI.FONT to your profile font
UI.hex = function (h) { return [parseInt(h.substr(1, 2), 16) / 255, parseInt(h.substr(3, 2), 16) / 255, parseInt(h.substr(5, 2), 16) / 255]; };
UI.root = function (L) { return L.property("ADBE Root Vectors Group"); };
UI.last = function (L) { var r = UI.root(L); return r.property(r.numProperties); };
UI.fill = function (L, col) { UI.root(L).addProperty("ADBE Vector Graphic - Fill"); UI.last(L).property("ADBE Vector Fill Color").setValue(UI.hex(col)); };
UI.stroke = function (L, col, w, cap) {
    UI.root(L).addProperty("ADBE Vector Graphic - Stroke");
    var s = UI.last(L); s.property("ADBE Vector Stroke Color").setValue(UI.hex(col)); s.property("ADBE Vector Stroke Width").setValue(w || 2);
    if (cap) { try { s.property("ADBE Vector Stroke Line Cap").setValue(2); s.property("ADBE Vector Stroke Line Join").setValue(2); } catch (e) {} }
    return s;
};
UI.layer = function (name, x, y) { var L = UI.C.layers.addShape(); L.name = name; L.property("ADBE Transform Group").property("ADBE Position").setValue([x, y]); return L; };
UI.rect = function (name, cx, cy, w, h, r, fill, stroke, sw) {
    var L = UI.layer(name, cx, cy);
    UI.root(L).addProperty("ADBE Vector Shape - Rect");
    UI.root(L).property(1).property("ADBE Vector Rect Size").setValue([w, h]);
    UI.root(L).property(1).property("ADBE Vector Rect Roundness").setValue(r || 0);
    if (stroke) UI.stroke(L, stroke, sw);
    if (fill) UI.fill(L, fill);
    return L;
};
UI.circle = function (name, cx, cy, d, fill, stroke, sw) {
    var L = UI.layer(name, cx, cy);
    UI.root(L).addProperty("ADBE Vector Shape - Ellipse");
    UI.root(L).property(1).property("ADBE Vector Ellipse Size").setValue([d, d]);
    if (stroke) UI.stroke(L, stroke, sw);
    if (fill) UI.fill(L, fill);
    return L;
};
UI.path = function (name, x, y, pts, closed, inT, outT) {
    var L = UI.layer(name, x, y);
    UI.root(L).addProperty("ADBE Vector Shape - Group");
    var s = new Shape(); s.vertices = pts; s.closed = !!closed; if (inT) s.inTangents = inT; if (outT) s.outTangents = outT;
    UI.root(L).property(1).property("ADBE Vector Shape").setValue(s);
    return L;
};
UI.trim = function (L) { UI.root(L).addProperty("ADBE Vector Filter - Trim"); return UI.last(L).property("ADBE Vector Trim End"); };
UI.dashes = function (strokeOwner, dash, gap) {
    var s = UI.root(strokeOwner); var st = null;
    for (var i = 1; i <= s.numProperties; i++) if (s.property(i).matchName === "ADBE Vector Graphic - Stroke") st = i;
    s.property(st).property("ADBE Vector Stroke Dashes").addProperty("ADBE Vector Stroke Dash 1");
    s = UI.root(strokeOwner);
    s.property(st).property("ADBE Vector Stroke Dashes").addProperty("ADBE Vector Stroke Gap 1");
    s = UI.root(strokeOwner);
    s.property(st).property("ADBE Vector Stroke Dashes").property("ADBE Vector Stroke Dash 1").setValue(dash);
    s.property(st).property("ADBE Vector Stroke Dashes").property("ADBE Vector Stroke Gap 1").setValue(gap);
};
UI.text = function (str, x, y, size, col, font, just) {
    var L = UI.C.layers.addText(str);
    var p = L.property("ADBE Text Properties").property("ADBE Text Document"), td = p.value;
    td.resetCharStyle(); td.resetParagraphStyle();
    td.font = font || UI.FONT; td.fontSize = size; td.applyFill = true; td.fillColor = UI.hex(col); td.applyStroke = false; td.tracking = 0;
    td.justification = just === "left" ? ParagraphJustification.LEFT_JUSTIFY : (just === "right" ? ParagraphJustification.RIGHT_JUSTIFY : ParagraphJustification.CENTER_JUSTIFY);
    p.setValue(td);
    L.property("ADBE Transform Group").property("ADBE Position").setValue([x, y]);
    return L;
};
UI.accent = function (L, words, col) {
    var p = L.property("ADBE Text Properties").property("ADBE Text Document"), td = p.value, low = td.text.toLowerCase();
    for (var i = 0; i < words.length; i++) { var s = low.indexOf(words[i].toLowerCase()); if (s >= 0) td.characterRange(s, s + words[i].length).fillColor = UI.hex(col || "#2959FF"); }
    p.setValue(td);
};
UI.key = function (p, f, v) { p.setValueAtTime(f / UI.FPS, v); };
UI.ease = function (p, inf) {
    for (var k = 1; k <= p.numKeys; k++) {
        var n = (p.isSpatial || !(p.value instanceof Array)) ? 1 : p.value.length, e = [];
        for (var j = 0; j < n; j++) e.push(new KeyframeEase(0, inf || 85));
        try { p.setTemporalEaseAtKey(k, e, e); } catch (x) {}
    }
};
UI.tr = function (L, mn) { return L.property("ADBE Transform Group").property(mn); };
// fade + rise (or slide) entrance, house blurPopSoft-like
UI.pop = function (L, f, dx, dy, frames) {
    var fr = frames || 16, op = UI.tr(L, "ADBE Opacity"), ps = UI.tr(L, "ADBE Position"), v = ps.value;
    UI.key(op, f, 0); UI.key(op, f + Math.round(fr * 0.6), 100);
    UI.key(ps, f, [v[0] + (dx || 0), v[1] + (dy === undefined ? 40 : dy)]); UI.key(ps, f + fr, [v[0], v[1]]); UI.ease(ps, 88);
};
UI.scalePop = function (L, f, from) {
    var sc = UI.tr(L, "ADBE Scale"), op = UI.tr(L, "ADBE Opacity"), s0 = from || 86;
    UI.key(sc, f, [s0, s0]); UI.key(sc, f + 18, [100, 100]); UI.ease(sc, 90);
    UI.key(op, f, 0); UI.key(op, f + 8, 100);
};
UI.group = function (name, x, y, kids) {
    var N = UI.C.layers.addNull(); N.name = name; N.enabled = false;
    UI.tr(N, "ADBE Anchor Point").setValue([50, 50]); UI.tr(N, "ADBE Position").setValue([x, y]);
    for (var i = 0; i < kids.length; i++) kids[i].parent = N;
    return N;
};
UI.fadeKids = function (kids, f, fr) { for (var i = 0; i < kids.length; i++) { var o = UI.tr(kids[i], "ADBE Opacity"); UI.key(o, f, 0); UI.key(o, f + (fr || 8), 100); } };
UI.out = function (L, f, fr) { var o = UI.tr(L, "ADBE Opacity"); UI.key(o, f, o.valueAtTime(f / UI.FPS, false)); UI.key(o, f + (fr || 8), 0); };
UI.counter = function (L, f, n, suffix, dur) {
    L.property("ADBE Text Properties").property("ADBE Text Document").expression =
        "var t0=" + (f / UI.FPS) + ", n=" + n + ";\nvar v=Math.round(easeOut(time,t0,t0+" + (dur || 0.9) + ",0,n));\n" +
        "v.toString().replace(/\\B(?=(\\d{3})+(?!\\d))/g, \",\")" + (suffix ? " + \"" + suffix + "\"" : "") + ";";
};
// house-style type-on: per-character fade + soft blur + small rise, range Start 0 -> 100
UI.typeOn = function (L, f0, f1) {
    var an = L.property("ADBE Text Properties").property("ADBE Text Animators").addProperty("ADBE Text Animator");
    var ani = function () { var a = L.property("ADBE Text Properties").property("ADBE Text Animators"); return a.property(a.numProperties); };
    ani().property("ADBE Text Animator Properties").addProperty("ADBE Text Opacity");
    ani().property("ADBE Text Animator Properties").addProperty("ADBE Text Blur");
    ani().property("ADBE Text Animator Properties").addProperty("ADBE Text Position 3D");
    ani().property("ADBE Text Animator Properties").property("ADBE Text Opacity").setValue(0);
    ani().property("ADBE Text Animator Properties").property("ADBE Text Blur").setValue([10, 10]);
    ani().property("ADBE Text Animator Properties").property("ADBE Text Position 3D").setValue([0, 30, 0]);
    ani().property("ADBE Text Selectors").addProperty("ADBE Text Selector");
    var sel = ani().property("ADBE Text Selectors").property(1);
    // house style: word by word, square shape + full smoothness (no ghost of the words still to come)
    try { sel.property("ADBE Text Range Advanced").property("ADBE Text Range Type2").setValue(3); } catch (e) {}   // based on words
    try { sel.property("ADBE Text Range Advanced").property("ADBE Text Range Shape").setValue(1); } catch (e1) {}  // square
    try { sel.property("ADBE Text Range Advanced").property("ADBE Text Selector Smoothness").setValue(100); } catch (e2) {}
    var st = sel.property("ADBE Text Percent Start");
    UI.key(st, f0, 0); UI.key(st, f1, 100); UI.ease(st, 60);
};
UI.trimLayer = function (L, a, b) { for (var r = 0; r < 3; r++) { L.inPoint = a / UI.FPS; L.outPoint = b / UI.FPS; } };
UI.shadow = function (L, op) {
    var d = L.property("ADBE Effect Parade").addProperty("ADBE Drop Shadow");
    d.property("Shadow Color").setValue([0.1, 0.18, 0.42, 1]); d.property("Opacity").setValue(op || 18);
    d.property("Direction").setValue(180); d.property("Distance").setValue(18); d.property("Softness").setValue(70);
};

// ---- spring pop: inertial bounce (amp 0.05, freq 3.5, decay 8) on two LINEAR keys,
// so the value arrives with speed and settles with one damped overshoot (no stop at a peak key).
UI.BOUNCE = "amp = 0.05; freq = 3.5; decay = 8;\nn = 0;\nif (numKeys > 0) { n = nearestKey(time).index; if (key(n).time > time) n--; }\n" +
    "t = (n == 0) ? 0 : time - key(n).time;\n" +
    "if (n > 0 && t < 1) { v = velocityAtTime(key(n).time - thisComp.frameDuration / 10); value + v * amp * Math.sin(freq * t * 2 * Math.PI) / Math.exp(decay * t); } else { value; }";
// house pop graph: first key LINEAR out, second key bezier in, 100% influence, speed 0 ("expo"),
// 14 f. Position and scale must share this exact duration and graph.
UI.expoPair = function (p, f, v0, v1, frames) {
    var fr = frames || 14;
    UI.key(p, f, v0); UI.key(p, f + fr, v1);
    var k0 = p.nearestKeyIndex(f / UI.FPS), k1 = p.nearestKeyIndex((f + fr) / UI.FPS), LN = KeyframeInterpolationType.LINEAR, BZ = KeyframeInterpolationType.BEZIER;
    p.setInterpolationTypeAtKey(k0, p.keyInInterpolationType(k0), LN);
    p.setInterpolationTypeAtKey(k1, BZ, BZ);
    var n = p.keyInTemporalEase(k1).length, ei = [], eo = [];
    for (var i = 0; i < n; i++) { ei.push(new KeyframeEase(0, 100)); eo.push(new KeyframeEase(0, 16.67)); }
    p.setTemporalEaseAtKey(k1, ei, eo);
    if (p.isSpatial) { try { p.setSpatialTangentsAtKey(k0, [0, 0], [0, 0]); p.setSpatialTangentsAtKey(k1, [0, 0], [0, 0]); } catch (e) {} }
};
UI.spring = function (p, f, v0, v1, frames) { UI.expoPair(p, f, v0, v1, frames || 14); p.expression = UI.BOUNCE; };
// scale spring + quick fade (+ optional rise, eased, no bounce)
UI.popSpring = function (L, f, fromFactor, rise, frames) {
    var sc = UI.tr(L, "ADBE Scale"), s = sc.value, from = [];
    for (var i = 0; i < s.length; i++) from.push(s[i] * fromFactor);
    var fr = frames || 14;
    UI.spring(sc, f, from, s, fr);
    UI.key(UI.tr(L, "ADBE Opacity"), f, 0); UI.key(UI.tr(L, "ADBE Opacity"), f + 5, 100);
    if (rise) { var ps = UI.tr(L, "ADBE Position"), p = ps.value; UI.expoPair(ps, f, [p[0], p[1] + rise], p, fr); } // same duration + graph as scale
};
