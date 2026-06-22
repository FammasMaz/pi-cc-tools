# Changelog

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