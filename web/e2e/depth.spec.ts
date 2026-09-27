import { expect, test } from "@playwright/test";

test("a university is flagged likely cap-exempt with the rule shown", async ({ page }) => {
  await page.goto("/employer/harvard-university");
  await expect(page.getByText("Likely cap-exempt", { exact: true })).toBeVisible();
  await expect(page.getByText(/most of its LCAs give NAICS 611310/)).toBeVisible();
  await expect(page.getByText(/not a USCIS\s+determination/)).toBeVisible();
});

test("a company is not flagged", async ({ page }) => {
  await page.goto("/employer/google-llc");
  await expect(page.getByText("Likely cap-exempt", { exact: true })).toHaveCount(0);
});

test("explore can hide likely cap-exempt employers", async ({ page, request }) => {
  const all = await (await request.get("/explore/export")).text();
  const hidden = await (await request.get("/explore/export?hide_cap_exempt=1")).text();
  expect(all).toContain("Harvard University");
  expect(hidden).not.toContain("Harvard University");
  expect(hidden).toContain("Google LLC");
  await page.goto("/explore?hide_cap_exempt=1");
  await expect(page.getByLabel("Active filters").getByRole("link", { name: /Likely cap-exempt hidden/ })).toBeVisible();
});

test("per-role table shows the prevailing wage next to the offered wage", async ({ page }) => {
  await page.goto("/employer/compunnel-software-group-inc");
  await expect(page.getByRole("columnheader", { name: "Prevailing wage, median" })).toBeVisible();
});

test("a reviewed group links members without merging them", async ({ page }) => {
  await page.goto("/employer/amazon-com-services-llc");
  const section = page.locator("section", { has: page.getByRole("heading", { name: "Related entities (reviewed)" }) });
  await expect(section.getByRole("link", { name: "Amazon Web Services, Inc." })).toBeVisible();
  await section.getByRole("link", { name: "See them side by side" }).click();
  await expect(page).toHaveURL(/\/group\/amazon$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Amazon.com Inc. subsidiaries");
  await expect(page.getByText("Sum of the separate employers above")).toBeVisible();
  await expect(page.getByRole("link", { name: "Amazon.com Services LLC" })).toBeVisible();
  await expect(page.locator('main a[href="/sources"]').first()).toContainText(/DOL LCA FY\d{4}/);
});

test("unknown group is a 404", async ({ page }) => {
  expect((await page.goto("/group/nope"))?.status()).toBe(404);
});

test("guide explains the terms and says how current the data is", async ({ page }) => {
  await page.goto("/guide");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("How to read the numbers");
  await expect(page.getByText("Level I is the entry level")).toBeVisible();
  await expect(page.getByText(/June 30, 2026 \(FY2026 Q3\)/)).toBeVisible();
});

test("theme toggle switches and is remembered", async ({ page }) => {
  await page.goto("/");
  const toggle = page.getByRole("button", { name: /Switch to (dark|light) theme/ });
  const before = await toggle.getAttribute("aria-label");
  await toggle.click();
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  expect(before).toContain(theme!);
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
});

test("home shows headline numbers with sources and freshness", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Up to date through")).toBeVisible();
  await expect(page.getByText("June 30, 2026").first()).toBeVisible();
  await expect(page.locator("footer")).toContainText("DOL LCA data through June 30, 2026 (FY2026 Q3 release)");
});
