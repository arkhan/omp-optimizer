/**
 * gate.ts — vendored command-risk classifier, ported from
 * `@xynogen/pix-gate`'s `src/lib.ts` (MIT, github.com/xynogen/pix-mono).
 *
 * Vendored rather than installed: pix-gate's package.json declares
 * `@xynogen/pix-pretty` + `@xynogen/pix-data` as hard `dependencies` (both
 * external to omp, already dropped when porting `pix-optimizer` — see
 * omp-optimizer's README "Differences from upstream"). Only `classify()` +
 * `DEFAULT_RULES` are needed here; both are pure regex tables with zero
 * external imports in the original file. The one coupled export,
 * `loadUserConfig()` (reads `@xynogen/pix-data/pix-config`), is dropped —
 * this port ships `DEFAULT_RULES` only, no user-config override.
 *
 * Path-rule half of upstream lib.ts (DEFAULT_PATH_RULES / classifyPath, for
 * gating read/write/edit on credential files) is intentionally NOT ported —
 * out of scope for skill directive gating, not requested.
 */

export type Severity = "critical" | "dangerous" | "risky";

export interface Rule {
	pattern: RegExp;
	severity: Severity;
	reason: string;
}

export const DEFAULT_RULES: Rule[] = [
	// CRITICAL — destructive, irreversible, or system-wide
	{
		pattern: /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\s+\/(\s|$)/i,
		severity: "critical",
		reason: "rm -rf on /",
	},
	{
		pattern: /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\s+(~|\$HOME)(\s|$|\/\s*$)/i,
		severity: "critical",
		reason: "rm -rf on $HOME",
	},
	{
		pattern: /\bmkfs(\.\w+)?\b/i,
		severity: "critical",
		reason: "filesystem formatting",
	},
	{
		pattern: /\bdd\s+.*\bof=\/dev\/(sd[a-z]|nvme|disk)/i,
		severity: "critical",
		reason: "dd to raw block device",
	},
	{
		pattern: />\s*\/dev\/(sd[a-z]|nvme|disk)/i,
		severity: "critical",
		reason: "writing to raw block device",
	},
	{
		pattern: /:\(\)\s*\{\s*:\|:&\s*\}\s*;:/,
		severity: "critical",
		reason: "fork bomb",
	},
	{
		pattern: /\bshutdown\b|\breboot\b|\bhalt\b|\bpoweroff\b/i,
		severity: "critical",
		reason: "system power command",
	},

	// DANGEROUS — destructive or privileged but recoverable in scope
	{
		pattern: /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b/i,
		severity: "dangerous",
		reason: "recursive force remove",
	},
	// sudo as a command/operator token, not a substring of a path like pix-sudo
	{
		pattern: /(^|[\s;|&])sudo\b/i,
		severity: "dangerous",
		reason: "privilege escalation",
	},
	{
		pattern: /\b(chmod|chown)\b[^|;&]*\b(777|-R\s+777)/i,
		severity: "dangerous",
		reason: "world-writable permissions",
	},
	{
		pattern: /\bchmod\s+-R\b/i,
		severity: "dangerous",
		reason: "recursive chmod",
	},
	{
		pattern: /\b(curl|wget)\b[^|;&]*\|\s*(sudo\s+)?(sh|bash|zsh)\b/i,
		severity: "dangerous",
		reason: "remote script execution (curl|sh)",
	},
	{
		pattern: /\bgit\s+(push\s+(-f|--force)|reset\s+--hard|clean\s+-[a-z]*f)/i,
		severity: "dangerous",
		reason: "destructive git operation",
	},
	{
		pattern: /\bnpm\s+publish\b/i,
		severity: "dangerous",
		reason: "package publish",
	},
	{
		pattern: /\bdocker\s+(system\s+prune|rm\s+-f|volume\s+rm)/i,
		severity: "dangerous",
		reason: "destructive docker operation",
	},
	{
		pattern: /\bkill\s+-9\s+-1\b/i,
		severity: "dangerous",
		reason: "kill all processes",
	},

	// RISKY — worth a glance but usually fine
	{
		pattern: /\bgit\s+checkout\s+(-f|--force)/i,
		severity: "risky",
		reason: "force checkout (overwrites local changes)",
	},
	{
		pattern: /\bgit\s+stash\s+drop\b/i,
		severity: "risky",
		reason: "stash drop",
	},
	{
		pattern: />\s*[^|&;]*\.env\b/i,
		severity: "risky",
		reason: "writing to .env",
	},
];

/**
 * Return the highest-severity rule that matches `command`, or undefined if
 * none match. Checks critical -> dangerous -> risky, first match wins.
 */
export function classify(command: string, rules: Rule[] = DEFAULT_RULES): Rule | undefined {
	const order: Severity[] = ["critical", "dangerous", "risky"];
	for (const sev of order) {
		const hit = rules.find((r) => r.severity === sev && r.pattern.test(command));
		if (hit) return hit;
	}
	return undefined;
}

/** True when command contains a real sudo invocation (not a path like pix-sudo). */
export function isSudoCommand(command: string): boolean {
	return /(^|[\s;|&])sudo\b/i.test(command);
}
