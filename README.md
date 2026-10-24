# pi-claude-code-ui

> [!IMPORTANT]
> **Package renamed in 1.0.69.** This project is now published as [`pi-claude-code-ui`](https://www.npmjs.com/package/pi-claude-code-ui) (was `pi-claude-style-tools`).
>
> Install / migrate:
> ```bash
> pi install npm:pi-claude-code-ui
> # or
> npm i pi-claude-code-ui
> ```
> See [CHANGELOG 1.0.69](./CHANGELOG.md#1069--2026-07-17) for the full release notes (status dots, bare branch connectors, and more).

Claude Code inspired tool rendering for Pi — Shiki-powered diffs, status dots, branch connectors, file icons, and configurable output modes.

## Features

- **Compact built-in tool rendering** for `read`, `bash`, `grep`, `find`, `ls`, `edit`, and `write`
- **Claude-style OpenAI tool rendering** for `apply_patch` plus common Pi/OpenAI-style tools like `webfetch`, `web_search`, `fetch_content`, task tools, and context tools
- **`apply_patch` diff previews** that render parsed file patches in the call phase, similar to `edit`/`write`
- **Adaptive edit/write diffs** with split or unified layouts, syntax highlighting, and inline word-level emphasis
- **Diff stat bar** with colored add/remove summary and hunk metadata
- **Progressive collapsed diff hints** that shorten on narrow terminals
- **Live-only thinking** (default) — only the actively-streaming thinking renders expanded; finished thinking collapses to a one-line `Thought for Xs` row (`/cc-tools thinking full` restores always-expanded, `Ctrl+O` still expands anything)
- **MCP-aware rendering** with hidden, summary, and preview modes
- **Configurable output modes** for read, search, bash, and MCP results
- **Live running previews** that show a few output lines for active tool calls (latest lines for bash), persisting until the next tool/text activity
- **Subagent completion notifications** restyled to match the same Claude-style tool rows
- **RTK rewrite integration** that folds rewrite notices into the bash tool row with a muted `(RTK)` badge and expanded-only rewrite details
- **Transparent tool backgrounds** in `transparent` or `border` mode
- **Terminal colors** — `/cc-theme terminal on` makes pi's theme follow the terminal's own palette (Ghostty, Rex, kitty, WezTerm, …), including switches between two dark or two light themes
- **Theme-adaptive palette** — borders, branch connectors, dim text, spinner accent, diff highlighting, and diff backgrounds automatically follow the active pi theme (set `themeAdaptive: false` to keep the fixed Claude-style palette)
- **Transparent edit/write diffs** tinted with the theme's own diff colors
- **Grouped consecutive tool calls** with single-row summaries for repeated targets and per-tool glance rows for mixed work (set `groupToolCalls: false` to disable)
- **Extra detail toggle** with `Ctrl+Shift+O`, increasing expanded preview caps without making the default view heavy
- **Global border patch** for all tool rows, including unknown/custom tools

## Configuration

Set in `.pi/settings.json` or the active Pi agent settings file (`$PI_CODING_AGENT_DIR/settings.json`, defaulting to `~/.pi/settings.json`):

```json
{
  "toolBackground": "border",
  "readOutputMode": "preview",
  "searchOutputMode": "preview",
  "mcpOutputMode": "preview",
  "previewLines": 8,
  "expandedPreviewMaxLines": 4000,
  "extraExpandedPreviewMaxLines": 12000,
  "extraToolOutputExpanded": false,
  "groupToolCalls": true,
  "thinkingMode": "live",
  "bashOutputMode": "opencode",
  "bashCollapsedLines": 10,
  "bashCommandPreviewLines": 8,
  "liveToolPreview": true,
  "liveToolPreviewLines": 5,
  "diffCollapsedLines": 24,
  "diffLayout": "auto",
  "themeAdaptive": true,
  "terminalTheme": false
}
```

Leave `diffTheme` unset to highlight diffs with the theme's colors; set it (for example `"github-dark"`) to force a fixed diff palette.

### Theme integration

When `themeAdaptive` is `true` (default), the following colors are derived from the active pi theme on every render and re-derived whenever the theme changes:

| Element | Derived from |
|---------|--------------|
| Branch connectors (`├`, `└`, `│`) | terminal background blended toward its text color to a 2:1 contrast (rgb 72 on a near-black terminal); `/cc-tools branch theme` uses `dim` → `muted` → `borderMuted` instead, `/cc-tools branch <0-255>` an exact gray |
| User box, tool rules, code fences, thinking rule | the same blend at a 5.1:1 contrast (rgb ~136 on a near-black terminal) |
| "✻ Turn took Ns" line (final message only, with session total + turn count) | `muted` |
| Expanded thinking-block text and `∴` marker | `muted` |
| Diff add/remove accents | `toolDiffAdded` / `toolDiffRemoved` |
| Diff code highlighting | the theme's `syntax*` colors, the same ones pi uses for Markdown code blocks |
| Diff background tints | the terminal background tinted toward `toolDiffAdded` / `toolDiffRemoved` |
| Light or dark variants | pi's own decision (`theme.appearance`) |
| Spinner verb text (`Working…`) | `borderAccent` (fallback: `accent`) |
| Spinner status text | `muted` |

These need pi 1.4 or newer, which exposes the theme's concrete colors. On older pi versions branch connectors stay rgb 72, diffs use `github-dark` / `github-light`, and diff tints are mixed against `toolSuccessBg`.

User-supplied `diffTheme` presets and `diffColors` overrides always win over theme-derived defaults. File-type icons (e.g. `ts`, `py`, `rs`) keep their language-identity colors and are not theme-derived.

Set `themeAdaptive: false` to keep the original fixed Claude-style palette regardless of the active pi theme.

On `/resume`, `/new`, or `/fork`, tool chrome is rebound from the **current** pi theme, so it also follows themes set by other extensions.

### Terminal colors (Ghostty, Rex, …)

`/cc-theme terminal on` switches pi to its built-in `system` theme, which builds every pi color from the palette the terminal reports, and keeps it there on every start. The theme you had before is saved as `terminalThemePrevious`; `/cc-theme terminal off` restores it.

Pi already rebuilds the `system` theme when the terminal switches between light and dark. Terminals send no notification when you switch between two themes of the same kind, for example from one dark Rex theme to another, so this extension also asks the terminal for its color scheme whenever the terminal window regains focus (you went to the terminal's settings and came back). Pi then re-reads the palette and repaints only if the colors changed. The query is answered by Ghostty, Rex, and other terminals that support color scheme reports; in regular (non-fullscreen) mode the extension turns on focus reporting itself and keeps the focus events out of the editor.

```text
/cc-theme terminal on       # follow the terminal's colors
/cc-theme terminal off      # go back to the previous theme
/cc-theme terminal status   # show the current state
```

#### Toggle at runtime with `/cc-theme`

```text
/cc-theme           # show current setting + theme name (and whether terminal colors are on)
/cc-theme status    # show current setting + color preview (incl. spinner)
/cc-theme on        # follow pi theme
/cc-theme off       # keep fixed Claude palette
/cc-theme toggle    # flip the current value
```

The selection is persisted to the active Pi agent settings file and applied to the next rendered tool row. No restart required.

#### Repaint the spinner with `/cc-spinner`

The spinner glyph itself is still colored by pi's loader using `accent`, while the verb text (e.g. `Cooking…`) follows `borderAccent` by default so it stays lively without being the exact same color as the glyph. The status suffix (e.g. `(thinking · ↓ 10 tokens · 2s)`) follows `muted`. Use `/cc-spinner` to bind either text element to any other theme color key:

```text
/cc-spinner preview          # list every common theme key with a colored sample
/cc-spinner verb <key>       # change the verb color (e.g. thinkingHigh, mdHeading)
/cc-spinner status <key>     # change the status suffix color
/cc-spinner reset            # restore defaults (verb=borderAccent, status=muted)
```

The selection is persisted as `spinnerVerbColor` / `spinnerStatusColor` in the active Pi agent settings file and applied on the next spinner tick.

### Tool background modes

| Value | Behavior |
|-------|----------|
| `default` | Standard Pi tool backgrounds |
| `transparent` | Transparent tool backgrounds |
| `border` | Transparent backgrounds with top/bottom border lines |

Use `/cc-tools` to control tool UI at runtime:

```text
/cc-tools status          # show style, grouping, and extra-detail state
/cc-tools outlines        # tool style: outlines, transparent, or default
/cc-tools group toggle    # toggle grouped adjacent/concurrent tool calls
/cc-tools group off       # disable grouping (also ungroups current grouped rows)
/cc-tools thinking live   # default: only the streaming thinking expands; finished ones collapse
/cc-tools thinking full   # always render thinking expanded, like stock pi
/cc-tools detail toggle   # same mode as Ctrl+Shift+O
```

### Output modes

| Setting | Values | Default |
|---------|--------|---------|
| `readOutputMode` | `hidden`, `summary`, `preview` | `preview` |
| `searchOutputMode` | `hidden`, `count`, `preview` | `preview` |
| `mcpOutputMode` | `hidden`, `summary`, `preview` | `preview` |
| `bashOutputMode` | `opencode`, `summary`, `preview` | `opencode` |

### Display settings

| Setting | Default | Description |
|---------|---------|-------------|
| `previewLines` | `8` | Lines shown in collapsed preview mode |
| `expandedPreviewMaxLines` | `4000` | Max lines when expanded with Ctrl+O |
| `extraExpandedPreviewMaxLines` | `12000` | Max lines after Ctrl+Shift+O extra-detail mode |
| `extraToolOutputExpanded` | `false` | Start with Ctrl+Shift+O extra-detail mode enabled |
| `groupToolCalls` | `true` | Group adjacent/concurrent calls, collapsing repeated targets into one row |
| `thinkingMode` | `live` | `live` = only streaming thinking expands (finished collapse to `Thought for Xs`); `full` = always expanded |
| `bashCollapsedLines` | `10` | Lines for collapsed bash output |
| `bashCommandPreviewLines` | `8` | Verbatim script lines shown while bash runs or after failure; `0` disables them |
| `liveToolPreview` | `true` | Show a small live output preview while tools are still running |
| `liveToolPreviewLines` | `5` | Lines shown in the collapsed live preview |
| `diffCollapsedLines` | `24` | Diff lines before collapsing |
| `diffLayout` | `"auto"` | `"auto"` uses split view only when it fits without heavy wrapping; `"split"` always uses split view when both columns fit; `"unified"` always stacks |

## Notes

This package targets recent Pi versions where tool renderers use:

- `renderCall(args, theme, context)`
- `renderResult(result, { expanded, isPartial }, theme, context)`

Unknown/custom tools do not have a public global renderer hook in Pi, so this package patches container rendering to add top/bottom borders for all tool executions in border mode.

## Credits

This project builds upon and was inspired by the excellent work of:

- **[@heyhuynhgiabuu/pi-pretty](https://github.com/buddingnewinsights/pi-pretty)** by [huynhgiabuu](https://github.com/buddingnewinsights) — Pretty terminal output with syntax-highlighted file reads, colored bash output, and tree-view directory listings
- **[@heyhuynhgiabuu/pi-diff](https://github.com/buddingnewinsights/pi-diff)** by [huynhgiabuu](https://github.com/buddingnewinsights) — Shiki-powered terminal diff renderer with word-level diffs in split and unified views
- **[pi-tool-display](https://github.com/MasuRii/pi-tool-display)** by [MasuRii](https://github.com/MasuRii) — Compact tool call rendering, diff visualization, and output truncation
