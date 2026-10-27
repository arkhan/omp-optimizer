/**
 * persist.ts — disk-backed persistence for the /optimizer tool states.
 *
 * caveman/ponytail previously saved only to the session log (lost on a fresh
 * session); rtk never persisted at all. This stores every tool's current
 * value in one file under the agent dir so the picker survives a full quit and
 * restart. Each tool reads its value on session_start and writes on run().
 *
 *   ~/.omp/agent/optimizer.json  →  { "caveman": "lite", "rtk": "on", ... }
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { OptimizerTool } from "./status.ts";

/**
 * Local re-impl of @oh-my-pi/pi-coding-agent's getAgentDir() — avoids
 * pulling the whole framework's dep tree (onnxruntime, sherpa-onnx, mupdf,
 * puppeteer-core...) into this plugin's node_modules just for one path
 * helper. Same contract: PI_CODING_AGENT_DIR override (tilde-expanded),
 * default ~/.omp/agent (see `omp --help` env var reference).
 */
function getAgentDir(): string {
	const envDir = process.env.PI_CODING_AGENT_DIR;
	if (envDir) {
		if (envDir === "~") return homedir();
		if (envDir.startsWith("~/")) return join(homedir(), envDir.slice(2));
		return envDir;
	}
	return join(homedir(), ".omp", "agent");
}

type OptimizerFileConfig = Partial<Record<OptimizerTool, string>>;

// Explicit whitelist — matches OptimizerTool exactly. Iterating known keys
// instead of trusting `raw`'s own keys rejects a corrupt/hand-edited
// optimizer.json (stray keys, non-string values) instead of propagating
// garbage into tool state. Ported from @xynogen/pix-optimizer v1.2.0.
const OPTIMIZER_TOOLS: readonly OptimizerTool[] = [
	"caveman",
	"rtk",
	"ponytail",
	"human",
	"engram",
	"title",
];

function getStatePath(): string {
	return join(getAgentDir(), "optimizer.json");
}

function readFile(): OptimizerFileConfig {
	try {
		const sp = getStatePath();
		if (!existsSync(sp)) return {};
		const raw = JSON.parse(readFileSync(sp, "utf-8")) as unknown;
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};

		const config: OptimizerFileConfig = {};
		for (const tool of OPTIMIZER_TOOLS) {
			const value = (raw as Record<string, unknown>)[tool];
			if (typeof value === "string") config[tool] = value;
		}
		return config;
	} catch {
		return {};
	}
}

/** Read a single tool's persisted value from optimizer.json, or undefined if unset. */
export function loadOptValue(tool: OptimizerTool): string | undefined {
	return readFile()[tool];
}

/** Persist a single tool's value, merging into the shared config file. */
export function saveOptValue(tool: OptimizerTool, value: string): void {
	try {
		const sp = getStatePath();
		mkdirSync(dirname(sp), { recursive: true });
		const next = { ...readFile(), [tool]: value };
		writeFileSync(sp, JSON.stringify(next, null, 2), "utf-8");
	} catch (err) {
		console.warn(`optimizer: persist ${tool} failed:`, err);
	}
}
