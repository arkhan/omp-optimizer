import { describe, expect, it } from "bun:test";
import { runArgv } from "./run.ts";

const cwd = process.cwd();

// ── runArgv ───────────────────────────────────────────────────────────────────

describe("runArgv", () => {
	it("returns '(empty command)' without spawning for an empty argv", async () => {
		expect(await runArgv([], { cwd })).toBe("(empty command)");
	});

	it("runs a real process and returns its trimmed stdout", async () => {
		expect(await runArgv(["echo", "hello"], { cwd })).toBe("hello");
	});

	it("returns '(no output)' for a command that produces nothing", async () => {
		expect(await runArgv(["true"], { cwd })).toBe("(no output)");
	});

	it("captures stderr too, combined with stdout", async () => {
		const out = await runArgv(["bash", "-c", "echo out; echo err 1>&2"], { cwd });
		expect(out).toContain("out");
		expect(out).toContain("err");
	});

	it("never throws for a nonexistent binary — resolves to a descriptive string", async () => {
		const out = await runArgv(["this-binary-does-not-exist-xyz123"], { cwd });
		expect(out.startsWith("[command failed:")).toBe(true);
	});

	it("respects a short timeout and does not hang past it", async () => {
		const start = Date.now();
		const out = await runArgv(["sleep", "5"], { cwd, timeoutMs: 100 });
		const elapsed = Date.now() - start;
		expect(elapsed).toBeLessThan(2000);
		// No output was produced before the kill, so truncate() falls back
		// to the "(no output)" branch regardless of the timeout marker.
		expect(out).toBe("(no output)");
	});

	it("truncates output over maxBytes with a plain truncation marker", async () => {
		const out = await runArgv(["bash", "-c", "yes x | head -c 5000"], { cwd, maxBytes: 100 });
		expect(Buffer.byteLength(out, "utf-8")).toBeLessThan(5000);
		expect(out).toContain("[output truncated]");
		expect(out).not.toContain("timed out");
	});

	it("truncates output with a timed-out marker when both limits are hit", async () => {
		const out = await runArgv(["bash", "-c", "yes x | head -c 5000; sleep 5"], {
			cwd,
			timeoutMs: 200,
			maxBytes: 100,
		});
		expect(Buffer.byteLength(out, "utf-8")).toBeLessThan(5000);
		expect(out).toContain("[output truncated: timed out]");
	});

	it("uses the given cwd for relative-path-sensitive commands", async () => {
		const out = await runArgv(["pwd"], { cwd: "/tmp" });
		// Resolve symlinks (e.g. macOS /tmp -> /private/tmp) before comparing.
		expect(out.endsWith("/tmp")).toBe(true);
	});
});
