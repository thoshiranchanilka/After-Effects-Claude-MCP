# Starter style

A clean, generic SaaS-explainer style so the server works out of the box. Replace it with your own:
run `tools/AE_Style_Exporter.jsx` on your projects and have Claude write a new `profile.json` + `STYLE.md`,
or point `AE_STYLE_PROFILE` at a profile you keep elsewhere (see GUIDE.md).
`profile.json` holds every number below in machine form; the library reads only from it.

## 1. Format & structure
- 1920×1080, 30 fps, Advanced 3D renderer, motion blur on (shutter 180°).
- `Main` comp = scene precomps `S01`, `S02`, … butted end to end.
- Each scene = several **shots**, each with its own camera rig; content layers are trimmed to their shot.
- Anything that should react to the camera is a 3D layer with motion blur.

## 2. Background
Pale base solid + two softly blurred gradient blobs deep in Z ("aurora"), one low, one high and flipped.
Palettes: `blue`, `warm`, `violet`.

## 3. Camera
- Rig: `Control Null` (slow sine drift) → `Camera_Controller <shot>` (all keyframes here) → `Camera <shot>`
  (one-node, 50 mm). The camera never rotates or zooms; motion is translation.
- Moves on the controller's Position:
  - **glide**: 30 frames, ease 70/70 (default)
  - **glideStrong**: 30 frames, ease 90/90
  - **punch**: 16 frames, linear out → 100% ease in
- Typical distances: crane 320 px, dolly 720 px, truck 640 px. Vary directions across a video.
- Hold 10–90 frames between moves; the drift keeps holds alive.

## 4. The split-move cut
Between shots, both controllers carry the **same move** (same direction, distance, ease). The outgoing shot plays
the first half, the cut lands at the midpoint, the incoming shot plays the second half. Different content, one
continuous motion. Incoming text starts revealing on the cut. Scene joins use the same idea across precomps.

## 5. Typography
- Inter Regular, 84 pt, near-black, centred. Accent colour for key words / product names.
- Swap the font in `profile.json` (`text.font` = PostScript name, `text.fontFamily`).

## 6. Text reveals
- **blurRise** (default): words rise 30 px from blur 30 and opacity 0, over 24 frames.
- **bounceWords**: per-word bounce on an expression selector.
- **fadeHighlight**: words fade in tinted with the accent, settling to the text colour.
- **charFade**: plain character fade.
- Exit: opacity fade over the last 8 frames, or cut with the shot.

## 7. Images, screenshots, logos
- 3D, motion blur, soft navy drop shadows.
- Enter **blurPop** (lens blur 30 → 0, fade, rise 60 px, 18 f); **logoTumble** (rotation settle + rise);
  **videoPop** (scale-in + exposure flash). Exit **blurOut**. Idle **float** (gentle sine on Y).

## 8. Building order
1. Plan scenes → shots → what appears in each (one idea per shot, short text).
2. Pick each cut's shared move.
3. Build (`build_storyboard` or the granular tools), then `render_frame` just after each cut and mid-shot, and fix
   anything off-frame or overlapping.
