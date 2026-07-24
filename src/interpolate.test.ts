import { describe, expect, it } from "bun:test";
import type { ArgvRunner } from "./interpolate.ts";
import { interpolateSkill } from "./interpolate.ts";

const cwd = "/workdir";

// ── interpolateSkill ──────────────────────────────────────────────────────────

describe("interpolateSkill", () => {
	it("returns the same reference when there are no directives", async () => {
		const content = "just plain skill text, nothing to expand";
		const run: ArgvRunner = async () => {
			throw new Error("run should not be called");
		};
		expect(await interpolateSkill(content, cwd, run)).toBe(content);
	});

	it("expands a safe directive into a fenced block using the injected runner", async () => {
		let calledArgv: string[] | undefined;
		let calledCwd: string | undefined;
		const run: ArgvRunner = async (argv, runCwd) => {
			calledArgv = argv;
			calledCwd = runCwd;
			return "hello output";
		};

		const result = await interpolateSkill("before\n!`echo hello`\nafter", cwd, run);

		expect(result).toBe("before\n\n```\nhello output\n```\n\nafter");
		expect(calledArgv).toEqual(["echo", "hello"]);
		expect(calledCwd).toBe(cwd);
	});

	it("replaces a gate-blocked directive with a [blocked: reason] marker, without invoking run", async () => {
		let ran = false;
		const run: ArgvRunner = async () => {
			ran = true;
			return "should not happen";
		};

		const result = await interpolateSkill("!`sudo rm -rf /`", cwd, run);

		expect(result).toBe("[blocked: critical — rm -rf on /]");
		expect(ran).toBe(false);
	});

	it("replaces a shell-metacharacter directive with a [blocked: reason] marker", async () => {
		let ran = false;
		const run: ArgvRunner = async () => {
			ran = true;
			return "should not happen";
		};

		const result = await interpolateSkill("!`ls; pwd`", cwd, run);

		expect(result).toBe("[blocked: shell metacharacters not allowed in skill commands]");
		expect(ran).toBe(false);
	});

	it("expands multiple directives independently, preserving order and surrounding text", async () => {
		const run: ArgvRunner = async (argv) => `OUT:${argv.join(" ")}`;

		const result = await interpolateSkill("start !`echo a` mid !`echo b` end", cwd, run);

		expect(result).toBe("start \n```\nOUT:echo a\n```\n mid \n```\nOUT:echo b\n```\n end");
	});

	it("splices right-to-left so an earlier span isn't shifted by a later replacement", async () => {
		// Second directive's replacement is much longer than its original
		// source span; if splicing went left-to-right, the first directive's
		// span would be stale by the time it's processed.
		const run: ArgvRunner = async (argv) => (argv[1] === "b" ? "x".repeat(50) : "short");

		const result = await interpolateSkill("!`echo a` and !`echo b`", cwd, run);

		expect(result).toContain("\n```\nshort\n```\n");
		expect(result).toContain(`\n\`\`\`\n${"x".repeat(50)}\n\`\`\`\n`);
		expect(result.indexOf("short")).toBeLessThan(result.indexOf("x".repeat(50)));
	});

	it("mixes blocked and safe directives in the same content", async () => {
		const run: ArgvRunner = async (argv) => `ran:${argv.join(" ")}`;

		const result = await interpolateSkill("!`echo ok` then !`sudo rm -rf /`", cwd, run);

		expect(result).toBe("\n```\nran:echo ok\n```\n then [blocked: critical — rm -rf on /]");
	});
});
