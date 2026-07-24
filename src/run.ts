/**
 * run.ts — bounded, shell-free, non-throwing command execution for directive
 * interpolation. Ported from `@xynogen/pix-skills`'s `src/run.ts` (MIT),
 * rewritten onto `Bun.spawn` per the porting guide (prefer Bun APIs for new
 * code; original used `node:child_process` for pi.dev host-runtime parity,
 * which omp — Bun-only — does not need).
 */

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 16_384;

export interface RunOptions {
	cwd: string;
	timeoutMs?: number;
	maxBytes?: number;
}

function truncate(text: string, maxBytes: number, marker: string): string {
	const bytes = Buffer.byteLength(text, "utf-8");
	if (bytes <= maxBytes) return text || "(no output)";
	return `${Buffer.from(text, "utf-8").subarray(0, maxBytes).toString("utf-8")}\n… ${marker}`;
}

/**
 * Spawn argv directly (NO shell). Returns combined stdout+stderr, capped at
 * maxBytes. Never throws: timeouts, non-zero exits, and spawn errors all
 * resolve to descriptive text so skill loading always completes.
 */
export async function runArgv(argv: string[], opts: RunOptions): Promise<string> {
	if (!argv.length) return "(empty command)";
	const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;

	let proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
	try {
		proc = Bun.spawn(argv, {
			cwd: opts.cwd,
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		});
	} catch (err) {
		return `[command failed: ${err instanceof Error ? err.message : String(err)}]`;
	}

	let killedByTimeout = false;
	const timer = setTimeout(() => {
		killedByTimeout = true;
		proc.kill();
	}, timeoutMs);
	timer.unref?.();

	try {
		const [stdout, stderr] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		clearTimeout(timer);
		const combined = `${stdout}${stderr}`.trimEnd();
		const marker = killedByTimeout ? "[output truncated: timed out]" : "[output truncated]";
		return truncate(combined, maxBytes, marker);
	} catch (err) {
		clearTimeout(timer);
		return `[command failed: ${err instanceof Error ? err.message : String(err)}]`;
	}
}
