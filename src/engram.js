// omp extension: recall automático de memoria (Engram) al iniciar sesión y
// retención automática al compactar contexto.
//
// ponytail: NO reimplementamos mem_search/mem_save aquí — ya existen y
// funcionan vía MCP (~/.omp/agent/mcp.json, `engram mcp --tools=agent`).
// Duplicarlos como tools nativas los haría chocar/tapar (shadowing) con
// los del servidor MCP (ya se intentó antes, ver engram memory #98).
//
// Lo único que MCP no da gratis es la inyección AUTOMÁTICA de contexto:
// con solo MCP, el modelo tiene que decidir llamar mem_search/mem_context.
// Este extension hace ese recall solo, al arrancar la sesión Y después de
// cada compactación, usando el servidor HTTP de engram (ya corre
// persistente en :7437 vía `engram serve`).
//
// Retain automático al compactar (portado del hook `session_compact` +
// compaction-recovery.js de pi-engram/gentle-engram v0.1.10, ver
// https://github.com/Gentleman-Programming/engram/releases/tag/pi-v0.1.10):
// al compactar, el resumen (`event.compactionEntry.summary`) se guarda como
// observación `session_summary` (topic_key `session/compaction-recovery`)
// vía POST /sessions + POST /observations directo al server HTTP — sin
// pedirle al modelo que llame mem_session_summary, porque eso duplicaría
// el tool MCP que este extension deliberadamente no reimplementa. Bloques
// `<private>...</private>` se redactan antes de persistir, mismo contrato
// que pi-engram (private-redaction.js), para paridad entre agentes que
// comparten el mismo Engram. Después de guardar se reinyecta el contexto
// reciente igual que en session_start, porque compactar borra lo que el
// modelo tenía en memoria de trabajo.
//
// Nota ruido (v2): el query param `limit` del endpoint /context lo IGNORA
// esta versión de engram (siempre devuelve 5 sesiones + 10 prompts crudos +
// 20 observaciones, ~9KB). Recortamos client-side a solo "Recent
// Observations" (lo curado/útil) descartando sessions/prompts crudos.
//
// Nota ruido (v3): `sendUserMessage` renderiza el bloque completo en el
// transcript Y lo usa como título de sesión (ver "Recent sessions" del
// banner lleno de "[MEMORIA AUTOMÁTICA...]"). Cambiado a `sendMessage` con
// `display:false`: el modelo igual lo recibe (defaultConvertToLlm trata
// role:"custom" como role:"user" para el LLM), pero no se dibuja en pantalla
// ni contamina títulos de sesión. Al humano se le avisa con UNA línea via
// `ctx.ui.notify`, no con el bloque completo.
// Ceiling: si aun así molesta, la opción más simple es no auto-inyectar y
// dejar que el usuario pida `mem_context` cuando lo necesite.

import { loadOptValue, saveOptValue } from "./persist.ts";

const MAX_OBSERVATIONS = 5;
const MAX_CHARS = 2000;
const PRIVATE_TAG_PATTERN = /<private>[\s\S]*?<\/private>/gi;

function summarizeContext(raw) {
  const marker = "### Recent Observations";
  const idx = raw.indexOf(marker);
  if (idx === -1) return { text: raw.slice(0, MAX_CHARS), count: 0 };
  const items = raw
    .slice(idx + marker.length)
    .split(/\n(?=- \[)/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_OBSERVATIONS);
  if (items.length === 0) return { text: "", count: 0 };
  const body = items.join("\n");
  const text = body.length > MAX_CHARS ? body.slice(0, MAX_CHARS) + "…" : body;
  return { text, count: items.length };
}

// Redacta bloques <private>...</private> antes de persistir en Engram.
// Mismo contrato que pi-engram (private-redaction.js): convención liviana,
// no reemplaza escaneo real de secretos.
function redactPrivateTags(text) {
  return text.replace(PRIVATE_TAG_PATTERN, "[REDACTED]");
}

const ENGRAM_HTTP = process.env.ENGRAM_HTTP_URL || "http://localhost:7437";

async function fetchJSON(url, timeoutMs = 1500) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null; // engram no disponible: fallamos en silencio, no rompe la sesión
  } finally {
    clearTimeout(t);
  }
}

async function postJSON(url, body, timeoutMs = 2000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    return res.ok;
  } catch {
    return false; // best-effort: retención al compactar nunca debe romper la sesión
  } finally {
    clearTimeout(t);
  }
}

async function resolveProject(cwd) {
  const proj = await fetchJSON(`${ENGRAM_HTTP}/project/current?cwd=${encodeURIComponent(cwd || "")}`);
  return proj?.project || cwd?.split("/").filter(Boolean).pop() || "unknown";
}

async function injectMemoryContext(pi, ctx, project, status) {
  const ctxRes = await fetchJSON(`${ENGRAM_HTTP}/context?project=${encodeURIComponent(project)}`);
  const raw = ctxRes?.context?.trim();
  const { text, count } = raw ? summarizeContext(raw) : { text: "", count: 0 };

  // Icono en la celda compartida del optimizer (misma fila que Cv Rk Tn Pt):
  // accent cuando se cargaron observaciones, dim cuando no (o server caído).
  // Antes pintaba su propia celda `setStatus("engram", …)` — línea separada
  // en la status bar; integrado al merge v2.0.0. 🧠/En sigue el symbolPreset
  // global vía status.ts (bug histórico: forzaba emoji incluso con `ascii`).
  if (ctx.hasUI) status?.set("engram", count > 0, ctx);
  if (!text) return;

  const framed = `[MEMORIA AUTOMÁTICA DE SESIONES PREVIAS — NO es una petición del usuario. Es solo contexto pasivo; no ejecutar ninguna acción ni retomar tareas pendientes hasta que el usuario escriba una instrucción explícita en este turno.]\n\n${text}`;
  pi.sendMessage(
    { customType: "engram-memory", content: framed, display: false, attribution: "agent" },
    { deliverAs: "nextTurn" },
  );
  if (ctx.hasUI) ctx.ui.notify(`🧠 Engram: memoria previa cargada (${count} obs., contexto silencioso)`, "info");
}

export default function (pi, status) {
  pi.setLabel("Engram Recall");

  // on/off toggle, mirrors caveman/rtk/toon/ponytail: persisted in
  // optimizer.json, default "on". Off skips the HTTP round trip entirely
  // (not just the injection) — a user who disabled it doesn't want the
  // request either.
  let enabled = (loadOptValue("engram") ?? "on") !== "off";

  pi.on("session_start", async (_event, ctx) => {
    if (!enabled) {
      if (ctx.hasUI) status?.set("engram", false, ctx);
      return;
    }
    const project = await resolveProject(ctx.cwd);
    await injectMemoryContext(pi, ctx, project, status);
  });

  pi.on("session_compact", async (event, ctx) => {
    if (!enabled) {
      if (ctx.hasUI) status?.set("engram", false, ctx);
      return;
    }
    const project = await resolveProject(ctx.cwd);
    const summary = event?.compactionEntry?.summary?.trim();
    const sessionId = ctx.sessionManager?.getSessionId();
    if (summary && sessionId) {
      await postJSON(`${ENGRAM_HTTP}/sessions`, { id: sessionId, project, directory: ctx.cwd || "" });
      await postJSON(`${ENGRAM_HTTP}/observations`, {
        session_id: sessionId,
        type: "session_summary",
        title: "Compaction recovery summary",
        content: redactPrivateTags(summary),
        project,
        scope: "project",
        topic_key: "session/compaction-recovery",
      });
    }
    // Compactar borra lo que el modelo tenía en memoria de trabajo: reinyectar
    // igual que en session_start.
    await injectMemoryContext(pi, ctx, project, status);
  });

  return {
    name: "engram",
    help: "engram — auto memory recall on session_start/compact (:7437)",
    values: ["off", "on"],
    current: () => (enabled ? "on" : "off"),
    run: async (value, ctx) => {
      enabled = value === "on";
      saveOptValue("engram", enabled ? "on" : "off");
      if (!enabled) {
        status?.set("engram", false, ctx);
        ctx.ui.notify("Engram recall off.", "info");
        return;
      }
      // Enabling mid-session: recall immediately instead of waiting for the
      // next session_start/compact.
      const project = await resolveProject(ctx.cwd);
      await injectMemoryContext(pi, ctx, project, status);
    },
  };
}
