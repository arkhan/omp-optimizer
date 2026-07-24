/**
 * pix-optimizer — token-optimization suite for Pi Coding Agent.
 *
 * Four tools, combined into one extension + one command:
 *   - caveman:  terse-output system prompt
 *   - rtk:      prefixes shell commands with `rtk` + injects RTK prompt
 *   - toon:     jq + TOON guidance for dense JSON (+ bundled skill)
 *   - ponytail: lazy-senior-dev system prompt (minimal code, YAGNI)
 *
 * They share ONE status-bar cell (all four icons always shown — dimmed when
 * off, accented when on; icon style is nerd/unicode/ascii, set via /optimizer)
 * and ONE command (/optimizer — an interactive overlay). index.ts wires
 * lifecycle hooks via each module, then registers the overlay command.
 */

import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import type { ImageContent, TextContent } from "@oh-my-pi/pi-ai";
import { caveman } from "./caveman.ts";
import engram from "./engram.js";
import { interpolateSkill } from "./interpolate.ts";
import { json } from "./json.ts";
import { registerOptCommand } from "./opt.ts";
import { ponytail } from "./ponytail.ts";
import { rtk } from "./rtk.ts";
import piTitle from "./title.bundle.js";
import {
	type OptimizerHandle,
	OptimizerStatus,
	type OptimizerTool,
} from "./status.ts";
import { filterModelWarnings } from "./tool-result-filter.ts";

export default function optimizer(pi: ExtensionAPI) {
	// Icons follow the global omp symbolPreset (nerd/unicode/ascii); no local state.
	const status = new OptimizerStatus();

	// Each module registers its own lifecycle hooks and returns a handle the
	// /optimizer overlay renders + drives.
	const handles: Record<OptimizerTool, OptimizerHandle> = {
		caveman: caveman(pi, status),
		rtk: rtk(pi, status),
		toon: json(pi, status),
		ponytail: ponytail(pi, status),
	};

	registerOptCommand(pi, handles, status);

	// ── Merged plugins (formerly standalone packages) ──────────────────────

	// omp-engram: auto memory recall on session_start / compaction (HTTP :7437).
	// Shares the optimizer status cell (En/🧠 icon, accent when memory loaded).
	engram(pi, status);

	// omp-title: background session title from first user prompts. Imported as a
	// prebuilt self-contained bundle because omp's extension loader fails to
	// resolve pi-ai's transitive `typebox` dep from raw TS (see omp-title notes).
	piTitle(pi);

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
