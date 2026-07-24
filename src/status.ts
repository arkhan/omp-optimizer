/**
 * status.ts — shared status-bar indicator for the optimizer suite.
 *
 * caveman / rtk / toon / ponytail / engram / title each toggle independently,
 * but they're all the same class of thing (token/workflow optimization
 * tools), so they share ONE status cell instead of six. Each tool reports its
 * on/off state into a single registry; the cell renders ALL six icons in a
 * fixed order — accent-colored when the tool is enabled, dim when disabled.
 * The cell is never empty.
 *
 *   all on:        all six accent
 *   caveman off:   caveman dim, rest accent
 *   all off:       all six dim
 */

import type {
	ExtensionCommandContext,
	ExtensionContext,
	SymbolPreset,
	ThemeColor,
} from "@oh-my-pi/pi-coding-agent";

const TOOL_ICON_ASCII: Record<OptimizerTool, string> = {
	caveman: "Cv",
	rtk: "Rk",
	toon: "Tn",
	ponytail: "Pt",
	engram: "En",
	title: "Tt",
};

// v1 used Enclosed Alphanumerics (Ⓒ Ⓡ Ⓣ Ⓟ) — confirmed broken (tofu) in the
// user's terminal font: that block has spotty monospace-font coverage.
// Swapped for older/emoji glyphs confirmed to render there (engram's 🧠
// notify already displays fine), one per tool, in TOOL_ORDER:
//   caveman ⛏️ rtk 🗡️ toon </> (plain ascii, no glyph risk) ponytail ✂️
//   engram 🧠 title ✍️
// Nerd font catalog still never ported (see index.ts) — nerd preset falls
// back to this same set.
const TOOL_ICON_UNICODE: Record<OptimizerTool, string> = {
	caveman: "⛏️",
	rtk: "🗡️",
	toon: "</>",
	ponytail: "✂️",
	engram: "🧠",
	title: "✍️",
};

/** Set by `OptimizerStatus.paint()` from the live theme so icons follow the
 * user's global `symbolPreset` setting without a separate toggle/command. */
let activePreset: SymbolPreset = "unicode";

/**
 * Each optimizer tool exposes a handle so the `/optimizer` command can list
 * it, show its current value, and apply a chosen value without knowing the
 * tool's internals.
 */
export interface OptimizerHandle {
	/** Tool name, e.g. "caveman" / "rtk" / "toon" / "engram" / "title". */
	name: OptimizerTool;
	/** One-line summary shown in the command's status/help output. */
	help: string;
	/** Selectable values for this tool, in display order. */
	values: readonly string[];
	/** Current value string (must be one of `values`). */
	current(): string;
	/** Apply a chosen value (persists + repaints status). `value` is one of `values`. */
	run(value: string, ctx: ExtensionCommandContext): Promise<void> | void;
}

/** Stable status-bar key shared by every optimizer tool. */
export const STATUS_KEY = "pix-optimizer";

/** Tools that participate in the shared indicator, in render order. */
export type OptimizerTool =
	| "caveman"
	| "rtk"
	| "toon"
	| "ponytail"
	| "engram"
	| "title";

/** Glyph for a tool, resolved against the last-seen `symbolPreset` (ascii stays plain text; unicode/nerd use the emoji set — see ceiling note above). */
export function toolIcon(tool: OptimizerTool): string {
	return activePreset === "ascii" ? TOOL_ICON_ASCII[tool] : TOOL_ICON_UNICODE[tool];
}

/** Fixed left-to-right order of icons in the cell. */
const TOOL_ORDER: readonly OptimizerTool[] = [
	"caveman",
	"rtk",
	"toon",
	"ponytail",
	"engram",
	"title",
];

/** Theme color for enabled icons. */
const ENABLED_COLOR: ThemeColor = "accent";
/** Theme color for disabled icons. */
const DISABLED_COLOR: ThemeColor = "dim";

/** Colorizer: maps a (theme color, text) pair to a rendered string. */
export type Colorize = (color: ThemeColor, text: string) => string;

/**
 * Build the colored status string for a set of tool states. ALL tool icons are
 * always shown, in TOOL_ORDER; each is accent-colored when its tool is enabled
 * and dim when disabled. Glyphs resolve against the active global icon mode.
 * `color` applies the theme color (e.g. theme.fg).
 *
 * Pure + exported for tests (pass a tagging colorizer to assert per-icon color).
 * A trailing space separates the cell from the next status segment.
 */
export function renderStatus(
	states: Partial<Record<OptimizerTool, boolean>>,
	color: Colorize,
): string {
	return `${TOOL_ORDER.map((t) =>
		color(states[t] === true ? ENABLED_COLOR : DISABLED_COLOR, toolIcon(t)),
	).join("  ")} `;
}

/**
 * Shared registry: each tool calls `set(tool, enabled)` whenever its state
 * changes, then the combined cell is re-rendered. A single registry instance
 * is created per extension load and passed to every tool module.
 */
export class OptimizerStatus {
	private states: Partial<Record<OptimizerTool, boolean>> = {};
	/** Latest ui ctx seen, so an icon-mode change can repaint without a toggle. */
	private lastCtx: Pick<ExtensionContext, "ui"> | undefined;

	/** Current enabled state for one tool (undefined until first set). */
	get(tool: OptimizerTool): boolean | undefined {
		return this.states[tool];
	}

	/** Update one tool's enabled state and repaint the shared cell. */
	set(
		tool: OptimizerTool,
		enabled: boolean,
		ctx: Pick<ExtensionContext, "ui">,
	): void {
		this.states[tool] = enabled;
		this.paint(ctx);
	}

	/** Repaint the shared cell from current states. */
	paint(ctx: Pick<ExtensionContext, "ui">): void {
		this.lastCtx = ctx;
		activePreset = ctx.ui.theme.getSymbolPreset?.() ?? activePreset;
		const text = renderStatus(this.states, (c, t) => ctx.ui.theme.fg(c, t));
		ctx.ui.setStatus(STATUS_KEY, text);
	}
}
