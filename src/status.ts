/**
 * status.ts — shared status-bar indicator for the optimizer suite.
 *
 * caveman / rtk / toon / ponytail each toggle independently, but they're all the same
 * class of thing (token-optimization tools), so they share ONE status cell
 * instead of three. Each tool reports its on/off state into a single registry;
 * the cell renders ALL four icons in a fixed order — accent-colored when the
 * tool is enabled, dim when disabled. The cell is never empty.
 *
 *   all on:        all four accent
 *   caveman off:   caveman dim, rest accent
 *   all off:       all four dim
 */

import type {
	ExtensionCommandContext,
	ExtensionContext,
	SymbolPreset,
	ThemeColor,
} from "@oh-my-pi/pi-coding-agent";

const TOOL_ICON_ASCII: Record<StatusTool, string> = {
	caveman: "Cv",
	rtk: "Rk",
	toon: "Tn",
	ponytail: "Pt",
	engram: "En",
};

// v1 used Enclosed Alphanumerics (Ⓒ Ⓡ Ⓣ Ⓟ) — confirmed broken (tofu) in the
// user's terminal font: that block has spotty monospace-font coverage.
// Swapped for older/emoji glyphs confirmed to render there (engram's 🧠
// notify already displays fine), one per tool, in TOOL_ORDER:
//   caveman ⛏️ rtk 🗡️ toon </> (plain ascii, no glyph risk) ponytail ✂️
// Nerd font catalog still never ported (see index.ts) — nerd preset falls
// back to this same set.
const TOOL_ICON_UNICODE: Record<StatusTool, string> = {
	caveman: "⛏️",
	rtk: "🗡️",
	toon: "</>",
	ponytail: "✂️",
	engram: "🧠",
};

/** Set by `OptimizerStatus.paint()` from the live theme so icons follow the
 * user's global `symbolPreset` setting without a separate toggle/command. */
let activePreset: SymbolPreset = "unicode";

/**
 * Each optimizer tool (caveman/rtk/toon/ponytail) exposes a handle so the
 * single `/optimizer` overlay can render one row per tool and apply value
 * changes without knowing the tool's internals.
 */
export interface OptimizerHandle {
	/** Tool name, e.g. "caveman" / "rtk" / "toon". */
	name: OptimizerTool;
	/** One-line summary shown in the overlay row. */
	help: string;
	/** Cyclable values for this tool's overlay row, in display order. */
	values: readonly string[];
	/** Current value string (must be one of `values`). */
	current(): string;
	/** Apply a chosen value (persists + repaints status). `value` is one of `values`. */
	run(value: string, ctx: ExtensionCommandContext): Promise<void> | void;
}

/** Stable status-bar key shared by every optimizer tool. */
export const STATUS_KEY = "pix-optimizer";

/** Tools that participate in the shared indicator, in render order. */
export type OptimizerTool = "caveman" | "rtk" | "toon" | "ponytail";

/** Status-cell tools: the four toggleable optimizer tools plus engram (no
 * toggle — its icon reports whether memory was recalled this session). */
export type StatusTool = OptimizerTool | "engram";


/** Glyph for a tool, resolved against the last-seen `symbolPreset` (ascii stays plain text; unicode/nerd use the circled-letter set — see ceiling note above). */
export function toolIcon(tool: StatusTool): string {
	return activePreset === "ascii" ? TOOL_ICON_ASCII[tool] : TOOL_ICON_UNICODE[tool];
}

/** Fixed left-to-right order of icons in the cell. */
const TOOL_ORDER: readonly StatusTool[] = [
	"caveman",
	"rtk",
	"toon",
	"ponytail",
	"engram",
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
 * and dim when disabled. Glyphs resolve against the active global icon mode
 * (see /pretty). `color` applies the theme color (e.g. theme.fg).
 *
 * Pure + exported for tests (pass a tagging colorizer to assert per-icon color).
 * A trailing space separates the cell from the next status segment.
 */
export function renderStatus(
	states: Partial<Record<StatusTool, boolean>>,
	color: Colorize,
): string {
	return `${TOOL_ORDER.map((t) =>
		color(states[t] === true ? ENABLED_COLOR : DISABLED_COLOR, toolIcon(t)),
	).join("  ")} `;
}

/**
 * Shared registry: each tool calls `set(tool, enabled)` whenever its state
 * changes, then the combined cell is re-rendered. A single registry instance
 * is created per extension load and passed to caveman/rtk/json.
 */
export class OptimizerStatus {
	private states: Partial<Record<StatusTool, boolean>> = {};
	/** Latest ui ctx seen, so an icon-mode change can repaint without a toggle. */
	private lastCtx: Pick<ExtensionContext, "ui"> | undefined;


	/** Current enabled state for one tool (undefined until first set). */
	get(tool: StatusTool): boolean | undefined {
		return this.states[tool];
	}

	/** Update one tool's enabled state and repaint the shared cell. */
	set(
		tool: StatusTool,
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
