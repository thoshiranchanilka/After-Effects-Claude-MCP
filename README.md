# After Effects × Claude — motion-design MCP

An MCP server that lets Claude build and edit **Adobe After Effects** projects while you chat. It
builds in a **style profile** for SaaS explainers: a 3D camera rig with drift, eased glides, split-move cuts,
word-by-word text reveals, shape-built UI, aurora backgrounds and voice-over-synced timing.

```
Claude (Desktop / Code) ──MCP──▶ dist/server.mjs (Node, on your machine)
                                     │ writes a .jsx job = style library + profile + task
                                     ▼
                          After Effects runs it (AppleScript on macOS, or the Claude Bridge panel)
                                     │ writes the result back
                                     ▼
                          Claude reads the result / a rendered frame and checks its work
```

- **15 tools**: status, style guide, whole-storyboard builds, scenes / shots / camera moves / split cuts,
  text, images, animation, inspection, frame renders, raw ExtendScript, undo.
- **`ae/claude_style_lib.jsx`** (`CS.*`): the style library that runs inside AE, driven by `style/profile.json`.
- **`ae/ui_lib.jsx`** (`UI.*`): a small builder for flat SaaS UI (cards, pills, charts, chat bubbles) out of shape layers.

**Start here → [GUIDE.md](GUIDE.md)** (setup, workflow, tools, scripting rules, troubleshooting).

## Quick start

```bash
git clone <this repo> && cd after-effects-claude-mcp
npm install          # only needed for tests / the helper scripts; dist/server.mjs runs on its own
npm test             # 45 checks against a simulated After Effects
```

Claude Code:
```bash
claude mcp add after-effects -- node "$(pwd)/dist/server.mjs"
```

Claude Desktop → Settings → Developer → Edit Config:
```json
{ "mcpServers": { "after-effects": { "command": "node", "args": ["/absolute/path/to/after-effects-claude-mcp/dist/server.mjs"] } } }
```

In After Effects: Settings → Scripting & Expressions → **Allow Scripts to Write Files and Access Network**.
Install **Inter** (the starter profile's typeface) or set your own font in the profile. Open a project, then ask Claude to check the connection.

## Your own style

The server ships with a generic **starter** profile. To build in your style, export your projects with
`tools/AE_Style_Exporter.jsx`, let Claude derive a `profile.json` + `STYLE.md`, keep them anywhere, and point the
server at them:

```bash
claude mcp add after-effects -e AE_STYLE_PROFILE="/path/to/my-style/profile.json" -- node "$(pwd)/dist/server.mjs"
```
`STYLE.md` next to that profile is picked up automatically. See [GUIDE.md](GUIDE.md#8-teaching-it-your-own-style).

## Requirements
- After Effects 2024 or newer (developed on AE 2026/2027, macOS). Windows works through the `Claude Bridge.jsx` panel.
- Node.js 18+.
- Optional: ffmpeg (contact sheets, audio previews), Quick Chromatic Aberration (third-party, used by the finishing recipe).

## Layout
| Path | What |
|---|---|
| `dist/server.mjs` | The MCP server, bundled (no install needed). `npm run build` rebuilds it from `server/`. |
| `server/` | Server source: `index.js` (tools), `bridge.js` (job files, AppleScript / panel dispatch). |
| `ae/claude_style_lib.jsx` | `CS.*` style library, re-read on every call (edits apply without restart). |
| `ae/ui_lib.jsx` | `UI.*` shape-UI builder + the house pop / spring / type-on helpers. |
| `ae/Claude Bridge.jsx` | Optional dockable listener panel (required on Windows). |
| `style/profile.json`, `style/STYLE.md` | The starter style (numbers + rules). Use your own with `AE_STYLE_PROFILE`. |
| `tools/AE_Style_Exporter.jsx` | Exports a project's Main comp to JSON so Claude can learn a new style. |
| `scripts/run-jsx.mjs` | Run a `.jsx` file in AE from the terminal (same bridge as the tools). |
| `scripts/check-es3.mjs` | ES3 + reserved-word check before a script reaches AE. |
| `test/` | Simulated-AE test suite. |
