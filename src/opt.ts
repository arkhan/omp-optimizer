/**
 * opt.ts — the single `/optimizer` command.
 *
 * v1 fronted the tools with a custom overlay widget (`ui.custom`). Under
 * omp the overlay rendered but never received keystrokes (frozen — input
 * routing for `ui.custom` overlays doesn't reach the component), so v2 drops
 * the widget entirely. omp exposes no extension-contributed settings section
 * (its ExtensionDashboard is enable/disable toggles only), so the interactive
 * path uses omp's NATIVE select dialogs (`ctx.ui.select`), and a text-arg
 * form covers direct/scriptable use:
 *
 *   /optimizer                → pick a tool, then pick its value (native dialogs)
 *   /optimizer status         → plain-text summary of all five tools
 *   /optimizer <tool>         → current value + valid values for that tool
 *   /optimizer <tool> <value> → set directly (headless-safe)
 */

import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import type {
	OptimizerHandle,
	OptimizerStatus,
	OptimizerTool,
} from "./status.ts";

/** Fixed render order — matches the status-bar cell. */
const TOOL_ORDER: readonly OptimizerTool[] = [
	"caveman",
	"rtk",
	"ponytail",
	"engram",
	"title",
];

/** Strip the leading "name [args] — " prefix from a handle's help string. */
function helpSummary(help: string): string {
	const dash = help.indexOf("—");
	return dash === -1 ? help : help.slice(dash + 1).trim();
}

/** Filled / empty bar segment glyphs. */
const BAR_FILLED = "▰";
const BAR_EMPTY = "▱";

/**
 * Render an intensity bar for a tool's current value. One segment per
 * non-"off" step in `values`; segments up to and including the current value's
 * position are filled, the rest empty. "off" → all empty.
 *
 *   ponytail [off,lite,full,ultra]: off=▱▱▱ lite=▰▱▱ full=▰▰▱ ultra=▰▰▰
 *   rtk      [off,on]:               off=▱   on=▰
 *
 * Pure + exported for tests.
 */
export function levelBar(current: string, values: readonly string[]): string {
	const segments = values.length - 1; // exclude "off"
	if (segments < 1) return "";
	const idx = values.indexOf(current); // 0 = off → 0 filled
	const filled = Math.max(0, idx);
	return BAR_FILLED.repeat(filled) + BAR_EMPTY.repeat(segments - filled);
}

/** Plain-text status of every tool (also the headless fallback). */
export function buildOptHelp(
	handles: Record<OptimizerTool, OptimizerHandle>,
): string {
	const lines = TOOL_ORDER.map(
		(n) => `  ${n}: ${handles[n].current()}  — ${helpSummary(handles[n].help)}`,
	);
	return ["omp-optimizer — token tools", "", ...lines].join("\n");
}

export function registerOptCommand(
	pi: ExtensionAPI,
	handles: Record<OptimizerTool, OptimizerHandle>,
	_status: OptimizerStatus,
): void {
	pi.registerCommand("optimizer", {
		description:
			"omp-optimizer: caveman / rtk / ponytail — /optimizer [tool] [value]",
		handler: async (args, ctx) => {
			const [toolArg, value] = args.trim().split(/\s+/).filter(Boolean);

			// /optimizer status — plain summary, always available.
			if (toolArg === "status") {
				ctx.ui.notify(buildOptHelp(handles), "info");
				return;
			}

			// /optimizer <tool> [value] — direct form, no dialogs.
			if (toolArg !== undefined) {
				const tool = TOOL_ORDER.find((t) => t === toolArg);
				if (!tool) {
					ctx.ui.notify(
						`Unknown tool "${toolArg}". Usage: /optimizer [${TOOL_ORDER.join("|")}] [value] — or no args for the interactive picker.`,
						"warning",
					);
					return;
				}
				const handle = handles[tool];
				if (value === undefined) {
					ctx.ui.notify(
						`${tool}: ${handle.current()} (values: ${handle.values.join(", ")})`,
						"info",
					);
					return;
				}
				if (!handle.values.includes(value)) {
					ctx.ui.notify(
						`Invalid value "${value}" for ${tool}. Valid: ${handle.values.join(", ")}`,
						"warning",
					);
					return;
				}
				await handle.run(value, ctx);
				return;
			}

			// /optimizer — interactive picker via omp's native select dialogs.
			if (typeof ctx.ui.select !== "function") {
				ctx.ui.notify(buildOptHelp(handles), "info");
				return;
			}

			const toolLabel = await ctx.ui.select(
				"Optimizer — pick a tool",
				TOOL_ORDER.map((t) => ({
					label: t,
					description: `${handles[t].current()}  ${levelBar(handles[t].current(), handles[t].values)} — ${helpSummary(handles[t].help)}`,
				})),
			);
			if (!toolLabel) return;
			const tool = toolLabel as OptimizerTool;
			const handle = handles[tool];

			const picked = await ctx.ui.select(
				`Optimizer — ${tool}`,
				handle.values.map((v) => ({
					label: v,
					description: v === handle.current() ? "current" : undefined,
				})),
			);
			if (!picked || picked === handle.current()) return;
			await handle.run(picked, ctx);
		},
	});
}
