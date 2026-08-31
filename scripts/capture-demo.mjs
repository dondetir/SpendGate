// Captures the SpendGate demo flow to a 1080p video via Playwright.
// Records the real app driven through: login → triage → injection reveal →
// detail refusal → manager unlock → approve. Injects a visible cursor + click
// pulses (Playwright's recordVideo does not capture the OS cursor).
//
// Usage: node scripts/capture-demo.mjs [baseURL] [outDir]
import { chromium } from "playwright";
import { mkdirSync, renameSync, readdirSync } from "node:fs";

const BASE = process.argv[2] || "http://localhost:3002";
const OUT = process.argv[3] || "./output/video";
const W = 1920, H = 1080;
mkdirSync(OUT, { recursive: true });

const CURSOR = () => {
  const c = document.createElement("div");
  c.id = "__cur";
  Object.assign(c.style, { position: "fixed", left: "0px", top: "0px", zIndex: "2147483647", pointerEvents: "none", transition: "left .65s cubic-bezier(.22,1,.36,1), top .65s cubic-bezier(.22,1,.36,1)", filter: "drop-shadow(0 2px 3px rgba(0,0,0,.35))" });
  c.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24" fill="#111" stroke="#fff" stroke-width="1.4"><path d="M4 2 L4 20 L9.2 15 L12.2 22 L15 20.8 L12 13.8 L19 13.8 Z"/></svg>';
  document.body.appendChild(c);
  window.__moveCur = (x, y) => { const e = document.getElementById("__cur"); if (e) { e.style.left = x + "px"; e.style.top = y + "px"; } };
  window.__pulse = (x, y) => { const r = document.createElement("div"); Object.assign(r.style, { position: "fixed", left: (x - 16) + "px", top: (y - 16) + "px", width: "32px", height: "32px", border: "2px solid rgba(24,24,27,.55)", borderRadius: "50%", zIndex: "2147483646", pointerEvents: "none", transition: "transform .45s ease-out, opacity .45s ease-out", opacity: "1" }); document.body.appendChild(r); requestAnimationFrame(() => { r.style.transform = "scale(2.1)"; r.style.opacity = "0"; }); setTimeout(() => r.remove(), 480); };
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const browser = await chromium.launch({ args: ["--enable-features=WebMCP", "--force-device-scale-factor=1"] });
  const context = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: OUT, size: { width: W, height: H } } });
  const page = await context.newPage();

  // Clean server state: analyst + fresh board, before we load the UI.
  await page.request.post(`${BASE}/api/login`, { data: { role: "analyst" } });
  await page.request.post(`${BASE}/api/reset`);

  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.evaluate(CURSOR);

  const move = async (loc) => {
    const b = await loc.boundingBox();
    const x = Math.round(b.x + b.width / 2), y = Math.round(b.y + b.height / 2);
    await page.evaluate(({ x, y }) => window.__moveCur(x, y), { x, y });
    await sleep(750);
    return { x, y };
  };
  const click = async (loc) => {
    const { x, y } = await move(loc);
    await page.evaluate(({ x, y }) => window.__pulse(x, y), { x, y });
    await sleep(120);
    await loc.click();
  };

  // Scene: sign in as Analyst
  await sleep(1400);
  await click(page.locator("button", { hasText: "Analyst" }).first());
  await sleep(1600);

  // Scene: run review → stream
  await click(page.getByRole("button", { name: "Review expenses" }));
  await sleep(9500); // let 40 cards stream + settle

  // Scene: untrusted memo flagged
  await click(page.getByText(/Review flagged memo/).first());
  await sleep(3200);

  // Scene: open the $4,200 card → detail → request approval (refused)
  await click(page.getByText("$4,200").first());
  await sleep(2200);
  await click(page.getByRole("button", { name: "Request approval" }));
  await sleep(3600);

  // close, switch to Manager (chip 4→5)
  await click(page.getByRole("button", { name: "Close" }));
  await sleep(900);
  await click(page.locator("header").getByText("manager", { exact: true }));
  await sleep(2200);

  // reopen $4,200 → approve as manager → card moves
  await click(page.getByText("$4,200").first());
  await sleep(1500);
  await click(page.getByRole("button", { name: "Approve as manager" }));
  await sleep(3200);
  await click(page.getByRole("button", { name: "Close" }));
  await sleep(1600);

  const video = page.video();
  await context.close(); // finalizes the video file
  await browser.close();
  const src = await video.path();
  const dst = `${OUT}/app-capture.webm`;
  renameSync(src, dst);
  console.log("VIDEO:", dst);
  console.log("dir listing:", readdirSync(OUT).join(", "));
}

main().catch((e) => { console.error("CAPTURE FAILED:", e.message); process.exit(1); });
