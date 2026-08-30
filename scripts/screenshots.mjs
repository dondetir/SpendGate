// Visual smoke-check: drive the real board in headless Chromium and capture the
// key demo frames. Not a WebMCP test (that needs the ChatGPT browser) — this
// proves the console renders and the triage animation + injection beat land.
//   npm run dev   # in another shell
//   npm run verify:ui
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = process.env.OUT ?? "/tmp";

const b = await chromium.launch();
try {
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  await p.goto(BASE, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `${OUT}/sg-1-pending.png` });

  await p.getByText("Run triage", { exact: false }).click();
  await p.waitForTimeout(1200); // mid-flight: cards should be between columns, not teleporting
  await p.screenshot({ path: `${OUT}/sg-2a-midflight.png` });
  await p.waitForTimeout(1300);
  await p.screenshot({ path: `${OUT}/sg-2b-midflight.png` });
  await p.waitForTimeout(6000); // let the ~40-card drip finish
  await p.screenshot({ path: `${OUT}/sg-2-triaged.png`, fullPage: true });

  const reveal = p.getByText("Show the blocked memo");
  if (await reveal.count()) {
    await reveal.first().click();
    await p.waitForTimeout(700);
  }
  await p.screenshot({ path: `${OUT}/sg-3-injection.png`, fullPage: true });

  await p.getByRole("button", { name: "manager", exact: true }).click();
  await p.waitForTimeout(2000);
  await p.screenshot({ path: `${OUT}/sg-4-manager.png`, fullPage: true });

  const n = await b.newPage({ viewport: { width: 440, height: 850 } }); // ChatGPT in-app browser width
  await n.goto(BASE, { waitUntil: "domcontentloaded" });
  await n.waitForTimeout(1000);
  await n.getByText("Run triage", { exact: false }).click();
  await n.waitForTimeout(8500);
  await n.screenshot({ path: `${OUT}/sg-5-narrow.png`, fullPage: true });

  console.log(`screenshots written to ${OUT}/sg-*.png`);
} finally {
  await b.close();
}
