"use client";

import { useEffect, useState } from "react";

type ProbeState =
  | { kind: "checking" }
  | { kind: "absent"; where: string }
  | { kind: "register-error"; message: string }
  | { kind: "registered"; tools: string[]; via: "document" | "navigator" };

// Phase 0 kill-test probe: does the WebMCP API exist and does registerTool round-trip
// in the browser we can actually drive (Claude in Chrome / ChatGPT browser)?
export default function ProbePage() {
  const [state, setState] = useState<ProbeState>({ kind: "checking" });

  useEffect(() => {
    (async () => {
      const ctx =
        (typeof document !== "undefined" && document.modelContext) ||
        (typeof navigator !== "undefined" && navigator.modelContext) ||
        null;
      const via = document.modelContext ? "document" : "navigator";

      if (!ctx || typeof ctx.registerTool !== "function") {
        setState({
          kind: "absent",
          where:
            typeof document !== "undefined" && "modelContext" in document
              ? "document.modelContext present but registerTool missing"
              : "document.modelContext is undefined",
        });
        return;
      }

      try {
        await ctx.registerTool({
          name: "spendgate_probe_ping",
          description: "Probe tool to verify WebMCP registration round-trips.",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
          annotations: { readOnlyHint: true },
          execute: async () => ({ ok: true, at: new Date().toISOString() }),
        });
        const tools = ctx.getTools ? await ctx.getTools() : [];
        setState({
          kind: "registered",
          tools: tools.map((t) => t.name),
          via: via as "document" | "navigator",
        });
      } catch (err) {
        setState({
          kind: "register-error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    })();
  }, []);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 32, maxWidth: 720 }}>
      <h1>WebMCP Probe</h1>
      <p style={{ color: "#666" }}>
        Phase 0 kill-test. Result below is machine-readable via <code>#probe-result</code>.
      </p>
      <pre
        id="probe-result"
        data-kind={state.kind}
        style={{
          background: state.kind === "registered" ? "#052e16" : state.kind === "checking" ? "#1e293b" : "#450a0a",
          color: "#e2e8f0",
          padding: 20,
          borderRadius: 12,
          fontSize: 16,
          lineHeight: 1.6,
        }}
      >
        {renderState(state)}
      </pre>
      {state.kind === "absent" && (
        <ol style={{ color: "#666", lineHeight: 1.7 }}>
          <li>Open <code>chrome://version</code>, need Chrome 146+.</li>
          <li>Enable <code>chrome://flags/#enable-webmcp-testing</code> and relaunch.</li>
          <li>If still absent, this Chrome build lacks WebMCP; verify in the ChatGPT desktop app (Sol/Terra account) instead.</li>
        </ol>
      )}
    </main>
  );
}

function renderState(state: ProbeState): string {
  switch (state.kind) {
    case "checking":
      return "⏳ CHECKING, running registration probe…";
    case "absent":
      return `❌ API ABSENT, ${state.where}\n\nWebMCP is not exposed in this browser context.`;
    case "register-error":
      return `⚠️ REGISTER ERROR, registerTool threw:\n${state.message}`;
    case "registered":
      return `✅ REGISTERED (via ${state.via}.modelContext)\n\ngetTools() → ${
        state.tools.length
      } tool(s):\n${state.tools.map((t) => `  • ${t}`).join("\n")}`;
  }
}
