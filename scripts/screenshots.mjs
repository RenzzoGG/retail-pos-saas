// Takes the README screenshots (docs/screenshots/*.png) from a running app
// with the LOCAL seed data (fictional store). Read-only: nothing is sold
// (the cart is left unpaid) and the ticket is the latest seeded sale.
//
//   npm run db:reset                      # fresh seed (optional)
//   PORT=3000 npm run docker:prod         # or: npm run build && npm run start
//   node scripts/screenshots.mjs          # BASE_URL defaults to http://localhost:3000
//
// The 80 mm ticket is a PDF. If PDFJS_DIR points to an installed pdfjs-dist
// (npm install pdfjs-dist@4 in any folder), it is rendered to PNG with pdf.js
// in Chromium; otherwise only docs/screenshots/receipt.pdf is saved.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = "docs/screenshots";
const PASSWORD = "stocktill-demo"; // local seed only (see README)
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const viewport = { width: 1440, height: 900 };

async function signedIn(email) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, colorScheme: "light" });
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/app$/);
  return page;
}

async function shot(page, name, options = {}) {
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: join(OUT, `${name}.png`), ...options });
  console.log(`saved ${OUT}/${name}.png`);
}

// Landing (reduced motion: the hero shows the finished sale, no mid-animation frame).
{
  const context = await browser.newContext({ viewport, reducedMotion: "reduce", colorScheme: "light" });
  const page = await context.newPage();
  await page.goto(BASE_URL);
  await shot(page, "landing");
  await context.close();
}

// POS with a cart, as the cashier (scanner = keyboard input + Enter).
{
  const page = await signedIn("cashier@demo.stocktill.test");
  await page.goto(`${BASE_URL}/app/pos`, { waitUntil: "networkidle" });
  for (const code of ["2000000000015", "2000000000015", "2000000000053", "2000000000114", "2000000000176"]) {
    await page.keyboard.type(code, { delay: 2 });
    await page.keyboard.press("Enter");
  }
  await page.getByTestId("cart-line-AUD-EARBUD-W").waitFor();
  await shot(page, "pos");
  await page.context().close();
}

// Owner: dashboard, inventory, reports, and the latest ticket.
{
  const page = await signedIn("owner@demo.stocktill.test");
  await shot(page, "dashboard", { fullPage: true });

  await page.goto(`${BASE_URL}/app/products`);
  await shot(page, "inventory");

  await page.goto(`${BASE_URL}/app/reports`);
  await shot(page, "reports", { fullPage: true });

  await page.goto(`${BASE_URL}/app/sales`);
  const href = await page.locator('a[href^="/app/sales/"]').first().getAttribute("href");
  const saleId = href?.split("/")[3];
  const response = await page.request.get(`${BASE_URL}/app/sales/${saleId}/receipt`);
  if (!response.ok()) throw new Error(`receipt download failed: ${response.status()}`);
  const pdf = await response.body();
  writeFileSync(join(OUT, "receipt.pdf"), pdf);
  console.log(`saved ${OUT}/receipt.pdf`);

  const pdfjs = process.env.PDFJS_DIR ? join(process.env.PDFJS_DIR, "build") : null;
  if (pdfjs && existsSync(join(pdfjs, "pdf.min.mjs"))) {
    const viewer = await browser.newPage({ deviceScaleFactor: 1 });
    // Serve pdf.js and the PDF from a fake origin (no server, nothing leaves the machine).
    await viewer.route("http://pdf.local/**", (route) => {
      const name = new URL(route.request().url()).pathname.slice(1);
      if (name === "receipt.pdf") return route.fulfill({ body: pdf, contentType: "application/pdf" });
      if (name.endsWith(".mjs")) {
        return route.fulfill({ body: readFileSync(join(pdfjs, name)), contentType: "text/javascript" });
      }
      return route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><body style="margin:0;background:#e2e8f0;padding:24px;display:inline-block">
          <canvas id="c" style="box-shadow:0 2px 12px rgba(0,0,0,.2);background:#fff"></canvas>
          <script type="module">
            import * as pdfjs from "/pdf.min.mjs";
            pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
            const doc = await pdfjs.getDocument("/receipt.pdf").promise;
            const page = await doc.getPage(1);
            const vp = page.getViewport({ scale: 2.5 });
            const canvas = document.getElementById("c");
            canvas.width = vp.width; canvas.height = vp.height;
            await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
            document.body.dataset.done = "1";
          </script></body>`,
      });
    });
    await viewer.goto("http://pdf.local/index.html");
    await viewer.waitForSelector("body[data-done]");
    await viewer.locator("body").screenshot({ path: join(OUT, "receipt.png") });
    console.log(`saved ${OUT}/receipt.png`);
  } else {
    console.log("PDFJS_DIR not set: skipped receipt.png (receipt.pdf saved).");
  }
}

await browser.close();
