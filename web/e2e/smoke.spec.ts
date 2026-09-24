import { expect, type Page, test } from "@playwright/test";

/** Text that means a missing value leaked through as a broken number. */
async function expectNoBrokenNumbers(page: Page) {
  const text = await page.locator("main").innerText();
  expect(text).not.toMatch(/\bNaN\b|\bundefined\b|\bnull\b|Infinity/);
}

test("home page searches employers", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Which employers");
  await page.getByLabel("Employer name").fill("google");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/\?q=google/);
  await expect(page.getByRole("link", { name: /Google LLC/ })).toBeVisible();
  await expectNoBrokenNumbers(page);
});

test("USCIS-only employer shows no LCA match instead of zero", async ({ page }) => {
  await page.goto("/?q=synthetic+test");
  const hit = page.getByRole("link", { name: /SYNTHETIC TEST UNIVERSITY/ });
  await expect(hit).toContainText("no LCA match");
  await expect(hit).not.toContainText("0 certified");
  await hit.click();
  await expect(page.getByText("No LCA match: USCIS data only")).toBeVisible();
  await expectNoBrokenNumbers(page);
});

test("employer page shows source-tagged figures", async ({ page }) => {
  await page.goto("/employer/google-llc");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Google LLC");
  await expect(page.getByText("FEIN 77-0493581")).toBeVisible();
  await expect(page.getByRole("heading", { name: "LCAs by fiscal year" })).toBeVisible();
  // Every LCA year row carries a source tag linking to /sources.
  const tags = page.locator('a[href="/sources"]', { hasText: /DOL LCA FY\d{4}/ });
  expect(await tags.count()).toBeGreaterThanOrEqual(4);
  await expect(page.getByText(/USCIS Data Hub FY2023/).first()).toBeVisible();
  await expectNoBrokenNumbers(page);
});

test("unknown employer is a 404", async ({ page }) => {
  const res = await page.goto("/employer/no-such-employer-xyz");
  expect(res?.status()).toBe(404);
});

test("explore filters and sorts", async ({ page }) => {
  await page.goto("/explore?role=Software+engineering&sort=name");
  const rows = page.locator("tbody tr");
  expect(await rows.count()).toBeGreaterThan(0);
  await expectNoBrokenNumbers(page);
});

test("explore survives hostile parameters", async ({ page }) => {
  const res = await page.goto(
    "/explore?sort=constructor&min=Infinity&fy=2025'%20OR%201=1&state=VA'--&role=%3Cscript%3E&page=-1",
  );
  expect(res?.status()).toBe(200);
  expect(await page.locator("tbody tr").count()).toBeGreaterThan(0);
});

test("explore export is a CSV of the same employers", async ({ page, request }) => {
  const q = "role=Software+engineering&sort=name";
  await page.goto(`/explore?${q}`);
  const shown = await page.locator("tbody tr td:first-child a").allInnerTexts();
  const res = await request.get(`/explore/export?${q}`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/csv");
  const lines = (await res.text()).trim().split("\n");
  expect(lines[0]).toMatch(/^employer,state,certified_lcas,mean_offered_wage/);
  expect(lines.length - 1).toBe(shown.length);
});

test("sources lists the loaded files", async ({ page }) => {
  await page.goto("/sources");
  await expect(page.getByRole("heading", { name: "Sources and method" })).toBeVisible();
  await expect(page.getByText("h1b_datahubexport-2023.csv")).toBeVisible();
  await expect(page.getByText(/USCIS years loaded: FY2023, FY2024, FY2025/)).toBeVisible();
});
