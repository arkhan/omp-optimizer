# omp-optimizer

Token-optimization suite for [oh-my-pi](https://github.com/oh-my-pi) — a local
port of [`@xynogen/pix-optimizer`](https://github.com/xynogen/pix-mono/tree/main/packages/pix-optimizer)
off the upstream `pi.dev` coding agent. Five tools wired into one extension via
`src/index.ts`, fronted by a single `/optimizer` command and one shared
status-bar cell:

- **Caveman** (`Cv`) — terse-output system prompt
- **RTK** (`Rk`) — prefixes shell commands with `rtk` + injects RTK prompt
- **Ponytail** (`Pt`) — lazy-senior-dev system prompt (minimal code, YAGNI)
- **Engram** (`En`) — automatic memory recall on `session_start` and retain on
  compaction, via the local Engram HTTP server (`:7437`); on/off toggle
- **Title** (`Tt`) — background session titles from the first user prompts;
  on/off toggle

All five persist to `~/.omp/agent/optimizer.json` and toggle through the same
`/optimizer` command. Since v2.0.0 this package also absorbs a third
formerly standalone plugin:

- **omp-skills** — 39 workflow skills under `skills/` (auto-discovered by omp's
  skill provider) + live `` !`cmd` `` directive interpolation on `skill://` reads

## Command

One command opens an interactive overlay that fronts every tool:

```text
/optimizer                 → pick a tool, then pick its value (native select dialogs)
/optimizer status          → plain-text summary of all five tools
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

A single cell always shows all five tool icons in a fixed left-to-right order,
color-coded by state: **accent** when the tool is enabled, **dim** when
disabled. The cell is never empty. Engram's icon is accent only when BOTH
enabled and memory was actually loaded this session (dim if disabled or the
Engram server is unreachable).

Icons are static ASCII glyphs (`Cv`, `Rk`, `Pt`, `En`, `Tt`) — the upstream
`pix-pretty` nerd-font/unicode icon catalog was dropped in this port (it was an
external dependency not available to omp extensions). No configuration knob;
if a themed icon set matters, extend `TOOL_ICON_ASCII` in `src/status.ts`.

## Features

### Caveman Mode (`Cv`)

Cuts output tokens while keeping full technical accuracy — savings are workload-dependent,
not a fixed percentage: heaviest on prose-style explanations (fluff/hedging/filler removed),
much smaller on agentic coding turns where code blocks, diffs, and tool output already stay
verbatim and uncompressed. No independent measurement has been run for this fork.

| Level | Description                  |
|-------|------------------------------|
| lite  | Professional, no fluff       |
| full  | Classic caveman              |
| ultra | Maximum compression          |
| micro | Experimental prompt-minimized |

Toggle from the `/optimizer` overlay. Default level for new sessions is
restored from `~/.omp/agent/optimizer.json`.

### RTK Tool Rewriting (`Rk`)

Execute layer only — rewrites `bash` tool calls, prefixing known commands
(`git`, `gh`, `cargo`, `npm`, `pnpm`, `docker`, `kubectl`, `ls`, `grep`, …)
with `rtk` when the model forgets. **Command chains are split on `&&`,
`||`, `;` and `|`, and every known segment is prefixed** — e.g.
`git add . && git push` becomes `rtk git add . && rtk git push`.
Operators inside quotes are ignored, and unparseable commands are left
untouched. Falls back gracefully when the `rtk` binary is missing
(warns once). No system-prompt injection — the rewrite alone is zero
always-on context cost (matches upstream 1.1.28; see sync note below).

Also blocks `sudo` segments in bash chains before rewriting — redirects the
model to a `sudo_run` tool when active tools include one, otherwise explains
the restriction. This intercept is unconditional (independent of the RTK
on/off toggle would be more correct upstream behavior, but currently ships
inside the same `tool_call` hook — see `src/rtk.ts`).

**Requirement:** the `rtk` binary must be on `PATH`.

```bash
cargo install rtk-ai
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
| `src/index.ts`    | Wires all five tools + shared status, registers `/optimizer` |
| `src/opt.ts`      | The `/optimizer` command (native select dialogs + text args) |
| `src/status.ts`   | Shared status-bar cell (static ASCII `toolIcon()`)       |
| `src/caveman.ts`  | Caveman logic, levels, prompt                            |
| `src/rtk.ts`      | RTK prompt + bash command rewriting + sudo intercept     |
| `src/ponytail.ts` | Ponytail logic, levels, prompt                           |
| `src/engram.js`   | Engram memory recall + on/off toggle handle              |
| `title.bundle.js` | Prebuilt omp-title bundle, gated on/off in `index.ts`    |
| `src/persist.ts`  | Disk-backed `~/.omp/agent/optimizer.json` persistence    |
| `src/tool-result-filter.ts` | Strips model-guidance warnings from tool_result |
| `skills/toon-json/SKILL.md` | jq+TOON JSON workflow — standalone skill, no optimizer state |

Each tool registers its own lifecycle hooks and exposes an `OptimizerHandle`
that `/optimizer` dispatches to. All five share one `OptimizerStatus`.

## Differences from upstream `pix-optimizer`

Sync state: feature-parity with upstream **1.1.29** (forked at 1.1.14).
Upstream 1.1.15–1.1.18 reviewed 2026-07-24 (see prior note, unchanged).
1.1.19–1.1.24 reviewed 2026-08-11: the only functional delta is 1.1.22's
`refactor(pix-optimizer): move toon guidance to skills` — upstream deleted
`json.ts`, the `toon` tool/icon/state, and the `pix.json` `toon` config key
entirely, since the bundled `toon-json` skill (auto-discovered, on-demand)
made the heuristic-triggered system-prompt injection redundant. Ported here:
`src/json.ts`/`json.test.ts` deleted, `toon`/`Tn` removed from
`OptimizerTool`/`TOOL_ORDER`/both icon catalogs/`/optimizer`'s tool list/
`optimizer.json` schema — this port carries the exact same redundancy
upstream identified (the `toon-json` skill was already bundled and
auto-discovered here too), so the same deletion applies verbatim. The rest
of 1.1.19–1.1.24 (UI menu spacing, `pix-pretty` height-aware modal overlays
with pagination/diff-tints, Kitty keyboard-protocol support in the custom
overlay, cross-package dedup, theme unification, a dependency-pin sync) is
`opt.ts`'s original custom-overlay/raw-keyboard-handling infrastructure and
the external `pix-pretty` theming package — this port replaced the overlay
with omp's native `ctx.ui.select` dialogs (no raw key parsing) and dropped
`pix-pretty` entirely (see below), so none of it has an equivalent surface
here.

1.1.25–1.1.29 reviewed 2026-09-03: one real functional delta, 1.1.28's
`fix(pix-pretty): dim gate-overlay values; drop RTK always-on prompt` —
upstream deleted `RTK_SYSTEM_PROMPT` from `rtk.ts` entirely, since the
`tool_call` rewrite hook already adds the `rtk` prefix on its own, making
the always-on prompt injection redundant baseline context (manual `rtk
err`/`summary`/`log`/`json`/`test`/`gain` subcommands are no longer
advertised — same tradeoff upstream made for `toon` in 1.1.22). Ported
here: `RTK_SYSTEM_PROMPT` deleted, `before_agent_start` now only detects
`sudo_run` availability and injects nothing — this port's own copy of the
constant was already leaner than upstream's pre-1.1.28 version (upstream's
had a full "prefix with rtk" preamble + chain example; this port's only
advertised the manual filtering subcommands), but the same redundancy
argument applies verbatim once the execute layer is the sole rewriter.
The rest of 1.1.25–1.1.29 (a `dim`→`muted` theme-color-tier rename across
every pix-pretty-consuming package's status/overlay rendering, a
`pix-sec` design-doc addition, and two release-chore/bun.lock-dedup
commits) is `pix-pretty` theme-token surface this port never carried
(status icons are static ASCII, the `/optimizer` overlay is native
`ctx.ui.select`, neither calls `theme.fg()`) or unrelated new-package
planning — no equivalent surface here.

Caveman prompt text (`src/caveman.ts` `BASE`/`SAFETY`) separately tracks
[`JuliusBrussee/caveman`](https://github.com/JuliusBrussee/caveman) (the
original Claude Code skill this mode's wording is modeled on — distinct
lineage from `pix-optimizer`/`pi-caveman` above). Synced through commit
`a010997` (2026-08-11), then again against `main` HEAD post-v2.2.0
(2026-08-20, repo tags v2.1.0/v2.2.0 — both releases are CLI/installer/
hooks-infra work, no `SKILL.md` wording changes of their own; the delta
below was a separate main-branch drift found by diffing current HEAD). On
top of the prior v1.10.0 sync: added `only`/`except` to the never-drop-negation
list plus an explicit numbers/units-exact rule, widened tool-call silence to
cover narration *between* calls with an explicit clarify/warn/ambiguity
exception, added a "never recap normal-then-Caveman:" self-reference guard
with an explicit exception for direct questions about the active mode, a
guard against classical (wenyan) characters leaking into non-wenyan levels,
and widened the persisted-text boundary to explicitly cover code comments
and messages to other agents/peers (this port's `hub` messaging). 2026-08-20
delta: ported a "never add words to sound caveman" anti-mangling rule (no
inserted pronoun/copula to fake broken grammar, keep the correct verb form
when it costs the same token count — mangling buys nothing, reads worse;
same "shorter-or-plain" test already applied to abbreviations/arrows).
Reviewed PR JuliusBrussee/caveman#782 ("feat(install): add native OMP
support", open, unmerged as of 2026-08-20): installer-only, no prompt-text
surface — it wires `~/.omp/caveman-plugin` as a managed plugin whose only
extension code is a `session_start` status-bar setter, with the actual
guidance delivered via a copied `rules/caveman.md` (raw `src/rules/
caveman-activate.md`, no frontmatter/glob, no `Precedence:` clause) and
skill/command/agent dirs — no `before_agent_start`-equivalent hook, so it
cannot guarantee same-tier system-prompt injection every turn the way this
port's `caveman.ts` does, and it ships none of the harness-specific
`Precedence:` fix documented above (upstream has no visibility into omp's
own Evidence/Completeness/Reasoning-Format system-prompt contract this port
patches against). Not a reason to change this port's own hook-based design.
Upstream shipped **Caveman 2.0.0** (`82864c8`, "engine, proxy, SDKs, unified
CLI") between the a010997 sync and this one — a Go proxy/engine, CCR
recovery store, and `@caveman-ai/cli`/SDK surface that shrinks *input*
tokens ahead of the provider call. Reviewed and confirmed inapplicable: this
port only ever carried the pure system-prompt-injection skill (output-side),
no proxy, no CLI, no engine — there is no equivalent surface here to extend.
Re-diffed `skills/caveman/SKILL.md` at `main` HEAD 2026-09-03: no wording
drift since the 2026-08-20 sync above — every current paragraph already
has a ported equivalent in `BASE`/`SAFETY` (the only unported bits remain
the previously-reviewed-and-skipped `/caveman-compress`-exempt clause and
"open a defect = open issue" wording, neither mapping to anything here).

Ponytail prompt text (`src/ponytail.ts` `BASE`/`SAFETY`) separately tracks
[`DietrichGebert/ponytail`](https://github.com/DietrichGebert/ponytail)'s
`.openclaw/skills/ponytail/SKILL.md`. First version-pinned sync: 2026-08-11,
`main` HEAD. Added a `Persistence:` line (drift-back-to-over-building guard,
mirroring Caveman's own) that was missing from this port entirely; widened
the never-simplify-away rule with an explicit "user insists on full version →
build it, no re-arguing" override; widened the self-check rule with "no
fixtures, no per-function suites unless asked" (guards against test bloat
under this harness's own verification mandate); and expanded the terse-output
rule with an explicit essay/feature-tour/design-note ban plus the converse —
explanation the user explicitly asked for (a report, a walkthrough, phase
notes) is not debt and prints in full — plus the upstream `Pattern:` line,
all missing from this port before. Upstream's mode-filtering/hook-infra fixes
(`filterSkillBodyForMode`, the `ponytail:` marker scanner, rejecting `review`
as a default mode) belong to the 20-agent plugin/hook surface this port never
carried (no modes beyond lite/full/ultra, no hook-side marker scanning) — no
equivalent surface exists here to update. Re-diffed at `main` HEAD
2026-09-03: two more concrete deltas ported — the `ponytail:` comment
bullet now names example ceiling categories (global lock/O(n²) scan/naive
heuristic) plus a concrete `# ponytail: global lock, per-account locks if
throughput matters` example (previously generic, "names the ceiling and
upgrade path" with no example); and the self-check rule now closes with
"YAGNI applies to tests too", making explicit that the trivial-one-liners-
need-no-test exemption is the same laziness principle as the rest of the
skill, not a separate carve-out.

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
