import { describe, expect, it } from "bun:test";
import {
	directiveBlockReason,
	findCommandDirectives,
	hasShellMeta,
	replaceSpan,
	tokenizeCommand,
} from "./directive.ts";

// ── findCommandDirectives ─────────────────────────────────────────────────────

describe("findCommandDirectives", () => {
	it("locates a single directive with its source span", () => {
		const hits = findCommandDirectives("before\n!`echo hello`\nafter");
		expect(hits).toHaveLength(1);
		expect(hits[0]).toEqual({ start: 7, end: 20, command: "echo hello" });
	});

	it("trims whitespace inside the backticks", () => {
		const hits = findCommandDirectives("!`  echo hi  `");
		expect(hits[0]?.command).toBe("echo hi");
	});

	it("matches a directive at the very start of the string", () => {
		const hits = findCommandDirectives("!`pwd` trailing text");
		expect(hits).toHaveLength(1);
		expect(hits[0]).toEqual({ start: 0, end: 6, command: "pwd" });
	});

	it("does not match an escaped \\!`cmd` directive", () => {
		const hits = findCommandDirectives("text \\!`ls` more text");
		expect(hits).toHaveLength(0);
	});

	it("does not match when there's no closing backtick", () => {
		expect(findCommandDirectives("!`echo hello")).toHaveLength(0);
	});

	it("does not match across a newline", () => {
		expect(findCommandDirectives("!`echo\nhello`")).toHaveLength(0);
	});

	it("cuts the match at the first backtick inside the command", () => {
		// "!`ls `pwd``" — the command capture is non-greedy-by-construction
		// ([^`\n]+ stops at the first backtick), so this reads as the
		// directive "!`ls `" followed by plain trailing text "pwd``".
		const hits = findCommandDirectives("!`ls `pwd``");
		expect(hits).toHaveLength(1);
		expect(hits[0]).toEqual({ start: 0, end: 6, command: "ls" });
	});

	it("finds multiple directives in the same string", () => {
		const hits = findCommandDirectives("!`echo a` and !`echo b`");
		expect(hits).toHaveLength(2);
		expect(hits[0]?.command).toBe("echo a");
		expect(hits[1]?.command).toBe("echo b");
	});

	it("returns an empty array when there are no directives", () => {
		expect(findCommandDirectives("just plain text, no directives here")).toEqual([]);
	});

	it("skips only the escaped occurrence, still matches an unescaped one later", () => {
		const hits = findCommandDirectives("\\!`skip me` but !`echo run`");
		expect(hits).toHaveLength(1);
		expect(hits[0]?.command).toBe("echo run");
	});
});

// ── replaceSpan ───────────────────────────────────────────────────────────────

describe("replaceSpan", () => {
	it("replaces the [start, end) slice with the given text", () => {
		expect(replaceSpan("hello world", 6, 11, "there")).toBe("hello there");
	});

	it("supports pure insertion when start === end", () => {
		expect(replaceSpan("ab", 1, 1, "X")).toBe("aXb");
	});

	it("supports replacing from the very start", () => {
		expect(replaceSpan("hello", 0, 5, "bye")).toBe("bye");
	});

	it("supports replacing to the very end", () => {
		expect(replaceSpan("hello world", 6, 11, "there!")).toBe("hello there!");
	});
});

// ── hasShellMeta ──────────────────────────────────────────────────────────────

describe("hasShellMeta", () => {
	it("returns false for a plain, safe command", () => {
		expect(hasShellMeta("git status -sb")).toBe(false);
		expect(hasShellMeta("ls -la /tmp")).toBe(false);
	});

	it.each([
		["semicolon", "ls; rm -rf /"],
		["pipe", "cat file | grep foo"],
		["ampersand", "cmd1 && cmd2"],
		["dollar", "echo $HOME"],
		["backtick", "echo `date`"],
		["redirect out", "cat file > out.txt"],
		["redirect in", "cat < in.txt"],
		["paren", "(cd /tmp && ls)"],
		["brace", "echo {a,b}"],
		["newline", "echo a\necho b"],
	])("detects %s metacharacters", (_name, command) => {
		expect(hasShellMeta(command)).toBe(true);
	});
});

// ── tokenizeCommand ───────────────────────────────────────────────────────────

describe("tokenizeCommand", () => {
	it("splits on whitespace", () => {
		expect(tokenizeCommand("echo hello world")).toEqual(["echo", "hello", "world"]);
	});

	it("collapses multiple consecutive spaces", () => {
		expect(tokenizeCommand("echo    hello     world")).toEqual(["echo", "hello", "world"]);
	});

	it("keeps a double-quoted token as a single element, dropping the quotes", () => {
		expect(tokenizeCommand('echo "hello world"')).toEqual(["echo", "hello world"]);
	});

	it("keeps a single-quoted token as a single element, dropping the quotes", () => {
		expect(tokenizeCommand("echo 'hello world'")).toEqual(["echo", "hello world"]);
	});

	it("handles a mix of quoted and bare tokens", () => {
		expect(tokenizeCommand("cmd 'a b' bare \"c d\"")).toEqual(["cmd", "a b", "bare", "c d"]);
	});

	it("returns an empty array for an empty string", () => {
		expect(tokenizeCommand("")).toEqual([]);
	});

	it("returns an empty array for whitespace-only input", () => {
		expect(tokenizeCommand("   ")).toEqual([]);
	});
});

// ── directiveBlockReason ──────────────────────────────────────────────────────

describe("directiveBlockReason", () => {
	it("returns null for a safe command", () => {
		expect(directiveBlockReason("git status -sb")).toBeNull();
	});

	it("returns 'severity — reason' for a gate hit", () => {
		expect(directiveBlockReason("sudo rm -rf /")).toBe("critical — rm -rf on /");
	});

	it("blocks on shell metacharacters even when the command itself is otherwise safe", () => {
		expect(directiveBlockReason("ls; pwd")).toBe("shell metacharacters not allowed in skill commands");
	});

	it("checks shell metacharacters before consulting the gate", () => {
		// This command also matches a gate rule (sudo), but the shell-meta
		// check runs first and should short-circuit with its own message.
		expect(directiveBlockReason("sudo ls; echo done")).toBe("shell metacharacters not allowed in skill commands");
	});

	it("returns null for an ordinary read-only command", () => {
		expect(directiveBlockReason("echo hello")).toBeNull();
		expect(directiveBlockReason("cat package.json")).toBeNull();
	});

	it("surfaces a dangerous-severity gate hit", () => {
		expect(directiveBlockReason("chmod -R 777 file")).toBe("dangerous — world-writable permissions");
	});

	it("surfaces a risky-severity gate hit", () => {
		expect(directiveBlockReason("git stash drop")).toBe("risky — stash drop");
	});
});
