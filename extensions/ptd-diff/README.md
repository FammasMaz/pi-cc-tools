# ptd-diff — diff rendering ported from pi-tool-display

The eight `.ts` files in this directory are **verbatim, byte-identical copies** from
[`pi-tool-display@0.5.0`](https://github.com/MasuRii/pi-tool-display) (MIT, © 2026 MasuRii —
see `LICENSE` in this directory):

- `diff-renderer.ts`
- `diff-presentation.ts`
- `line-width-safety.ts`
- `ansi-utils.ts`
- `pending-diff-preview.ts`
- `render-utils.ts`
- `write-display-utils.ts`
- `types.ts`

Rule: do NOT edit these files. Renderer behavior must stay 1:1 with upstream
pi-tool-display; verify with `npm run test:parity`, which compares this copy's render
output line-by-line against the installed `pi-tool-display` package. To sync with a newer
pi-tool-display, re-copy the files wholesale and re-run parity.

Integration glue (config adaptation, chrome bridging) lives in `extensions/index.ts`,
never here.
