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
- **Diff summary** under each edit: added/removed line counts and hunk metadata, in the same quiet color as every other status line
- **Progressive collapsed diff hints** that shorten on narrow terminals
- **Live-only thinking** (default) — only the actively-streaming thinking renders expanded; finished thinking collapses to a one-line `Thought for Xs` row (`/cc-tools thinking full` restores always-expanded, `Ctrl+O` still expands anything)
- **MCP-aware rendering** with hidden, summary, and preview modes
- **Configurable output modes** for read, search, bash, and MCP results
- **Live running previews** that show a few output lines for active tool calls (latest lines for bash), persisting until the next tool/text activity
- **[pi-subagents](https://github.com/tintinweb/pi-subagents) support** — `Agent` rows show what a running agent is doing and its tool uses, tokens and time; completion notices and the live "Agents" widget use the same dots, connectors and indentation as tool rows
- **Shell file edits drawn as edits** — a bash call that only changes files (`sed -i`, `perl -pi`, a heredoc, `echo … > file`) shows as `Edit (sed) path` or `Create (heredoc) path` with a diff of what changed. The command runs unchanged and the model sees the same output; only the row is drawn differently
- **RTK rewrite integration** that folds rewrite notices into the bash tool row with a muted `(RTK)` badge and expanded-only rewrite details
- **Transparent tool backgrounds** in `transparent` or `border` mode
- **Terminal colors** (default, pi 1.4+) — pi's theme follows the terminal's own palette (Ghostty, Rex, kitty, WezTerm, …), including switches between two dark or two light themes; `/cc-theme terminal off` keeps a theme of your choice
- **Theme-adaptive palette** — dim text, spinner accent, diff highlighting, and diff backgrounds automatically follow the active pi theme (set `themeAdaptive: false` to keep the fixed Claude-style palette)
- **Faint branch connectors** — `├ └ │` hang under the first letter of the tool name, keep the same faint contrast on every terminal background, and the status line after them (`Done`, `2 matches`, `+1 -1`) is drawn in the theme's dim color, as in pi-polish
- **Transparent edit/write diffs** tinted with the theme's own diff colors
- **Grouped consecutive tool calls** read as one sentence: `Read 2 files, ran 1 shell command`, or while they run `Reading 2 files, running 1 shell command… · 3s` with the call in progress underneath. `Ctrl+O` shows every call (set `groupToolCalls: false` to disable)
- **Activity status line** — while a tool runs, the working line says what it is doing (`Running npm test…`, `Reading stats.py…`, `Searching for TODO…`); the playful verbs stay for the time the model is thinking
- **`❯` prompt markers** — past prompts are one highlighted line starting with `❯`, and the input line gets the same marker, in the column where tool rows put their `●`
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
  "bashCommandPreviewLines": 0,
  "liveToolPreview": true,
  "liveToolPreviewLines": 5,
  "diffCollapsedLines": 24,
  "diffLayout": "auto",
  "themeAdaptive": true,
  "terminalTheme": true
}
```

Leave `diffTheme` unset to highlight diffs with the theme's colors; set it (for example `"github-dark"`) to force a fixed diff palette.

### Theme integration

When `themeAdaptive` is `true` (default), the following colors are derived from the active pi theme on every render and re-derived whenever the theme changes:

| Element | Derived from |
|---------|--------------|
| "✻ Turn took Ns" line (final message only, with session total + turn count) | `muted` |
| Expanded thinking-block text and `∴` marker | `muted` |
| Diff add/remove accents | `toolDiffAdded` / `toolDiffRemoved` |
| Diff code highlighting | the theme's `syntax*` colors, the same ones pi uses for Markdown code blocks |
| Diff background tints | the terminal background tinted toward `toolDiffAdded` / `toolDiffRemoved` |
| Light or dark variants | pi's own decision (`theme.appearance`) |
| Spinner verb text (`Working…`) | `borderAccent` (fallback: `accent`) |
| Spinner status text | `muted` |

These need pi 1.4 or newer, which exposes the theme's concrete colors. On older pi versions diffs use `github-dark` / `github-light`, and diff tints are mixed against `toolSuccessBg`.

Branch connectors (`├`, `└`, `│`) and outlines (user box, tool rules, code fences, thinking rule) are neutral marks with nothing to configure. They blend the terminal's background toward its text color until they reach a fixed contrast: 2:1 for connectors (rgb 72 on a near-black terminal) and 5.1:1 for outlines (rgb ~136), so connectors stay faint but visible on dark, light, and tinted themes alike. On pi versions before 1.4, which don't report the terminal's colors, the same contrasts are taken against black or white.

User-supplied `diffTheme` presets and `diffColors` overrides always win over theme-derived defaults. File-type icons (e.g. `ts`, `py`, `rs`) keep their language-identity colors and are not theme-derived.

Set `themeAdaptive: false` to keep the original fixed Claude-style palette regardless of the active pi theme.

On `/resume`, `/new`, or `/fork`, tool chrome is rebound from the **current** pi theme, so it also follows themes set by other extensions.

### Terminal colors (Ghostty, Rex, …)

On by default: at startup the extension switches pi to its built-in `system` theme, which builds every pi color from the palette the terminal reports, and keeps it there on every start. The theme you had before is saved as `terminalThemePrevious`; `/cc-theme terminal off` (or `"terminalTheme": false`) restores it and keeps it. `pi --use-theme <name>` still picks the theme for that run, and on pi versions without the `system` theme (before 1.4) nothing changes.

Pi already rebuilds the `system` theme when the terminal switches between light and dark. Terminals send no notification when you switch between two themes of the same kind, for example from one dark Rex theme to another, so this extension also asks the terminal for its color scheme whenever the terminal window regains focus (you went to the terminal's settings and came back). Pi then re-reads the palette and repaints only if the colors changed. The query is answered by Ghostty, Rex, and other terminals that support color scheme reports; in regular (non-fullscreen) mode the extension turns on focus reporting itself and keeps the focus events out of the editor.

```text
/cc-theme terminal on       # follow the terminal's colors
/cc-theme terminal off      # go back to the previous theme and keep it
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

While a tool runs, the verb names what it is doing (`Running npm test…`); otherwise it is a playful verb. The spinner glyph itself is still colored by pi's loader using `accent`, while the verb text (e.g. `Cooking…`) follows `borderAccent` by default so it stays lively without being the exact same color as the glyph. The status suffix (e.g. `(thinking · ↓ 331 tokens · 6s)`) follows `muted`; its token count covers everything the model has written for the current request, thinking and tool calls included, and climbs as it streams. Use `/cc-spinner` to bind either text element to any other theme color key:

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
| `bashCommandPreviewLines` | `0` | Script lines of a multi-line command shown under the row while bash runs or after it fails (for example `8`); `0` shows none. `Ctrl+O` always shows the whole command |
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
- **[pi-polish](https://github.com/Pringled/pi-extensions/tree/main/packages/pi-polish)** by [Thomas van Dongen](https://github.com/Pringled) — Claude Code-style output for Pi; the one-sentence tool groups, the activity status line, and the `❯` prompt markers follow its design
