import { chromium } from "playwright-core";
const SP = process.env.SP;
const b = await chromium.launch({ channel: "chrome", args: ["--hide-scrollbars"] });
const page = await b.newPage({ viewport: { width: 1280, height: 950 } });
await page.goto("http://mstomato.lvh.me:3100/", { waitUntil: "networkidle", timeout: 90000 });
await page.waitForTimeout(1500);

// Category chips live in the pinned category bar.
const bar = page.locator(".sf-catbar, .sf-cats, [class*='catbar']").first();
const chips = (await bar.locator("button").allTextContents()).map(s => s.trim()).filter(Boolean);
console.log("CHIPS:", JSON.stringify(chips));

for (const name of chips) {
  const chip = bar.getByRole("button", { name, exact: true }).first();
  await chip.click();
  await page.waitForTimeout(700);
  const cards = await page.locator(".product-card").count();
  console.log(`  ${name.padEnd(16)} → ${cards} product card(s)`);
}
await bar.getByRole("button", { name: chips[0], exact: true }).first().click();
await page.waitForTimeout(600);
await page.screenshot({ path: `${SP}/mstomato-cats.png`, clip: { x: 0, y: 0, width: 1280, height: 950 } });
await b.close();
