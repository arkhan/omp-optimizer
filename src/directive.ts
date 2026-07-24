/**
 * directive.ts — pure `!`cmd`` directive parsing, ported from
 * `@xynogen/pix-skills`'s `src/directive.ts` (MIT). No pi-tui / runtime deps,
 * unit-testable standalone.
 *
 * A `!`cmd`` directive embeds live command output into a skill at load time.
 * Safety policy (mirrors the vendored gate in `./gate.ts`):
 *   - shell metacharacters -> unsafe (chaining/expansion)
 *   - matches any gate rule (critical/dangerous/risky) -> unsafe
 *   - otherwise -> safe to run
 */

import { classify } from "./gate.ts";

export interface CommandDirective {
	start: number;
	end: number;
	command: string;
}

// !`...` not preceded by a backslash; command is single-line, no backticks.
const DIRECTIVE_RE = /(^|[^\\])!`([^`\n]+)`/g;

/** Locate all !`cmd` directives with their source spans (escaped \!`…` skipped). */
export function findCommandDirectives(content: string): CommandDirective[] {
	const hits: CommandDirective[] = [];
	for (const m of content.matchAll(DIRECTIVE_RE)) {
		const lead = m[1] ?? "";
		const start = (m.index ?? 0) + lead.length; // skip the captured lead char
		hits.push({
			start,
			end: start + m[0].length - lead.length,
			command: m[2]?.trim() ?? "",
		});
	}
	return hits;
}

/** Replace the [start, end) slice of `s` with `text`. */
export function replaceSpan(s: string, start: number, end: number, text: string): string {
	return s.slice(0, start) + text + s.slice(end);
}

const SHELL_META_RE = /[;|&$`><(){}\n]/;

/** True when the command contains shell metacharacters (chaining/expansion). */
export function hasShellMeta(command: string): boolean {
	return SHELL_META_RE.test(command);
}

/** Minimal argv tokenizer: whitespace-split with single/double quote support. */
export function tokenizeCommand(command: string): string[] {
	const out: string[] = [];
	const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
	for (const m of command.matchAll(re)) {
		out.push(m[1] ?? m[2] ?? m[3] ?? "");
	}
	return out;
}

/**
 * Classify a single directive command against the safety policy.
 * Returns a reason string when the command is UNSAFE, or null when safe.
 */
export function directiveBlockReason(command: string): string | null {
	if (hasShellMeta(command)) {
		return "shell metacharacters not allowed in skill commands";
	}
	const hit = classify(command);
	if (hit) return `${hit.severity} — ${hit.reason}`;
	return null;
}
