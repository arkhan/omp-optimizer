/**
 * omp-optimizer — integral token/workflow-optimization suite for omp.
 *
 * Six tools, combined into one extension + one command:
 *   - caveman:  terse-output system prompt
 *   - rtk:      prefixes shell commands with `rtk` + injects RTK prompt
 *   - toon:     jq + TOON guidance for dense JSON (+ bundled skill)
 *   - ponytail: lazy-senior-dev system prompt (minimal code, YAGNI)
 *   - engram:   auto memory recall on session_start/compact (:7437)
 *   - title:    background session title from the first user prompts
 *
 * They share ONE status-bar cell (all six icons always shown — dimmed when
 * off, accented when on; icon style is nerd/unicode/ascii, follows the omp
 * symbolPreset) and ONE command (/optimizer — native select dialogs, or a
 * text-arg form). index.ts wires lifecycle hooks via each module, then
 * registers the command.
 */

import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import type { ImageContent, TextContent } from "@oh-my-pi/pi-ai";
import { caveman } from "./caveman.ts";
import engram from "./engram.js";
import { interpolateSkill } from "./interpolate.ts";
import { json } from "./json.ts";
import { registerOptCommand } from "./opt.ts";
import { ponytail } from "./ponytail.ts";
import { loadOptValue, saveOptValue } from "./persist.ts";
import { rtk } from "./rtk.ts";
import piTitle from "./title.bundle.js";
import {
	type OptimizerHandle,
	OptimizerStatus,
	type OptimizerTool,
} from "./status.ts";
import { filterModelWarnings } from "./tool-result-filter.ts";

/**
 * omp-title has no on/off knob of its own (upstream fork, shipped as a
 * prebuilt bundle — see title.bundle.js note below). Gate it here by wrapping
 * `pi.on` so its `before_agent_start` handler (the generation trigger) is a
 * no-op while disabled; `session_shutdown` (in-flight cleanup) and the manual
 * `/title` command pass through unchanged.
 */
function titleTool(pi: ExtensionAPI, status: OptimizerStatus): OptimizerHandle {
	let enabled = (loadOptValue("title") ?? "on") !== "off";

	const gated = new Proxy(pi, {
		get(target, prop, receiver) {
			if (prop !== "on") return Reflect.get(target, prop, receiver);
			return (event: string, handler: (...args: unknown[]) => unknown) => {
				if (event !== "before_agent_start") return target.on(event as never, handler as never);
				return target.on(event as never, ((...args: unknown[]) =>
					enabled ? handler(...args) : undefined) as never);
			};
		},
	});
	piTitle(gated as ExtensionAPI);

	// Paint the shared cell on session_start, same as every other tool — the
	// title bundle itself never touches status (no on/off knob upstream).
	pi.on("session_start", async (_event, ctx) => {
		status.set("title", enabled, ctx);
	});

	return {
		name: "title",
		help: "title — background session title from the first user prompts",
		values: ["off", "on"],
		current: () => (enabled ? "on" : "off"),
		run: (value, ctx) => {
			enabled = value === "on";
			saveOptValue("title", enabled ? "on" : "off");
			status.set("title", enabled, ctx);
			ctx.ui.notify(enabled ? "Title generation on." : "Title generation off.", "info");
		},
	};
}

export default function optimizer(pi: ExtensionAPI) {
	// Icons follow the global omp symbolPreset (nerd/unicode/ascii); no local state.
	const status = new OptimizerStatus();

	// Each module registers its own lifecycle hooks and returns a handle the
	// /optimizer command lists + drives.
	const handles: Record<OptimizerTool, OptimizerHandle> = {
		caveman: caveman(pi, status),
		rtk: rtk(pi, status),
		toon: json(pi, status),
		ponytail: ponytail(pi, status),
		// omp-engram: auto memory recall on session_start / compaction (HTTP
		// :7437). En/🧠 accent = enabled AND memory loaded this session.
		engram: engram(pi, status),
		// omp-title: imported as a prebuilt self-contained bundle because omp's
		// extension loader fails to resolve pi-ai's transitive `typebox` dep
		// from raw TS (see omp-title notes). Gated above for the on/off toggle.
		title: titleTool(pi, status),
	};

	registerOptCommand(pi, handles, status);

	// ── Merged plugins (formerly standalone packages) ──────────────────────

	// omp-skills: `!`cmd`` directive interpolation on skill:// reads. The 39
	// skills themselves live in this package's skills/ dir and are auto-
	// discovered by omp's omp-plugins skill provider — no registration needed.
	pi.on("tool_result", async (event, ctx) => {
		if (event.toolName !== "read" || event.isError) return;

		const path = event.input.path;
		if (typeof path !== "string" || !path.startsWith("skill://")) return;

		let changed = false;
		const patched: (TextContent | ImageContent)[] = await Promise.all(
			event.content.map(async (block: TextContent | ImageContent) => {
				if (block.type !== "text") return block;
				const expanded = await interpolateSkill(block.text, ctx.cwd);
				if (expanded === block.text) return block;
				changed = true;
				return { ...block, text: expanded };
			}),
		);

		if (!changed) return;
		return { content: patched };
	});

	// Strip model-guidance warnings injected by pi-lens into tool_result content.
	// These strings (BLIND WRITE, THRASHING) are directives for the LLM, not
	// information for the user — filtering them here hides them from the TUI
	// without affecting the model (it already acted on the write/edit result).
	pi.on("tool_result", async (event) => {
		const filtered = filterModelWarnings(event.content);
		if (filtered === event.content) return undefined;
		return { content: filtered };
	});
}
