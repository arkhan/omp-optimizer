# omp-optimizer

Token-optimization suite for [oh-my-pi](https://github.com/oh-my-pi) — a local
port of [`@xynogen/pix-optimizer`](https://github.com/xynogen/pix-mono/tree/main/packages/pix-optimizer)
off the upstream `pi.dev` coding agent. Six tools wired into one extension via
`src/index.ts`, fronted by a single `/optimizer` command and one shared
status-bar cell:

- **Caveman** (`Cv`) — terse-output system prompt
- **RTK** (`Rk`) — prefixes shell commands with `rtk` + injects RTK prompt
- **TOON** (`Tn`) — jq + TOON guidance for dense JSON (bundled `toon-json` skill)
- **Ponytail** (`Pt`) — lazy-senior-dev system prompt (minimal code, YAGNI)
- **Engram** (`En`) — automatic memory recall on `session_start` and retain on
  compaction, via the local Engram HTTP server (`:7437`); on/off toggle
- **Title** (`Tt`) — background session titles from the first user prompts;
  on/off toggle

All six persist to `~/.omp/agent/optimizer.json` and toggle through the same
`/optimizer` command. Since v2.0.0 this package also absorbs a third
formerly standalone plugin:

- **omp-skills** — 39 workflow skills under `skills/` (auto-discovered by omp's
  skill provider) + live `` !`cmd` `` directive interpolation on `skill://` reads

## Command

One command opens an interactive overlay that fronts every tool:

```text
/optimizer                 → pick a tool, then pick its value (native select dialogs)
/optimizer status          → plain-text summary of all six tools
/optimizer <tool>          → current value + valid values for that tool
/optimizer <tool> <value>  → set directly (headless-safe)
```

v1 used a custom overlay widget (`ui.custom`) — under omp it rendered but
never received keystrokes, so it was replaced. omp exposes no
extension-contributed settings section (its ExtensionDashboard is
enable/disable toggles only), so the interactive path uses omp's native
`ctx.ui.select` dialogs. Every path ends in the tool's `run()` handler, which
persists the new value and repaints the shared status cell.

State persists to `~/.omp/agent/optimizer.json`, keyed by tool name. Each tool
reads its saved value on `session_start` and writes it on every `/optimizer`
change.

## Status bar

A single cell always shows all six tool icons in a fixed left-to-right order,
color-coded by state: **accent** when the tool is enabled, **dim** when
disabled. The cell is never empty. Engram's icon is accent only when BOTH
enabled and memory was actually loaded this session (dim if disabled or the
Engram server is unreachable).

Icons are static ASCII glyphs (`Cv`, `Rk`, `Tn`, `Pt`, `En`, `Tt`) — the upstream
`pix-pretty` nerd-font/unicode icon catalog was dropped in this port (it was an
external dependency not available to omp extensions). No configuration knob;
if a themed icon set matters, extend `TOOL_ICON_ASCII` in `src/status.ts`.

## Features

### Caveman Mode (`Cv`)

Cuts ~75% of output tokens while keeping full technical accuracy.

| Level | Description                  |
|-------|------------------------------|
| lite  | Professional, no fluff       |
| full  | Classic caveman              |
| ultra | Maximum compression          |
| micro | Experimental prompt-minimized |

Toggle from the `/optimizer` overlay. Default level for new sessions is
restored from `~/.omp/agent/optimizer.json`.

### RTK Tool Rewriting (`Rk`)

Two layers, both active automatically:

1. **Prompt layer** — injects the RTK system prompt (tells the model to
   prefix commands with `rtk`).
2. **Execute layer** — rewrites `bash` tool calls, prefixing known commands
   (`git`, `gh`, `cargo`, `npm`, `pnpm`, `docker`, `kubectl`, `ls`, `grep`, …)
   with `rtk` when the model forgets. **Command chains are split on `&&`,
   `||`, `;` and `|`, and every known segment is prefixed** — e.g.
   `git add . && git push` becomes `rtk git add . && rtk git push`.
   Operators inside quotes are ignored, and unparseable commands are left
   untouched. Falls back gracefully when the `rtk` binary is missing
   (warns once).

Also blocks `sudo` segments in bash chains before rewriting — redirects the
model to a `sudo_run` tool when active tools include one, otherwise explains
the restriction. This intercept is unconditional (independent of the RTK
on/off toggle would be more correct upstream behavior, but currently ships
inside the same `tool_call` hook — see `src/rtk.ts`).

**Requirement:** the `rtk` binary must be on `PATH`.

```bash
cargo install rtk-ai
```

### TOON / JSON Compression (`Tn`)

Guidance for handling information-dense JSON via `jq` (query/reshape) and
`toon` (compress). The system-prompt nudge is injected **only when the user
prompt mentions JSON** (`json`/`jsonl`/`jq`/`toon`/`openapi`/…). TOON shines
on uniform/tabular arrays; deeply nested or array-of-arrays data and API
contracts stay as JSON.

The full workflow (when-to-use / when-NOT-to-use, worked examples) lives in
the bundled `toon-json` skill (`skills/toon-json/SKILL.md`), auto-discovered
by omp's `omp-plugins` skill provider when this package is loaded as an
extension.

**Requirement:** `jq` and `toon` on `PATH`.

```bash
npm i -g @toon-format/cli   # or: bun add -g @toon-format/cli
```

### Ponytail Mode (`Pt`)

"Lazy senior dev" mode. Governs **what** the agent builds (minimal code,
YAGNI), orthogonal to Caveman which governs **how** it talks — they pair. Before
writing code the agent stops at the first rung that holds: does this need to
exist → stdlib → native platform → installed dep → one line → minimum that
works. Validation, error handling, security, and accessibility are never cut.

| Level | Description                          |
|-------|--------------------------------------|
| lite  | Name the lazier alternative, you pick |
| full  | The ladder enforced (default)        |
| ultra | YAGNI extremist                      |

**No install required** — pure prompt injection, no external binary or PATH
dependency (unlike RTK and TOON).

## Installation

This package targets local/project use — it is not published to npm. Point
omp at it with an explicit extension path or the `extensions:` setting:

```bash
omp --extension /path/to/omp-optimizer/src/index.ts
```

```yaml
# ~/.omp/agent/config.yml or <repo>/.omp/config.yml
extensions:
  - /path/to/omp-optimizer/src/index.ts
```

Loading through `extensions:`/`--extension` also makes the `omp-plugins`
capability provider pick up `skills/toon-json/` automatically — no separate
skill registration needed.

## Architecture

| File              | Role                                                      |
|-------------------|-----------------------------------------------------------|
| `src/index.ts`    | Wires all six tools + shared status, registers `/optimizer` |
| `src/opt.ts`      | The `/optimizer` command (native select dialogs + text args) |
| `src/status.ts`   | Shared status-bar cell (static ASCII `toolIcon()`)       |
| `src/caveman.ts`  | Caveman logic, levels, prompt                            |
| `src/rtk.ts`      | RTK prompt + bash command rewriting + sudo intercept     |
| `src/json.ts`     | jq+TOON guidance, heuristics, system-prompt injection    |
| `src/ponytail.ts` | Ponytail logic, levels, prompt                           |
| `src/engram.js`   | Engram memory recall + on/off toggle handle              |
| `title.bundle.js` | Prebuilt omp-title bundle, gated on/off in `index.ts`    |
| `src/persist.ts`  | Disk-backed `~/.omp/agent/optimizer.json` persistence    |
| `src/tool-result-filter.ts` | Strips model-guidance warnings from tool_result |
| `skills/toon-json/SKILL.md` | Full jq+TOON workflow reference           |

Each tool registers its own lifecycle hooks and exposes an `OptimizerHandle`
that `/optimizer` dispatches to. All six share one `OptimizerStatus`.

## Differences from upstream `pix-optimizer`

Sync state: feature-parity with upstream **1.1.18** (forked at 1.1.14).
Upstream 1.1.15–1.1.18 reviewed 2026-07-24: 1.1.17's portable capability
probes (`canExecute` for jq/toon/rtk) already ported; 1.1.18 only removed the
pix-data `pix.json` fallback this port never had; the rest is biome
formatting, intentionally not imported.

Ported to omp's `ExtensionAPI` (`@oh-my-pi/pi-coding-agent`), which differs
from upstream `pi-coding-agent` in ways that required real code changes, not
just an import-scope rename:

- `BeforeAgentStartEventResult.systemPrompt` (array-return, old omp API) is
  gone from the currently installed SDK — the old `{ systemPrompt: [prompt] }`
  return from every hook was silently dropped (checked, wasn't a bug on the
  config/rules side: `optimizer.json` values were correct, the hook return
  just no longer matched the SDK contract). Fixed: every hook now returns
  `{ systemPromptAppend: prompt }` — a plain string, auto-concatenated across
  hooks by the runner (see `pi-coding-agent`'s `examples/extensions/pirate.ts`
  + its `CHANGELOG.md`). No manual `event.systemPrompt ?? ""` merging needed.
- `event.systemPromptOptions?.selectedTools` does not exist on omp's
  `BeforeAgentStartEvent`. `rtk.ts` detects `sudo_run` availability via
  `pi.getActiveTools()` instead.
- Dropped the `@xynogen/pix-pretty` icon catalog and `@xynogen/pix-data`
  config-seeding dependencies (external to omp, not installable). Icons are
  static ASCII; `~/.omp/agent/pix.json` initial-value seeding was removed —
  `optimizer.json` is now the only source of truth.
- The `/optimizer` command's original overlay widget (`ui.custom`, with a
  local plain-ASCII `frameLines` port) rendered but never received keyboard
  input under omp — replaced with native `ctx.ui.select` dialogs + a
  text-arg form (see Command section above).

## Development

```bash
bun test
```

## Origin

This package was built by merging two upstream Pi community packages
(via `@xynogen/pix-optimizer`, see its own README for full lineage):

- **Caveman mode** — originally from `npm:pi-caveman`.
- **RTK rewriting** — originally from `npm:pi-rtk-optimizer`.
- **Ponytail mode** — ruleset adapted from
  [`git:github.com/DietrichGebert/ponytail`](https://github.com/DietrichGebert/ponytail).

All upstreams are MIT licensed.

## License

MIT
