import { describe, expect, it } from "bun:test";
import {
	OptimizerStatus,
	renderStatus,
	STATUS_KEY,
	toolIcon,
} from "./status.ts";

/** Tagging colorizer: <accent>X</accent> / <dim>X</dim> for assertions. */
const tag = (c: string, t: string) => `<${c}>${t}</${c}>`;

// Icons resolve against the global pix-pretty mode (default "nerd" in tests).
const CV = toolIcon("caveman");
const RK = toolIcon("rtk");
const PT = toolIcon("ponytail");
const HM = toolIcon("human");
const EN = toolIcon("engram");
const TT = toolIcon("title");

describe("renderStatus", () => {
	it("shows ALL icons in order, accent when enabled", () => {
		expect(
			renderStatus(
				{ caveman: true, rtk: true, ponytail: true },
				tag,
			),
		).toBe(
			`<accent>${CV}</accent>  <accent>${RK}</accent>  <accent>${PT}</accent>  <dim>${HM}</dim>  <dim>${EN}</dim>  <dim>${TT}</dim> `,
		);
	});

	it("dims disabled tools but still shows them", () => {
		expect(
			renderStatus(
				{ caveman: false, rtk: true, ponytail: true },
				tag,
			),
		).toBe(
			`<dim>${CV}</dim>  <accent>${RK}</accent>  <accent>${PT}</accent>  <dim>${HM}</dim>  <dim>${EN}</dim>  <dim>${TT}</dim> `,
		);
	});

	it("all dim when nothing enabled (cell never empty)", () => {
		expect(renderStatus({}, tag)).toBe(
			`<dim>${CV}</dim>  <dim>${RK}</dim>  <dim>${PT}</dim>  <dim>${HM}</dim>  <dim>${EN}</dim>  <dim>${TT}</dim> `,
		);
	});

	it("preserves fixed order regardless of insertion order", () => {
		expect(renderStatus({ ponytail: true, caveman: true }, tag)).toBe(
			`<accent>${CV}</accent>  <dim>${RK}</dim>  <accent>${PT}</accent>  <dim>${HM}</dim>  <dim>${EN}</dim>  <dim>${TT}</dim> `,
		);
	});

	it("resolves icons via the shared catalog (non-empty glyphs)", () => {
		// toolIcon delegates to pix-pretty's icon(); every tool has a glyph.
		expect([CV, RK, PT, HM, EN, TT].every((g) => g.length > 0)).toBe(true);
	});
});

describe("OptimizerStatus", () => {
	/** Minimal ui stub capturing setStatus calls. */
	function fakeCtx() {
		const calls: { key: string; text: string }[] = [];
		return {
			calls,
			ui: {
				setStatus: (key: string, text: string | undefined) =>
					calls.push({ key, text: text ?? "" }),
				theme: { fg: (c: string, t: string) => `<${c}>${t}</${c}>` },
			},
		} as const;
	}

	it("paints the shared key with per-icon accent/dim", () => {
		const status = new OptimizerStatus();
		const ctx = fakeCtx();
		status.set("rtk", true, ctx as never);
		const last = ctx.calls.at(-1);
		if (!last) throw new Error("no calls");
		expect(last.key).toBe(STATUS_KEY);
		// caveman + ponytail still unset (dim), rtk accent.
		expect(last.text).toBe(
			`<dim>${CV}</dim>  <accent>${RK}</accent>  <dim>${PT}</dim>  <dim>${HM}</dim>  <dim>${EN}</dim>  <dim>${TT}</dim> `,
		);
	});

	it("accumulates state across tools", () => {
		const status = new OptimizerStatus();
		const ctx = fakeCtx();
		status.set("caveman", true, ctx as never);
		status.set("ponytail", true, ctx as never);
		const last = ctx.calls.at(-1);
		if (!last) throw new Error("no calls");
		expect(last.text).toBe(
			`<accent>${CV}</accent>  <dim>${RK}</dim>  <accent>${PT}</accent>  <dim>${HM}</dim>  <dim>${EN}</dim>  <dim>${TT}</dim> `,
		);
	});

	it("dims an icon when its tool toggles off (cell stays populated)", () => {
		const status = new OptimizerStatus();
		const ctx = fakeCtx();
		status.set("rtk", true, ctx as never);
		status.set("rtk", false, ctx as never);
		const last = ctx.calls.at(-1);
		if (!last) throw new Error("no calls");
		expect(last.text).toBe(
			`<dim>${CV}</dim>  <dim>${RK}</dim>  <dim>${PT}</dim>  <dim>${HM}</dim>  <dim>${EN}</dim>  <dim>${TT}</dim> `,
		);
	});
});

describe("toolIcon — symbolPreset switching", () => {
	function presetCtx(preset: "ascii" | "unicode" | "nerd") {
		return {
			ui: {
				setStatus: () => {},
				theme: { fg: (_c: string, t: string) => t, getSymbolPreset: () => preset },
			},
		} as const;
	}

	it("resolves distinct real Nerd Font glyphs under nerd preset (not the color-emoji fallback)", () => {
		const status = new OptimizerStatus();
		status.set("caveman", true, presetCtx("nerd") as never);
		const nerdGlyph = toolIcon("caveman");
		status.set("caveman", true, presetCtx("unicode") as never);
		const unicodeGlyph = toolIcon("caveman");
		status.set("caveman", true, presetCtx("ascii") as never);
		const asciiGlyph = toolIcon("caveman");

		expect(nerdGlyph).toBe("\uf066"); // fa-compress, verified against nerd-fonts glyphnames.json
		expect(nerdGlyph).not.toBe(unicodeGlyph);
		expect(unicodeGlyph).toBe("⛏️");
		expect(asciiGlyph).toBe("Cv");

		// Restore this module's baseline preset so later test files (and a
		// re-run of this one) aren't affected by activePreset being module-
		// level shared state — CV/RK/PT/EN/TT above were captured once under
		// "unicode" at import time and must stay valid for the rest of the run.
		status.set("caveman", true, presetCtx("unicode") as never);
	});
});
