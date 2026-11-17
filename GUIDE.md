# Guide

Everything you need to install the server, connect it to Claude, and work with it day to day.

1. [Install](#1-install)
2. [Connect to Claude](#2-connect-to-claude)
3. [Prepare After Effects](#3-prepare-after-effects)
4. [How a session goes](#4-how-a-session-goes)
5. [Tools](#5-tools)
6. [Running scripts directly](#6-running-scripts-directly)
7. [Scripting rules (ExtendScript)](#7-scripting-rules-extendscript)
8. [Teaching it your own style](#8-teaching-it-your-own-style)
9. [Troubleshooting](#9-troubleshooting)
10. [Development](#10-development)

---

## 1. Install

**The lazy way:** give the repo link to Claude Code and ask it to install it:

```
Install this After Effects MCP server for me: https://github.com/thoshiranchanilka/After-Effects-Claude-MCP.git
```

Claude Code clones it, runs the tests, adds the server (step 2) and reminds you of the After Effects setting
(step 3). Prefer doing it yourself? Read on.

```bash
git clone https://github.com/thoshiranchanilka/After-Effects-Claude-MCP.git
cd After-Effects-Claude-MCP
npm install        # dev tools: tests, ES3 checker, rebuild. The server itself needs nothing.
npm test
```

`dist/server.mjs` is a single bundled file. It finds `ae/`, `style/` relative to itself, so keep the folder
structure intact.

## 2. Connect to Claude

**Claude Code**
```bash
claude mcp add after-effects -- node "/absolute/path/to/After-Effects-Claude-MCP/dist/server.mjs"
```

**Claude Desktop**: Settings → Developer → Edit Config:
```json
{
  "mcpServers": {
    "after-effects": {
      "command": "/opt/homebrew/bin/node",
      "args": ["/absolute/path/to/After-Effects-Claude-MCP/dist/server.mjs"]
    }
  }
}
```
Use the output of `which node` for `command` (GUI apps don't always see your shell PATH). Restart Claude;
the *after-effects* tools appear.

Optional environment variables:
| Variable | Default | Use |
|---|---|---|
| `AE_STYLE_PROFILE` | `style/profile.json` | Point at your own style profile (its `STYLE.md` is read from the same folder). |
| `AE_STYLE_MD` | `STYLE.md` next to the profile | Override the style guide file. |
| `AE_BRIDGE_DIR` | `~/Library/Application Support/AE Claude Bridge` (mac) | Where job files and renders go. |

## 3. Prepare After Effects

1. Settings → Scripting & Expressions → tick **Allow Scripts to Write Files and Access Network**.
2. Install the profile's font (**Inter** for the starter profile). If it is missing AE substitutes a font and Claude is warned.
3. Open a project. The first time, macOS asks whether your terminal / Claude may control *Adobe After Effects* → **Allow**
   (System Settings → Privacy & Security → Automation if you missed it).
4. *(Windows, or if AppleScript is blocked)* copy `ae/Claude Bridge.jsx` to
   `…/Adobe After Effects <version>/Scripts/ScriptUI Panels/`, restart AE, open **Window → Claude Bridge.jsx**.
   While it shows *Listening*, jobs go through the panel.

## 4. How a session goes

Say what you want in plain words:

> Check After Effects is connected. Build a 60-second explainer for *Acme Endpoint Health* in my style,
> synced to the voice-over in `~/Desktop/vo.mp3` (word timings in `vo_words.json`). Blue palette.
> Hook with a persona, then the problem, the product moment, three UI scenes, results, end card.

A good session:

1. **Plan before building**: beats from the voice-over, one idea per shot, which camera move carries each cut.
2. **Build** with `build_storyboard` (fast, whole video) or scene by scene with `create_scene` / `add_shot` /
   `split_cut` and `run_extendscript` + `UI.*` for custom UI.
3. **Look**: `render_frame` at key frames (just after each cut, mid-shot, end of each reveal), contact sheets
   with ffmpeg, frame-by-frame checks around every join.
4. **Revise in place**: you review and give notes scene by scene; Claude patches the existing layers instead of
   rebuilding over your hand edits.
5. **Sound**: SFX plan synced to cuts and reveals, music edited to bar-aligned drops, levels automated, peak-checked.
6. **Finish**: a `Render` comp with Main + finishing adjustment layers (grade, grain, edge blur).

Each tool call is one undo step in AE (`undo` reverts the last N). Read-only jobs use the label `undo`
so they don't create undo groups.

## 5. Tools

| Tool | What it does |
|---|---|
| `ae_status` | Is AE reachable? Lists comps. |
| `get_style_guide` | `STYLE.md` + `profile.json`. Claude reads this before building. |
| `build_storyboard` | Whole video from a storyboard JSON: scenes, shots, split-move cuts, text, images, Main comp. See `examples/storyboard-example.json`. |
| `create_scene`, `add_shot`, `move_camera`, `split_cut` | Build step by step on the house camera rig. |
| `add_text`, `add_image`, `animate_layer` | Content with house reveals / entrances / exits. |
| `place_scene`, `inspect_comp`, `render_frame` | Assemble into Main, inspect layers/keys, render a PNG to look at. |
| `run_extendscript` | Any ExtendScript, with `CS.*` available. `return` sends a value back. |
| `undo` | Undo the last N Claude steps. |

### Style library highlights (`CS.*`)
`createScene`, `addShot`, `moveCamera`, `splitCut`, `addBackground` (aurora), `addText` (blurRise, bounceWords,
fadeHighlight, charFade), `addImage` (blurPop, tumble, float), `addCard`, `addChip`, `addStat`, `addChecklist`,
`addConnector`, `addTrack`, `addPanel`, `addEyebrow`, `addSlotCounter` (slot-machine number roll),
`buildStoryboard`, `inspect`, `renderFrame`.

### UI library (`UI.*`, in `ae/ui_lib.jsx`)
Set `UI.C = comp`, then: `rect`, `circle`, `path`, `text`, `accent`, `trim`, `dashes`, `group`, `shadow`,
`typeOn` (word-based reveal), `counter` (number count-up expression), `expoPair` (house pop graph),
`spring` / `popSpring` (pop with inertial settle), `fadeKids`, `out`, `trimLayer`.
Load it by prepending the file to a job (`scripts/run-jsx.mjs --ui` does this).

## 6. Running scripts directly

When you (or Claude without MCP tools loaded) want to run a script file:

```bash
node scripts/check-es3.mjs my_patch.jsx            # always first
node scripts/run-jsx.mjs my_patch.jsx "Fix S03 framing" 300000 --ui
node scripts/run-jsx.mjs inspect.jsx undo          # read-only: label "undo"
```
The file is a function body: use `return` to send a result back. Long scripts should save the project at the end
(`app.project.save()`).

## 7. Scripting rules (ExtendScript)

ExtendScript is **ES3**. These cost real time when broken:

- No `let`/`const`, arrow functions, template strings, `JSON`, trailing commas, `Array.prototype.map/forEach`.
- **Never use reserved words as property names** (`{in: 1}`, `o.class`, `o.default`): AE pops a modal
  *Illegal use of reserved word* dialog that blocks every later job until someone clicks it. `scripts/check-es3.mjs` catches this.
- Concatenating an array-valued property into a string (`"pos " + prop.value`) can throw
  *invalid numeric result (divide by zero?)*. Use `.join(",")`.
- Shape-layer property references go stale after any `addProperty`: re-fetch by index.
- In shape layers the **first** group draws on top.
- Set `inPoint`/`outPoint` in a small loop (`for r<3`): setting one can reset the other on footage and precomp layers.
- Spatial properties take **one** `KeyframeEase`; Scale takes one per dimension (`value.length`).
- 2D layer rotation is `"ADBE Rotate Z"`. A null's opacity does not propagate to children.
- Gaussian Blur "Repeat Edge Pixels" defaults **on** (hard edges on big blurred shapes); turn it off.
- Removing every time-remap key disables time remapping.
- Comp names repeat in imported projects ("Main", "S01"…). Find comps by id, or by name **plus** layer count / duration.
- `displayStartTime` can be non-zero; keys use comp time.
- `comp.saveFrameToPng()` returns before the file exists; wait for it. It renders at the comp's current resolution.
- `sourceRectAtTime` on text with blur/position animators is inflated; disable animators to measure.
- **Never import a huge reference project** into your working project. Open it, make a small template
  (`app.project.reduceProject([comps])` → save as a new file), reopen your project, import the template.
  Don't open one project and import into another in the same job: it can crash AE.

## 8. Teaching it your own style

1. Run `tools/AE_Style_Exporter.jsx` (File → Scripts → Run Script File) on a finished project. It writes
   `<project> - Main.full.json`, `.summary.json` and `.camera.json` next to the project.
2. Give Claude those files (and the rendered mp4) and ask it to update `style/profile.json` and `style/STYLE.md`.
3. Everything `CS.*` builds reads its numbers from `profile.json`, so you can also tweak values directly
   (text size, ease influence, move distances, palettes).
4. Keep your profile outside the repo (or in a git-ignored folder like `my-style/`) and point the server at it:
   `AE_STYLE_PROFILE=/path/to/my-style/profile.json` in the MCP config (Claude Code: `claude mcp add … -e AE_STYLE_PROFILE=…`;
   Claude Desktop: an `"env"` block). The tests follow the active profile too:
   `AE_STYLE_PROFILE=/path/to/profile.json npm test`.

When a new scene should look like a moment from an old project, have Claude **copy the real layers** from a
reduced template of that project and compare side by side, rather than rebuilding from video frames: the look lives
in effect stacks and keyframe details that stills don't show.

## 9. Troubleshooting

| Symptom | Fix |
|---|---|
| "After Effects is not running" | Open AE with a project first. |
| Timed out waiting for After Effects | A dialog is open in AE (often *Illegal use of reserved word*), or "Allow Scripts to Write Files" is off. Click the dialog, run the ES3 check. |
| "did not run the job (osascript)" / "Connection is invalid (-609)" | Allow Automation in System Settings, or use the Bridge panel. -609 after a heavy job usually means AE crashed: reopen your last save. |
| `render_frame` writes nothing | AE sometimes stops writing PNGs after a project import; restart AE. |
| Wrong comp edited | Duplicate comp names: use ids (`app.project.itemByID`). |

Job files and renders live in `~/Library/Application Support/AE Claude Bridge/` (or `AE_BRIDGE_DIR`).

## 10. Development

```bash
npm test               # simulated AE DOM (test/mock-ae.mjs) + the MCP server over stdio
npm run build          # bundle server/ → dist/server.mjs (esbuild)
npm run check-es3 -- ae/*.jsx
```
`ae/claude_style_lib.jsx` is re-read on every call, so library edits take effect without restarting Claude.
