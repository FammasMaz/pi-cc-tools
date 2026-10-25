# Changelog

> [!IMPORTANT]
> **1.0.69 — package rename (permanent).** Canonical npm name is now [`pi-claude-code-ui`](https://www.npmjs.com/package/pi-claude-code-ui). `pi-claude-style-tools` is legacy and will not receive further releases. Install with `pi install npm:pi-claude-code-ui` or `npm i pi-claude-code-ui`.

## Unreleased

### Changed

- **The working line's token count climbs as the model writes**, like pi-polish: `↓ N tokens` now includes thinking and tool-call arguments while they stream (it only counted visible text, so it sat near zero while the model thought), each finished message adds the provider's real output-token count, and the count keeps going across the turns of one request instead of starting over after every tool call.
- **Running bash commands no longer repeat their script under the row** by default. Set `bashCommandPreviewLines` (for example to `8`) to bring the preview back, for running and failed commands; `Ctrl+O` still shows the whole command.

## 1.0.94 — 2026-10-25

### Changed

- **Connectors hang under the tool name** - `├ └ │` start under the first letter of the label (`● Edit stats.py` / `  └ +1 -1 at line 4`) instead of under the `●`, in tool rows, expanded groups, subagent notices and the Agents widget. Expanded groups keep each call's own indentation, so output sits after its `└`.
- **Status lines are dim** - the line under a command (`Done (3 lines)`, `2 matches`, `+1 -1 • 1 hunk at line 4`) is drawn in the theme's `dim` color, as pi-polish does; errors stay red. The colored `[━━━━]` bar is gone from diff summaries, since it carries nothing in one color.

### Fixed

- **A failed read said "1 lines loaded"**; it now shows the error.

## 1.0.93 — 2026-10-25

### Added

- **Grouped tool calls read as one sentence** - a run of calls collapses to `Read 2 files, ran 1 shell command` instead of a header plus a row per call. While they run it says `Reading 2 files, running 1 shell command… · 3s` with the call in progress underneath; `Ctrl+O` still shows every call. Inspired by [pi-polish](https://github.com/Pringled/pi-extensions/tree/main/packages/pi-polish).
- **The working line says what is happening** - while a tool runs it reads `Running npm test…`, `Reading stats.py…`, `Searching for TODO…` or `Waiting for agent: …`; the playful verbs remain while the model thinks.
- **`❯` prompt markers** - past prompts are one line in the theme's prompt color starting with `❯`, instead of a box labelled `User`, and the input line gets the same `❯`.
- **Shell file edits are drawn as edits** - bash calls that only change files (`sed -i`, `perl -pi`, `cat > file <<EOF`, `tee`, `echo … > file`) show as `Edit (sed) stats.py` or `Create (heredoc) notes.md` with a diff, taken from the file before and after the command. The command and what the model sees are unchanged; the diff is kept with the row, so it shows again after a resume. These rows are never folded into a group.
- **[pi-subagents](https://github.com/tintinweb/pi-subagents) support** - `Agent` rows show the agent type, what a running agent is doing, and its tool uses, tokens and time when done. Completion notices and the live "Agents" widget use the same green dots, connectors and indentation as tool rows (they used pink markers, `└─` arms, and a column of their own).

### Fixed

- **Edit rows were indented one column further than every other row** on pi 1.4, along with their diff.
- **Tools without a summary of their own repeated their name** (`Ctx Reduce Ctx Reduce`); they now show their main argument.
- **Kotlin script files (`.kts`) were not syntax-highlighted** in diffs.

## 1.0.92 — 2026-10-24

### Changed

- **Terminal colors are on by default** - on pi 1.4 or newer, pi now follows the terminal's palette (Ghostty, Rex, ...) without `/cc-theme terminal on`. The first start switches to pi's `system` theme, saves the theme you had as `terminalThemePrevious`, and says so; `/cc-theme terminal off` (or `"terminalTheme": false`) restores that theme and keeps it. `pi --use-theme <name>` still wins for that run, and older pi versions are left alone.
- **Branch connectors have one rule and no settings** - `├ └ │` are always a faint mark at a fixed 2:1 contrast against the terminal background, which keeps them visible on dark, light, and tinted themes. The `/cc-tools branch` command and the `toolBranchColorMode` / `toolBranchRgbGray` settings are removed; existing values are ignored. On pi before 1.4 the contrast is taken against black or white (rgb 72 on dark themes, as before).

## 1.0.91 — 2026-10-24

### Added

- **Follow the terminal's colors** - `/cc-theme terminal on` (setting `terminalTheme`) switches pi to its built-in `system` theme, which takes every color from the palette Ghostty, Rex, or any other terminal reports, and keeps it on at every start. `/cc-theme terminal off` restores the previous theme. Terminals do not announce switches between two themes of the same kind (dark to dark), so the extension also asks the terminal for its color scheme when its window regains focus, and pi re-reads the palette.

### Fixed

- **Diffs use the theme's colors** - diff code was highlighted with GitHub's palette (`github-dark` / `github-light`) whatever the pi theme, so it never matched Markdown code blocks or the terminal. Diffs now use the theme's `syntax*` colors, and diff rows tint the terminal background toward the theme's own `toolDiffAdded` / `toolDiffRemoved` instead of mixing in fixed green and pink. Needs pi 1.4 or newer; older versions keep the GitHub palettes.
- **Connectors and outlines follow the theme's tint** - branch connectors were a fixed neutral rgb(72) and box outlines rgb(136) on every theme, which looked heavy on light themes and gray on tinted ones. The default now blends the terminal background toward its text color to the same contrast (2:1 and 5.1:1), so dark terminals look as before. An explicit `/cc-tools branch <0-255>` still sets an exact gray.
- **Light and dark agree with pi** - light/dark choices (diff palette, chrome) now come from pi's `theme.appearance` instead of a separate brightness guess, so they can no longer disagree with pi's own UI.
- **Light themes no longer gray out syntax colors** - the contrast fix for bundled Shiki themes replaced every color above a fixed brightness with gray on light themes. It now only applies to the bundled themes.
- **`diffColors.shikiTheme` is kept on theme switches** - a light/dark switch overwrote it with `github-dark` / `github-light`.
- **Transparent tool backgrounds on pi 1.4** - pi 1.4 renamed the theme's background table, so `toolBackground` overrides were silently skipped.

## 1.0.90 — 2026-10-19

### Fixed

- **Split diffs wrap long lines again** - with `"diffLayout": "split"` long lines were cut off with `›` after one row (two or three on wide terminals) instead of wrapping, because split columns kept the wrap limit meant for the auto layout. Forced split now wraps each line in full, up to 8 rows. Thanks @nabsiddiqui ([#34](https://github.com/FammasMaz/pi-cc-tools/issues/34)).

## 1.0.89 — 2026-10-19

### Fixed

- **Direct MCP tools show what they did** - `mcp__<server>__<tool>` rows showed only `MCP status` until expanded. They now show `server:tool` and the main argument (for example `MCP subagents:Agent Debug NaN`), and grouped headers list the tool names (`Agent, Ctx Reduce`) instead of `Mcp Subagents Agent`.
- **Running tool rows no longer draw their header twice** - the first pending blink invalidated the row while Pi was still building it, which left the call line in the row twice until the next redraw (until the result arrived on expanded rows). Affected every tool, not only MCP.
- **Theme switches repaint everything** - after `/theme` or a light/dark switch, diff previews kept the old diff palette, rows inside tool groups kept the old colors, and the spinner verb/status kept the old theme until restart. All three now follow the new theme.
- **MCP output uses the same dim color as other tools** - MCP running previews and expanded output were drawn in `toolOutput`, brighter than read, bash, grep and other tools.

### Performance

- **Each diff preview renders once** - since 1.0.80 edit, write and apply_patch rows started their Shiki render at a guessed width and rendered again once the real row width was known. On resume every diff row paid twice. Rows now wait for their width: half the diff renders, and the first frame of a 60-row tool history dropped from about 37 ms to 8 ms in the benchmark.

## 1.0.88 — 2026-10-19

### Added

- **`diffLayout` setting** ([#34](https://github.com/FammasMaz/pi-cc-tools/issues/34)) - `"auto"` (default) keeps the current behavior and uses split view only when it fits without heavy wrapping. `"split"` always shows side-by-side diffs when both code columns fit, and `"unified"` always stacks them. Applies to `edit`, `write` and `apply_patch` previews.

### Fixed

- **Finished edits keep their diff after resume, expand and resize** (Jerry, [#37](https://github.com/FammasMaz/pi-cc-tools/pull/37), fixes [#35](https://github.com/FammasMaz/pi-cc-tools/issues/35)) - edits are located once before they run and their start lines are saved in the result details, so a resumed session redraws the same diff at the same line numbers instead of only the stats line, and expanding or resizing no longer drops back to line 1. Sessions saved before this change are located from the patch Pi already stores with each edit result.

## 1.0.87 — 2026-10-19

### Fixed

- **Expanding image reads no longer crashes Pi** — clear the image-source reuse cache together with the hidden image components when a `read` result is collapsed. Re-expanding standalone or grouped image reads now creates valid image components instead of reusing a missing component and throwing `TypeError: Cannot read properties of undefined (reading 'render')`.

## 1.0.86 — 2026-10-08

### Fixed

- **Display-math scanning no longer splits fenced blocks on `$$` and `\[ … \]`** (Perry Trolard, [#33](https://github.com/FammasMaz/pi-cc-tools/issues/33)) - paragraph rebuilding now respects the same Markdown code regions as inline math formatting, so `$$` (shell PID) and `\[ … \]` (grep/ripgrep char-class regexes) inside ```` ``` ```` fences and inline code stay literal instead of cutting the block into a math segment.

## 1.0.83 — 2026-09-07

### Fixed

- **Support Pi 0.85+ MouseRegion-wrapped thinking blocks** — unwrap `MouseRegion` containers in `replaceHiddenThinkingPlaceholders` and the assistant message Markdown post-processor. Resolves an issue in newer Pi versions where thinking blocks were rendered in raw italics and collapsed thoughts remained stuck on "Thinking…" instead of transitioning to "Thought for Xs". Preserves native Pi 0.85 mouse click-to-expand and click-to-collapse functionality.

## 1.0.80 — 2026-08-24

### Fixed

- **Scrub Magic Context tags at the terminal writer** — last-resort display filter at the `ProcessTerminal.write` choke point removes every complete `§N§` token from painted output, covering any surface the targeted render strips can't reach: mid-sentence tag references in ctx_reduce/system-reminder tool output, replayed history on resume, overlays, and search hits. Display only — session storage, LLM context, copy sources, and ANSI sequences are untouched, so plugin functionality is unaffected.

## 1.0.79 — 2026-08-23

### Fixed

- **Hide Magic Context tags in tool output** — tool result renderers now receive sanitized text, so transient `§N§` tags (including live-prefixed streaming chunks and queued ctx_reduce output replayed from history) no longer appear in tool rows. Storage is never mutated — result blocks are cloned only when a tag is present, so context management keeps its data. Also covers the `formatToolExecution` fallback path for renderer-less tools.

## 1.0.78 — 2026-08-22

### Fixed

- **Hide transient Magic Context tags** — dynamically filter Magic Context tags (like `§N§`) from all Markdown view components in the Terminal UI. This covers thinking blocks, user messages, assistant prose, and subagent frames, without mutating the underlying message text content or breaking LLM prompt tracking.

## 1.0.77 — 2026-08-21

### Fixed

- **Dynamic Turn Took lines** — the end line `✻ Turn took xs` is now rendered dynamically in the Terminal UI instead of being baked into the message text content. This avoids polluting saved session databases and other UIs (like VSCode or web interfaces), and prevents interference with tools like TPS counters that read the message text.

## 1.0.76 — 2026-08-07

### Fixed

- **Hide transient context tags** — hide transient context tags in streaming prose.

## 1.0.85 — 2026-09-07

### Fixed

- Preserve Markdown code literals while formatting inline mathematics.
- Keep assistant presentation state out of canonical session messages so compacted sessions can replay safely.
- Respect `bashOutputMode` for completed Bash output.
- Preserve native prompt metadata in wrapped core tools.
- Harden spinner cleanup when Pi replaces a stale UI context.

## Unreleased

### Fixed

- **Grouped Bash commands show live progress** (Raine Virta) - collapsed running Bash rows display their latest non-empty output line beneath the command.
- **Final timing status stays presentation-only** (Raine Virta) - the `Turn took` line renders as a styled TUI component without adding ANSI escapes or display text to persisted assistant messages.

## 1.0.75 — 2026-07-29

### Fixed

- **Herdr progress with spinner verbs** — themed working messages (`Cooking…`, `Syncing…`, …) no longer break [herdr](https://herdr.dev) agent progress. Stock herdr pi screen detection only matches literal `Working...`; when `HERDR_ENV=1` the spinner now reports `working` / `idle` over herdr’s socket (same `herdr:pi` lifecycle authority as the official pi integration). Spinner UI and verbs are unchanged. Outside herdr the extension is a no-op for this path.

## 1.0.74 — 2026-07-18

### Fixed

- **Grouped tool boxes keep Agent breathe aligned** — group rows strip all breathe glyphs (including `·` and the blank off-phase) before re-prefixing a fresh light, so titles no longer walk sideways. Group header/child lights also follow the shared blink phase (and Agent breathe) instead of wall-clock `isBlinkOn()`.

## 1.0.73 — 2026-07-18

### Fixed

- **Agent rows align with other tools again** — removed the extra leading indent that only applied to Agent-family tool rows.
- **Agent breathe stays centered** — drop double-width `⬤` (it walked the baseline). Cycle is now single-cell glyphs `● → • → · → (invisible) → · → •` so the optical center never moves.

## 1.0.72 — 2026-07-18

### Changed

- **Agent tools breathe** — `Agent` / subagent tools use a size cycle while pending instead of the ordinary on/off `●` blink, so agent work reads as a different kind of tool.

## 1.0.71 — 2026-07-18

### Fixed

- **Long-running tools no longer freeze their status dots** — the 15s stale watchdog was treating quiet tools (no `tool_execution_update`) as leaked and killing the blink timer mid-run. While an agent is live the timer now heartbeats itself; stale cleanup only runs after the agent finishes. Also stop clearing blink state on `turn_end` (turns end before tools run).

## 1.0.70 — 2026-07-17

### Fixed

- **Live tool status dots blink again while commands stream** — partial tool rows re-arm the blink timer from both the call header and the live preview path, and `tool_execution_update` keeps the 15s stale watchdog from killing blink mid-bash.
- **Interrupted / resumed tools no longer blink forever** — only tools with `executionStarted` during a live agent run count as pending. History partials (resume, compaction, `/tree`, aborted runs without a toolResult) settle to a static green/dim dot and clear blink timers on `session_start`.

### Changed

- **No more `Running...` status row** — the blinking `●` on the tool heading is the only in-flight indicator. Live non-empty line count moves to the heading as muted `(N lines)`; the body shows only the output tail while streaming.

## 1.0.69 — 2026-07-17

### Changed

- **Package rename** — npm package is now `pi-claude-code-ui` (was `pi-claude-style-tools`). Install with `pi install npm:pi-claude-code-ui` (or your usual npm/pi install path).
- **Claude-style status dots** — pending markers no longer fall back to a hollow outlined `○`. They now blink as a bold filled `●` that is either solid or fully gone (space-kept alignment), matching Claude Code.
- **Heavier (not huge) dots** — success/error/pending use bold `●` (not oversized `⬤`) so they read a bit larger without dominating the tool title.
- **Bare branch connectors** — tree leads use `├` / `└` with no horizontal `─` arm, including Magic Context todo overlay rows (armed `├─` / `└─` input is normalized to bare).

## 1.0.68 — 2026-07-15

### Changed

- **Snappier spinner glyphs** — loader frame interval `250ms → 170ms` so `· ✢ ✳ ✶ ✻ ✽` cycles feel more lively while working.
- **Bigger verb pool** — many more whimsical working verbs (debugging, refactoring, brainstorming, overthinking, …) so the status line repeats less often.

### Fixed

- **Stale tool-group headers / weird counts** — settled `ToolGroupComponent` rows no longer keep serving a cached header after a child tool finishes or updates. Child mutations now mark only the parent group dirty (no sibling cascade), so counts like `N running` clear immediately instead of lingering until the next tool/message.
- **Long-chat tool-group re-render cost** — fully-settled groups memoize their rendered lines and skip child walks on warm frames (scroll, spinner, expand elsewhere). This was the main remaining long-history regression vs stock pi when `groupToolCalls` is on.
- **Preview styling O(output)** — `buildPreviewText` now styles only the lines that will be shown; bash finished/collapsed paths collect a tail (or count-only) instead of materializing every non-empty line; live previews reuse the single-pass collector.
- **Todo overlay hot path** — non-todo containers bail after the first non-empty line instead of scanning every rendered line on every frame.
- **Shiki cache across turns** — `hlCache` is no longer wiped on every `turn_end` (still cleared on session shutdown / theme rebind). Repeated expand/scroll of the same diffs no longer re-highlights from scratch each turn.
- **Session map cleanup** — `WRITE_EXISTED_BEFORE` is cleared on `session_shutdown` so long-lived agent processes don’t retain per-write entries forever.

### Performance notes

Bench (`bun scripts/benchmark-tools.ts`, width 120):

| Case | baseline warm | full (this package) warm |
|------|---------------|---------------------------|
| assistant-history-120 | ~0.44 ms | **~0.09 ms** (faster than stock) |
| tool-history-120 (grouped) | ~0.43 ms | **~0.27 ms** (faster than stock) |
| tool-history-240 (grouped) | ~0.90 ms | ~1.2 ms (first-render still heavier due to outlines/diffs; warm path much closer) |

Cold/first render of rich tool chrome is still intentionally heavier than stock pi (borders, branch connectors, diff previews). Warm long-chat frames — the lag users feel while scrolling — are now at or below stock for assistant history and grouped tool history.

## 1.0.67 — 2026-07-15

### Fixed

- **Magic Context tool rendering** — `ctx_search`, `ctx_memory`, `ctx_note`, `ctx_expand`, `ctx_reduce`, and `todowrite` now use the same Claude-style tool rows as other external tools.
- **Todo overlay labels** — task IDs no longer display a leading `#`.
- **Hermes memory notice styling** — the auto-review notice now matches thinking text color and weight instead of applying additional ANSI dimming.

## 1.0.66 — 2026-07-15

### Fixed

- **Thinking presentation** — thinking text is no longer italic, visible thinking uses the `∴` marker, and collapsed “Thinking…” / “Thought for…” rows omit the marker while retaining the correct text indentation.
- **Hermes memory notice styling** — the `💾 Memory auto-reviewed and updated` notification is restyled locally as a translucent `✻ Memory auto-reviewed and updated`, without modifying the pi-hermes-memory extension.
- **Todo overlay alignment** — todo headings and task rows now have the missing indent, and their `├─` / `└─` connectors follow the configured tool branch color.

## 1.0.65 — 2026-07-01

### Fixed

- **Idle crash / "job failed" while pi sits stale** — leaked blink entries (a tool that completed without clearing, or a turn that ended without `turn_end`) kept the 500 ms blink timer re-arming forever, forcing full TUI re-renders twice a second while idle. Each re-render re-ran the layout and either tripped pi's render width-assertion (crash) or grew RSS until the OS killed pi (silent crash → Ghostty "job failed"). Added an `agent_end` clear and a 15 s staleness watchdog so leaked entries can't sustain the re-render loop.
- **Render width-assertion crash on wide content** — `clampLineWidth`/`padRenderedLineToWidth` now cap at `process.stdout.columns`, so the extension never emits a line wider than the real terminal even when pi hands it a too-wide width (e.g. content later placed in a narrower side panel).

## 1.0.64 — 2026-07-01

### Added

- **`read` on `SKILL.md` shows as `[skill]`** — paths ending in `SKILL.md` use the same `[skill]` label styling as custom skill messages (krikchaip).

### Fixed

- **Finished tool rows no longer pulse as pending after reload** — only `isPartial` marks a row pending; missing `executionStarted` on history rows no longer triggers blink timers (krikchaip).
- **Tool row backgrounds after `/reload`** — strip the outer `Box` success background ANSI on rebuilt rows so transparent/outline mode stays clean (krikchaip).
- **Unmatched partial tool calls in old branches** — partial rows without `executionStarted` show a static muted dot instead of an endless pending blink (krikchaip).
- **Partial rows at tree-navigated leaves** — when the result lives off the selected branch, blink only while an agent is actually running; settled history renders as finished (green when succeeded) (krikchaip).
- **Duplicate bash expand hint** — finished bash rows keep “expand” on the summary line only; the preserved output preview no longer repeats it (krikchaip).

## 1.0.63 — 2026-07-01

### Fixed

- **Random crash on large diffs** — rendering a large edit or `apply_patch` could throw `RangeError: Maximum call stack size exceeded`. Root cause: the split/unified diff renderers computed the max line number via `Math.max(...diff.lines.map(...))`, spreading the *entire* diff line array as function arguments — fine for small diffs, but a stack overflow on diffs with thousands of lines. Replaced with a loop-based `maxLineNumber()` that returns identical results. No visual or behavioral change.
- **Shiki import no longer leaves a dangling rejected promise** — a failed `import("@shikijs/cli")` (missing dep, transient error) previously left a permanently-rejected promise that could surface as an unhandled-rejection crash under strict modes. The loader now resets on failure so the next render retries.

### Changed

- **Lower CPU / heat during long-running bash** — the bash tool's live preview re-split and re-filtered the *entire* output on every partial update (bash throttles updates every ~100ms and the pending-dot blink re-invalidates every 500ms), scaling linearly with output size. It now collects only the visible tail lines and a total count in a single pass, so cost no longer grows with output length.
- **Bounded Shiki concurrency for multi-edit / multi-file diffs** — edit and `apply_patch` call-phase previews previously fired all syntax-highlighting jobs at once via `Promise.all`, causing CPU spikes on large multi-block diffs. They now run with a small concurrency cap (2), preserving ordered output.
- **Spinner no longer keeps running after the UI stops** — the 250ms Loader animation loop (and its `requestRender` calls) kept firing after the TUI was stopped. It now short-circuits and stops itself when the UI is stopped, so it can't keep the event loop or CPU alive as an orphan.
- **More timers `unref`'d** — the deferred chrome-rebind `setTimeout` (fired on `/resume` / `/new` / `/fork`) and the same-frame working-message `setTimeout` were not unref'd, keeping the Node event loop alive. Both now `unref` so they can't hold the process open or spin idle.

No functionality changed in this release — output is byte-identical for all existing cases; the diffs above are strictly CPU/stability improvements verified by `npm run typecheck` and `bun scripts/benchmark-tools.ts`.

## 1.0.62 — 2026-06-22

### Fixed

- **"Turn took" line no longer appears mid-stream** — the end-of-run status line was showing while the assistant was still streaming text. Root cause: the component render path gated on `message.stopReason === "stop"`, but the Anthropic provider initializes the live message's `stopReason` to `"stop"` at creation and only updates it to the real value when `message_delta` arrives near the end of the stream — so the gate was already true during streaming. The component path now gates on the `explicitDuration` flag stamped by the `message_end` handler (which fires after `message_delta`, once the real `stopReason` is known), so the line appears only after the stream truly closes. The `message_end` path was already correct (it fires post-`message_delta`); only the live component fallback was premature.

## 1.0.61 — 2026-06-22

### Changed

- **Renamed "Worked for" → "Turn took"** — the end-of-run status line now reads `✻ Turn took 2m 30s (Total time 1h 12m 30s · 14 turns)`. The session-total duration now always shows seconds and only adds minutes/hours once the session has actually lasted that long (e.g. `45s`, `12m 30s`, `1h 12m 30s`); the bracket label is now capitalized as "Total time".

## 1.0.60 — 2026-06-22

### Changed

- **"Worked for …" only on the true end of a run** — the line now appears only when the model finishes all of its turns for a prompt (`stopReason === "stop"`), instead of after every assistant message that didn't end in a tool call. Intermediate stops that pi retries through (`error`, `aborted`, `length`/max-tokens, compaction retries) no longer get a premature "Worked for" line — it shows once, when the model is actually done.
- **Session total + turn count on the Worked line** — the line now reads `✻ Worked for 2m 30s (total time 1h 12m · 14 turns)`, where the bracket is the running session-wide elapsed time and the number of prompts you've sent. Totals are seeded from the full message history, so `/resume` picks up past prompts and the original session start. `/new` resets the counters.

## 1.0.59 — 2026-06-19

### Fixed

- **Scrolling / expand lag on long chats** — every re-render (scroll, tool expand, theme tick) re-ran the per-line ANSI stripping behind copy-zone markers (`applyTerminalCopyZones`), per-line glyph normalization, and user-message border boxing for *every* message in the history. That work scaled linearly with chat length and dominated CPU on long sessions (the more messages, the slower each frame). The rendered output of assistant, user, and custom-message components is now memoized per `(width, branch-visual-epoch)` on the component instance and reused on warm re-renders, with the cache dropped whenever content actually changes (`updateContent` / `rebuild`) or the theme chrome epoch bumps. Warm re-render of a 120-message history drops from ~5.9 ms to ~0.16 ms and stays flat as the chat grows instead of scaling with it. Output is byte-identical (same rendered line counts and content); no functionality changed.

## 1.0.58 — 2026-06-17

### Fixed

- **Transparent tool rows after `/resume`** — Pi’s `ToolExecutionComponent` uses the global theme singleton for `toolPendingBg` / `toolSuccessBg` / `toolErrorBg`. Re-apply transparent overrides on that object and before every `updateDisplay()`, with extra deferred chrome rebind after history rebuild on resume/new/fork.
- **Stale tool row chrome on theme switch** — bump branch/render epoch when the active theme name or color fingerprint changes so cached tool lines pick up new palette.

## 1.0.57 — 2026-06-17

### Changed

- **Branch connectors default** — `├─` `└─` `│` use **fixed rgb(72)** unless you set `/cc-tools branch theme` or a custom gray. `/cc-tools branch reset` restores that default.

### Fixed

- **Resume / session switch theme mix** — on `session_start` (especially `resume`, `new`, `fork`), rebind tool chrome from the active pi theme (palette cache bust, Shiki light/dark, branch epoch, full UI invalidate) plus deferred passes so other extensions can `setTheme` in the same tick without cross-package coupling.
- **Hidden thinking summary** sticks on "Thinking…" when `thinking_end` lands on the same frame as Pi's `updateContent` — per-message active/duration flags plus a deferred UI refresh so "Thought for Ns" appears right away.
- **Spinner footer** applies the same deferred sync on thinking start/end so "thought for Ns" shows immediately when thinking finishes.

### Changed

- **Unified container chrome** — user message box, tool outline rules, rounded code fences, and branch connectors share one theme-derived color (`dim` → `muted` → `borderMuted`) so light themes do not get harsh dark user borders or overly bright branches.
- **User message fill** — strip nested `Box` → `Markdown` backgrounds so the framed user row stays transparent and matches terminal chrome (fixes dark slabs inside the border).
- **Light-theme branch chrome** — when the active theme has a light panel, outline/branch colors are attenuated toward mid-gray so `├─` `└─` `│` and user borders are not washed-out bright; `/cc-tools status` no longer implies theme mode uses fixed gray 72.

## 1.0.56 — 2026-06-17

### Fixed

- **Theme-adaptive tool chrome** re-derives when the active pi theme’s resolved colors change (fingerprint of `success`, `borderMuted`, `accent`, etc.), not only when the theme object identity changes. Fixes stale borders/dots/diffs after external theme sync (e.g. Ghostty) without coupling to other extensions.

### Changed

- Palette cache tracks `theme.name` plus color fingerprint; removed cross-extension global bust symbols.

## 1.0.55 — 2026-06-17

- Internal: theme name in cache key (superseded by 1.0.56 fingerprint).

## 1.0.54 — 2026-06-17

### Changed

- **Branch connectors** (`├─` `└─` `│`): default **`theme`** mode (was fixed gray). Uses **dim → muted → thinkingText**, same family as thought/gray prose.
- **Pending tool dots** (○): use theme **dim** when theme-adaptive; grouped counts use the same pending color.

### Fixed

- `/cc-tools branch reset` restores theme-following default, not fixed rgb(72).

## 1.0.53 — 2026-06-17

### Fixed

- **Light theme edit/write diffs**: auto-select Shiki `github-light` vs `github-dark`; light panel tint base; Shiki contrast normalization for light backgrounds.
- **Light theme tool status chrome**: pending ○ / blink uses softer `borderMuted` instead of heavy `muted`; grouped tool pending counts match.

## 1.0.52

- Theme-adaptive diff and branch tooling updates.