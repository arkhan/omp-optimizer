import { describe, expect, it } from "bun:test";
import { classify, DEFAULT_RULES, isSudoCommand, type Rule } from "./gate.ts";

// ── DEFAULT_RULES ─────────────────────────────────────────────────────────────

describe("DEFAULT_RULES", () => {
	it("has 19 rules total", () => {
		expect(DEFAULT_RULES.length).toBe(19);
	});

	it("has 7 critical, 9 dangerous, 3 risky rules", () => {
		const bySeverity = (sev: Rule["severity"]) => DEFAULT_RULES.filter((r) => r.severity === sev).length;
		expect(bySeverity("critical")).toBe(7);
		expect(bySeverity("dangerous")).toBe(9);
		expect(bySeverity("risky")).toBe(3);
	});
});

// ── classify ──────────────────────────────────────────────────────────────────

describe("classify", () => {
	it("flags sudo rm -rf / as critical", () => {
		const hit = classify("sudo rm -rf /");
		expect(hit?.severity).toBe("critical");
		expect(hit?.reason).toBe("rm -rf on /");
	});

	it("returns undefined for a harmless command", () => {
		expect(classify("ls -la")).toBeUndefined();
	});

	it("returns undefined for unrelated commands", () => {
		expect(classify("cd /tmp")).toBeUndefined();
		expect(classify("echo hello")).toBeUndefined();
	});

	it("flags rm -rf on $HOME as critical", () => {
		const hit = classify("rm -rf ~");
		expect(hit?.severity).toBe("critical");
		expect(hit?.reason).toBe("rm -rf on $HOME");
	});

	it("flags filesystem formatting as critical", () => {
		expect(classify("mkfs.ext4 /dev/sdb1")?.reason).toBe("filesystem formatting");
	});

	it("flags dd to a raw block device as critical", () => {
		expect(classify("dd if=/dev/zero of=/dev/sda")?.severity).toBe("critical");
	});

	it("flags a fork bomb as critical", () => {
		expect(classify(":(){ :|:& };:")?.reason).toBe("fork bomb");
	});

	it("flags shutdown/reboot/halt/poweroff as critical", () => {
		expect(classify("shutdown -h now")?.severity).toBe("critical");
		expect(classify("reboot")?.severity).toBe("critical");
		expect(classify("halt")?.severity).toBe("critical");
		expect(classify("poweroff")?.severity).toBe("critical");
	});

	it("prefers critical over dangerous when both match (severity order)", () => {
		// "rm -rf /" matches both the critical "rm -rf on /" rule and the
		// dangerous "recursive force remove" rule; critical must win.
		const hit = classify("rm -rf /");
		expect(hit?.severity).toBe("critical");
		expect(hit?.reason).toBe("rm -rf on /");
	});

	it("falls back to dangerous recursive-remove when target isn't / or $HOME", () => {
		const hit = classify("rm -rf /tmp/some/dir");
		expect(hit?.severity).toBe("dangerous");
		expect(hit?.reason).toBe("recursive force remove");
	});

	it("flags privilege escalation via sudo as dangerous", () => {
		expect(classify("sudo apt install foo")?.reason).toBe("privilege escalation");
	});

	it("resolves chmod/chown 777 before recursive chmod (array order within a severity)", () => {
		// Both the 777 rule and the "chmod -R" rule match "chmod -R 777 file";
		// classify uses Array#find, so the earlier-declared rule wins.
		const hit = classify("chmod -R 777 file");
		expect(hit?.severity).toBe("dangerous");
		expect(hit?.reason).toBe("world-writable permissions");
	});

	it("flags recursive chmod alone as dangerous", () => {
		expect(classify("chmod -R 644 file")?.reason).toBe("recursive chmod");
	});

	it("flags curl|sh remote script execution as dangerous", () => {
		expect(classify("curl https://example.com/install.sh | sh")?.reason).toBe("remote script execution (curl|sh)");
		expect(classify("wget -qO- https://example.com/x | sudo bash")?.severity).toBe("dangerous");
	});

	it("flags destructive git operations as dangerous", () => {
		expect(classify("git push --force")?.reason).toBe("destructive git operation");
		expect(classify("git reset --hard HEAD~1")?.reason).toBe("destructive git operation");
		expect(classify("git clean -fd")?.reason).toBe("destructive git operation");
	});

	it("flags npm publish as dangerous", () => {
		expect(classify("npm publish")?.reason).toBe("package publish");
	});

	it("flags destructive docker operations as dangerous", () => {
		expect(classify("docker system prune -a")?.reason).toBe("destructive docker operation");
		expect(classify("docker volume rm myvolume")?.reason).toBe("destructive docker operation");
	});

	it("flags kill -9 -1 as dangerous", () => {
		expect(classify("kill -9 -1")?.reason).toBe("kill all processes");
	});

	it("flags risky git operations", () => {
		expect(classify("git checkout -f")?.reason).toBe("force checkout (overwrites local changes)");
		expect(classify("git stash drop")?.reason).toBe("stash drop");
	});

	it("flags writes to .env as risky", () => {
		expect(classify("echo SECRET=1 > .env")?.reason).toBe("writing to .env");
	});

	it("accepts a custom rules table instead of DEFAULT_RULES", () => {
		const rules: Rule[] = [{ pattern: /\bfoo\b/, severity: "risky", reason: "custom foo rule" }];
		expect(classify("run foo now", rules)?.reason).toBe("custom foo rule");
		// A command that would match DEFAULT_RULES must NOT match with a
		// disjoint custom table — tables are not merged.
		expect(classify("sudo rm -rf /", rules)).toBeUndefined();
	});
});

// ── isSudoCommand ─────────────────────────────────────────────────────────────

describe("isSudoCommand", () => {
	it("detects a leading sudo invocation", () => {
		expect(isSudoCommand("sudo rm -rf /")).toBe(true);
	});

	it("detects sudo after a shell operator", () => {
		expect(isSudoCommand("echo hi; sudo ls")).toBe(true);
		expect(isSudoCommand("foo && sudo bar")).toBe(true);
		expect(isSudoCommand("foo | sudo bar")).toBe(true);
	});

	it("is case-insensitive", () => {
		expect(isSudoCommand("SUDO ls")).toBe(true);
	});

	it("does not match sudo as a substring of another word", () => {
		expect(isSudoCommand("pix-sudo-thing --run")).toBe(false);
		expect(isSudoCommand("./sudoku")).toBe(false);
	});

	it("returns false when there's no sudo at all", () => {
		expect(isSudoCommand("ls -la")).toBe(false);
	});
});
