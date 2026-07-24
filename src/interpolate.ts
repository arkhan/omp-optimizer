/**
 * interpolate.ts — expand `!`cmd`` directives in skill content. Ported from
 * `@xynogen/pix-skills`'s `src/index.ts` (the `interpolateSkill` function),
 * split out since this port has no `read_skills` tool to host it in.
 *
 * Policy (no prompt, same as upstream):
 *   - shell metachars -> blocked
 *   - matches any gate rule (critical/dangerous/risky) -> blocked
 *   - otherwise -> run shell-free, inline output as a fenced block
 * Blocked directives are replaced with an inline [blocked: reason] marker.
 * Splices right-to-left so earlier spans stay valid as the string mutates.
 */

import { directiveBlockReason, findCommandDirectives, replaceSpan, tokenizeCommand } from "./directive.ts";
import { runArgv } from "./run.ts";

export type ArgvRunner = (argv: string[], cwd: string) => Promise<string>;

const defaultRunner: ArgvRunner = (argv, cwd) => runArgv(argv, { cwd });

function fence(output: string): string {
	return `\n\`\`\`\n${output}\n\`\`\`\n`;
}

export async function interpolateSkill(
	content: string,
	cwd: string,
	run: ArgvRunner = defaultRunner,
): Promise<string> {
	const directives = findCommandDirectives(content);
	if (!directives.length) return content;

	const resolved = await Promise.all(
		directives.map(async (d) => {
			const reason = directiveBlockReason(d.command);
			if (reason) return { d, text: `[blocked: ${reason}]`, blocked: true };
			return {
				d,
				text: await run(tokenizeCommand(d.command), cwd),
				blocked: false,
			};
		}),
	);

	let out = content;
	for (let i = resolved.length - 1; i >= 0; i--) {
		const entry = resolved[i];
		if (!entry) continue;
		const { d, text, blocked } = entry;
		out = replaceSpan(out, d.start, d.end, blocked ? text : fence(text));
	}
	return out;
}
