# pi-claude-style-tools

Claude Code inspired tool rendering for Pi — Shiki-powered diffs, status dots, branch connectors, file icons, and configurable output modes.

## Features

- **Compact built-in tool rendering** for `read`, `bash`, `grep`, `find`, `ls`, `edit`, and `write`
- **Claude-style OpenAI tool rendering** for `apply_patch` plus common Pi/OpenAI-style tools like `webfetch`, `web_search`, `fetch_content`, task tools, and context tools
- **`apply_patch` diff previews** that render parsed file patches in the call phase, similar to `edit`/`write`
- **Adaptive edit/write diffs** with split or unified layouts, syntax highlighting, and inline word-level emphasis
- **Diff stat bar** with colored add/remove summary and hunk metadata
- **Progressive collapsed diff hints** that shorten on narrow terminals
- **Thinking labels** during streaming and final messages, with context sanitization
- **MCP-aware rendering** with hidden, summary, and preview modes
- **Pattern-based custom tool rendering** configured from `.pi/settings.json`
- **Configurable output modes** for read, search, bash, and MCP results
- **Transparent tool backgrounds** in `transparent` or `border` mode
- **Transparent edit/write diffs** with universal red/green diff colors
- **Global border patch** for all tool rows, including unknown/custom tools

## Configuration

Set in `.pi/settings.json` or `~/.pi/settings.json`:

```json
{
  "toolBackground": "border",
  "readOutputMode": "preview",
  "searchOutputMode": "preview",
  "mcpOutputMode": "preview",
  "customToolRenderers": [
    {
      "prefix": "linear_",
      "title": "Linear",
      "summaryArgs": ["query", "input.query"],
      "outputMode": "summary"
    },
    {
      "name": "deploy_preview",
      "title": "Deploy Preview",
      "summaryArgs": ["environment"],
      "outputMode": "preview"
    }
  ],
  "previewLines": 8,
  "bashOutputMode": "opencode",
  "bashCollapsedLines": 10,
  "diffCollapsedLines": 24,
  "diffTheme": "github-dark"
}
```

### Tool background modes

| Value | Behavior |
|-------|----------|
| `default` | Standard Pi tool backgrounds |
| `transparent` | Transparent tool backgrounds |
| `border` | Transparent backgrounds with top/bottom border lines |

### Output modes

| Setting | Values | Default |
|---------|--------|---------|
| `readOutputMode` | `hidden`, `summary`, `preview` | `preview` |
| `searchOutputMode` | `hidden`, `count`, `preview` | `preview` |
| `mcpOutputMode` | `hidden`, `summary`, `preview` | `preview` |
| `bashOutputMode` | `opencode`, `summary`, `preview` | `opencode` |

### Custom tool renderers

`customToolRenderers` lets you apply the compact OpenAI-style call/result rendering to custom tool executions by exact name or prefix.

| Field | Description |
|-------|-------------|
| `name` | Exact tool name to match. Use either `name` or `prefix`, not both |
| `prefix` | Tool name prefix to match. Exact `name` rules win over prefixes; the longest matching prefix wins |
| `title` | Display title. Defaults to a humanized tool name |
| `summaryArgs` | Arguments to try in order for the call header, such as `query`, `path`, or dotted paths like `input.file` |
| `outputMode` | `hidden`, `summary`, or `preview`. Defaults to `preview` |

Built-in tools, the generic `mcp` tool, and built-in OpenAI-style tools keep their existing renderers. Tools that already provide their own `renderCall` or `renderResult` keep those renderer slots.

You can generate rules interactively with `/cc-tools custom`; it previews the settings diff before offering to apply or review suggestions. Use `/cc-tools custom dry-run` to preview without opening the wizard, `/cc-tools custom edit` to edit or delete configured rules, `/cc-tools custom list` to inspect configured rules, and `/cc-tools custom clear` to remove them.

### Numeric settings

| Setting | Default | Description |
|---------|---------|-------------|
| `previewLines` | `8` | Lines shown in collapsed preview mode |
| `expandedPreviewMaxLines` | `4000` | Max lines when fully expanded |
| `bashCollapsedLines` | `10` | Lines for collapsed bash output |
| `diffCollapsedLines` | `24` | Diff lines before collapsing |

## Notes

This package targets recent Pi versions where tool renderers use:

- `renderCall(args, theme, context)`
- `renderResult(result, { expanded, isPartial }, theme, context)`

Unknown/custom tools do not have a public global renderer hook in Pi, so this package patches container rendering to add top/bottom borders for all tool executions in border mode. `customToolRenderers` uses the same narrow patch point to opt matching tool names into the compact renderer.

## Credits

This project builds upon and was inspired by the excellent work of:

- **[@heyhuynhgiabuu/pi-pretty](https://github.com/buddingnewinsights/pi-pretty)** by [huynhgiabuu](https://github.com/buddingnewinsights) — Pretty terminal output with syntax-highlighted file reads, colored bash output, and tree-view directory listings
- **[@heyhuynhgiabuu/pi-diff](https://github.com/buddingnewinsights/pi-diff)** by [huynhgiabuu](https://github.com/buddingnewinsights) — Shiki-powered terminal diff renderer with word-level diffs in split and unified views
- **[pi-tool-display](https://github.com/MasuRii/pi-tool-display)** by [MasuRii](https://github.com/MasuRii) — Compact tool call rendering, diff visualization, and output truncation
