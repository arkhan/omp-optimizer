import { describe, expect, it } from "bun:test";
import { buildPrompt, LEVELS, resolveLevel } from "./human.ts";

describe("human buildPrompt", () => {
	it("is empty when off", () => {
		expect(buildPrompt("off")).toBe("");
	});

	it("yields the voice rules when on, covering Spanish tells and the caveman precedence", () => {
		const p = buildPrompt("full");
		expect(p).toContain("HUMAN VOICE");
		expect(p).toContain("no solo X, sino Y");
		expect(p).toContain("es importante destacar");
		expect(p).toContain("Caveman decides length and form");
		expect(p).toContain("Never invent a fact");
	});
});

describe("human resolveLevel", () => {
	it("maps stop aliases to off and 1 to full", () => {
		expect(resolveLevel("stop")).toBe("off");
		expect(resolveLevel("1")).toBe("full");
		expect(resolveLevel("full")).toBe("full");
	});

	it("rejects unknown levels", () => {
		expect(resolveLevel("ultra")).toBeNull();
		expect(LEVELS).toEqual(["off", "full"]);
	});
});
