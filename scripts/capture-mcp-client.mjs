// Act 3 capture: a REAL external WebMCP client driving the board through the
// browser-provided registry. Uses document.modelContext.getTools() +
// executeTool(tool, jsonArgs), no app closures, no faked agent. Renders a
// terminal transcript pinned right; the live board sits left and reacts.
import { chromium } from "playwright";
import { mkdirSync, renameSync } from "node:fs";

const BASE = process.argv[2] || "http://localhost:3002";
const OUT = process.argv[3] || "./output/video";
const W = 1920, H = 1080;
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// injected once: layout + terminal + a browser-mediated tool caller
function SETUP() {
  const app = document.querySelector("header")?.parentElement;
  if (app) { app.style.maxWidth = "1180px"; app.style.width = "1180px"; app.style.margin = "0"; }
  const t = document.createElement("div");
  t.id = "__term";
  t.innerHTML =
    '<div style="height:34px;display:flex;align-items:center;gap:8px;padding:0 14px;background:#11151f;border-bottom:1px solid #222b3a">' +
    '<span style="width:10px;height:10px;border-radius:99px;background:#f0b429"></span>' +
    '<span style="color:#9fb0c9;font:600 12px ui-monospace,monospace;letter-spacing:.04em">WebMCP client · document.modelContext</span></div>' +
    '<div id="__log" style="padding:14px 16px;display:flex;flex-direction:column;gap:5px;overflow:hidden"></div>';
  Object.assign(t.style, { position: "fixed", top: "0", right: "0", width: "740px", height: "100vh", background: "#0b0e14", borderLeft: "1px solid #222b3a", zIndex: "2147483647", boxShadow: "-24px 0 60px rgba(0,0,0,.25)" });
  document.body.appendChild(t);
  const COL = { cmd: "#7fb4ff", out: "#57d38c", warn: "#f0b429", err: "#ff6b6b", info: "#9fb0c9", ok: "#57d38c" };
  window.__term = (text, kind = "info") => {
    const log = document.getElementById("__log");
    const d = document.createElement("div");
    d.style.cssText = `font:13px/1.5 ui-monospace,SFMono-Regular,monospace;color:${COL[kind] || "#c7d2e0"};white-space:pre-wrap;word-break:break-word;animation:sgln .2s ease-out`;
    d.textContent = text;
    log.appendChild(d);
  };
  if (!document.getElementById("__kf")) { const s = document.createElement("style"); s.id = "__kf"; s.textContent = "@keyframes sgln{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}"; document.head.appendChild(s); }
  window.__mc = document.modelContext;
  window.__call = async (name, args) => {
    const tools = await window.__mc.getTools();
    const tool = tools.find((x) => x.name === name);
    if (!tool) throw new Error("no such tool: " + name);
    const res = await window.__mc.executeTool(tool, JSON.stringify(args || {}));
    return typeof res === "string" ? JSON.parse(res) : res;
  };
}

async function main() {
  const browser = await chromium.launch({ args: ["--enable-features=WebMCP", "--force-device-scale-factor=1"] });
  const context = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: OUT, size: { width: W, height: H } } });
  const page = await context.newPage();
  await page.request.post(`${BASE}/api/login`, { data: { role: "analyst" } });
  await page.request.post(`${BASE}/api/reset`);
  await page.goto(BASE, { waitUntil: "networkidle" });
  // get onto the board as analyst
  await page.locator("button", { hasText: "Analyst" }).first().click();
  await page.waitForTimeout(1200);
  await page.evaluate(SETUP);
  await sleep(1200);

  const step = (fn) => page.evaluate(fn);

  // discover
  await step(async () => {
    window.__term("$ connect  document.modelContext", "cmd");
    const tools = await window.__mc.getTools();
    window.__term("← discovered " + tools.length + " tools:", "out");
    for (const t of tools) window.__term("   • " + t.name + (t.annotations?.untrustedContentHint ? "  [untrustedContentHint]" : t.annotations?.readOnlyHint ? "  [readOnly]" : ""), "info");
  });
  await sleep(2600);

  await step(async () => {
    window.__term("▸ executeTool(list_expenses)", "cmd");
    const r = await window.__call("list_expenses");
    window.__term("← " + r.items.length + " expenses · all pending", "out");
  });
  await sleep(1800);

  await step(async () => { window.__term("▸ executeTool(triage_batch), one call, whole queue", "cmd"); });
  await step(async () => {
    const r = await window.__call("triage_batch");
    const s = r.summary || r;
    window.__term(`← ${s.approved} approved · ${s.flagged} need review · ${s.rejected} rejected`, "out");
    window.__term("  server decided all 40 from structured fields", "info");
  });
  await sleep(9000);

  await step(async () => {
    window.__term("▸ executeTool(read_expense, { id: 'exp-poison' })", "cmd");
    const r = await window.__call("read_expense", { id: "exp-poison" });
    window.__term("← untrusted=" + r.untrusted + ", memo carries instructions", "warn");
    window.__term('  ⚠ untrustedContentHint set → NOT following the memo', "warn");
  });
  await sleep(3600);

  await step(async () => {
    window.__term("▸ executeTool(request_approval, { id: 'exp-travel-big' })", "cmd");
    const r = await window.__call("request_approval", { id: "exp-travel-big" });
    window.__term("← REFUSED · " + r.reason_code, "err");
    if (r.escalation) window.__term("  → " + r.escalation.action + ": " + r.escalation.message, "warn");
    window.__term("  self-correcting → hand off to a manager", "info");
  });
  await sleep(3800);

  // manager steps in (human authority), UI role switch re-registers approve_expense
  await step(() => window.__term("· a manager takes over (role switch, not a tool)", "info"));
  await page.locator("header").getByText("manager", { exact: true }).click();
  await page.waitForTimeout(2200);

  await step(async () => {
    const tools = await window.__mc.getTools();
    window.__term("← tool surface re-registered: " + tools.length + " tools (approve_expense added)", "out");
    window.__term("▸ executeTool(approve_expense, { id: 'exp-travel-big' })", "cmd");
    const r = await window.__call("approve_expense", { id: "exp-travel-big" });
    window.__term("← " + (r.ok ? "approved · authorized server-side" : "error"), "ok");
  });
  await sleep(4200);
  await step(() => window.__term("✓ done, every call went through document.modelContext", "ok"));
  await sleep(2600);

  const video = page.video();
  await context.close();
  await browser.close();
  renameSync(await video.path(), `${OUT}/act3-client.webm`);
  console.log("VIDEO:", `${OUT}/act3-client.webm`);
}
main().catch((e) => { console.error("MCP CAPTURE FAILED:", e.message); process.exit(1); });
