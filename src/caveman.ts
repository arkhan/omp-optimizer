/**
 * caveman.ts — pure logic + Pi extension
 *
 * Pure helpers exported for tests; caveman(pi) is the extension entry,
 * called by index.ts alongside rtk(pi).
 */

import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@oh-my-pi/pi-coding-agent";
import { loadOptValue, saveOptValue } from "./persist.ts";
import type { OptimizerHandle, OptimizerStatus } from "./status.ts";

// ── Levels ────────────────────────────────────────────────────────────────────

export const LEVELS = ["off", "lite", "full", "ultra", "micro", "wenyan-lite", "wenyan-full", "wenyan-ultra"] as const;

export type Level = (typeof LEVELS)[number];

export const STOP_ALIASES = new Set(["off", "stop", "quit", "0"]);

// Numeric shortcuts: /caveman 1|2|3
export const LEVEL_NUMBERS: Record<string, Level> = {
	"1": "lite",
	"2": "full",
	"3": "ultra",
};

// ── Status labels ─────────────────────────────────────────────────────────────

export const STATUS_LABELS: Record<Exclude<Level, "off">, string> = {
	lite: "LITE",
	full: "FULL",
	ultra: "ULTRA",
	micro: "MICRO",
	"wenyan-lite": "WENYAN-LITE",
	"wenyan-full": "WENYAN-FULL",
	"wenyan-ultra": "WENYAN-ULTRA",
};

// ── Prompt fragments ──────────────────────────────────────────────────────────

const BASE = `\
IMPORTANT: You are in CAVEMAN MODE. Respond terse like smart caveman. \
All technical substance stay. Only fluff die.

Persistence: active every response, no revert after many turns, no filler drift. Still active if unsure.

Precedence: outranks any other guidance to write in complete sentences, stay in narrative prose for evidence/verification/completeness, or follow a fixed Problem/Decision/Check/Next template — compress those too. Keep the fact and the exact citation, cut narrative around it. Structured labels only if user asks.

Language: preserve user's dominant language — compress style, not language, every line, no \
mid-reply drift. Code, API names, CLI commands, commit-type keywords, error strings stay \
verbatim unless user asks to translate. Grammatical particles/case markers (e.g. Korean/Japanese \
postpositions) are grammar, not filler — never drop them.

Rules:
- Drop articles (a/an/the), filler (just/really/basically/actually/simply), \
pleasantries, hedging
- Never drop negation (not/never/no/n't/without) — dropping it inverts the instruction, \
worse than staying verbose
- Fragments OK. Short synonyms preferred. Technical terms exact
- Tool-call silence: no preamble before a call, no progress narration after — the result \
speaks. No decorative tables/emoji, no dumping long raw error logs unless asked — quote \
shortest decisive line
- Standard acronyms OK (DB/API/HTTP). Never invent abbreviations (cfg/impl/req/res/fn) — \
tokenizer splits them same as full word, zero token saved, reader decodes slower
- No causal arrows (→) either — own token, saves nothing
- Code blocks unchanged. Errors quoted exact
- Persisted text writes normal: git commits, PR/issue text, docs, memory saves are read \
outside this session — compress interactive replies only
- Pattern: [thing] [action] [reason]. [next step].

Bad: "Sure! I'd be happy to help you with that. The issue you're experiencing is likely caused by..."
Good: "Bug in auth middleware. Token expiry check use \`<\` not \`<=\`. Fix:"`;

const MICRO_PROMPT = `# Token efficiency
Respond like smart caveman. Cut all filler, keep technical substance.
- Drop articles (a, an, the), filler (just, really, basically, actually). Never drop not/never — inverts meaning.
- Drop pleasantries (sure, certainly, happy to).
- No hedging. Fragments fine. Short synonyms.
- Technical terms stay exact. Code blocks unchanged.
- Pattern: [thing] [action] [reason]. [next step].`;

const INTENSITY: Record<Exclude<Level, "off" | "micro">, string> = {
	lite: `\
No filler/hedging. Keep articles + full sentences. Professional but tight.
Example: "Your component re-renders because you create a new object reference each render. Wrap it in \`useMemo\`."`,

	full: `\
Drop articles, fragments OK, short synonyms.
Example: "New object ref each render. Inline object prop = new ref = re-render. Wrap in \`useMemo\`."`,

	ultra: `\
Strip conjunctions when cause-then-effect stays unambiguous. One word when one word \
enough. State each fact once. Same abbreviation/arrow ban as base rules — compression \
comes from cutting words, not inventing symbols.
Example: "Inline object prop, new ref, re-render. \`useMemo\`."`,

	"wenyan-lite": `\
Semi-classical Chinese. Drop filler/hedging, keep grammar structure and classical register.
Example: "組件頻重繪，以每繪新生對象參照故。以 \`useMemo\` 包之。"`,

	"wenyan-full": `\
Full classical Chinese (文言文). Verbs precede objects, subjects often omitted, classical \
particles (之/乃/為/其). 80-90% character reduction vs normal prose.
Example: "每繪新生對象參照，故重繪；以 \`useMemo\` 包之則免。"`,

	"wenyan-ultra": `\
Extreme classical compression. Ultra terse while keeping classical Chinese feel.
Example: "新參照則重繪。\`useMemo\` 包之。"`,
};

const SAFETY = `\
Auto-clarity: drop caveman for security warnings, irreversible action confirmations, \
multi-step sequences where fragment order or omitted conjunctions risk misread, compression \
itself creating technical ambiguity (e.g. "migrate table drop column backup first" — order \
unclear without articles/conjunctions — English shown for format only, render the actual \
warning in session language), or when user asks to clarify / is confused. Resume after.
No self-reference: never announce or name the mode ("caveman mode on"). Output caveman-only.
Boundaries: write normal code and normal persisted text (commits, PR/issue descriptions, docs, \
memory saves). Only compress interactive replies. "stop caveman" or "normal mode" reverts.`;

/**
 * Build the system prompt injection for a given level.
 * Returns empty string when level is "off".
 */
export function buildPrompt(level: Level): string {
	if (level === "off") return "";
	if (level === "micro") return MICRO_PROMPT;
	return [BASE, "", `Intensity: ${INTENSITY[level]}`, "", SAFETY].join("\n");
}

// ── Level resolution ──────────────────────────────────────────────────────────

/**
 * Resolve a raw command arg to a Level, or return null if unrecognised.
 * Handles stop aliases (stop/quit → "off") and valid level names.
 */
export function resolveLevel(arg: string): Level | null {
	const a = arg.trim().toLowerCase();
	if (STOP_ALIASES.has(a)) return "off";
	if (LEVEL_NUMBERS[a]) return LEVEL_NUMBERS[a];
	if (LEVELS.includes(a as Level)) return a as Level;
	return null;
}

/**
 * Help text shown when /caveman is run with no argument.
 */
export function buildHelp(current: Level): string {
	const statusLine =
		current === "off" ? "off" : `${STATUS_LABELS[current]} (${current})`;
	return [
		`Caveman mode: ${statusLine}`,
		"",
		"Usage: /caveman <level>",
		"  1  lite   - professional, no fluff",
		"  2  full   - classic caveman",
		"  3  ultra  - maximum compression",
		"  0  off    - disable (aliases: off, stop, quit)",
		"",
		"Other levels: micro, wenyan-lite, wenyan-full, wenyan-ultra",
		"  config    - open settings dialog",
	].join("\n");
}

/**
 * Toggle: off → full, anything else → off.
 */
export function toggleLevel(current: Level): Level {
	return current === "off" ? "full" : "off";
}

// ── Pi extension ────────────────────────────────────────────────────────────

export function caveman(
	pi: ExtensionAPI,
	status: OptimizerStatus,
): OptimizerHandle {
	let level: Level = "off";

	// -- Status: report into the shared optimizer indicator. --

	function syncStatus(ctx: Pick<ExtensionContext, "ui">) {
		status.set("caveman", level !== "off", ctx);
	}

	// Inject caveman prompt via before_agent_start
	pi.on("before_agent_start", async (event, _ctx) => {
		const prompt = buildPrompt(level);
		if (!prompt) return undefined;
		return { systemPromptAppend: prompt };
	});

	// -- Restore live level from the session log on load --

	pi.on("session_start", async (_event, ctx) => {
		// Session log first (survives in-session branch nav), then disk (survives
		// a full quit/restart). Disk wins when present so a new session restores
		// the last chosen level instead of defaulting to off.
		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type === "custom" && entry.customType === "caveman-level") {
				level = (entry.data as { level: Level })?.level ?? level;
			}
		}
		const saved = loadOptValue("caveman");
		if (saved && LEVELS.includes(saved as Level)) level = saved as Level;
		syncStatus(ctx);
	});

	pi.on("agent_start", async (_event, ctx) => {
		syncStatus(ctx);
	});
	pi.on("agent_end", async (_event, ctx) => {
		syncStatus(ctx);
	});
	pi.on("session_shutdown", async () => {});

	// -- Overlay value handler (called by the /optimizer overlay) --

	async function run(
		value: string,
		ctx: ExtensionCommandContext,
	): Promise<void> {
		const resolved = resolveLevel(value);
		if (resolved === null) return;
		level = resolved;

		pi.appendEntry("caveman-level", { level });
		saveOptValue("caveman", level);
		syncStatus(ctx);

		ctx.ui.notify(
			level === "off"
				? "Caveman mode off."
				: `Caveman: ${STATUS_LABELS[level]}`,
			"info",
		);
	}

	return {
		name: "caveman",
		help: "caveman — terse output",
		values: LEVELS,
		current: () => level,
		run,
	};
}
