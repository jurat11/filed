import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const PAGES = [
  "/",
  "/?q=google",
  "/employer/google-llc",
  "/employer/synthetic-test-university",
  "/explore",
  "/explore?role=Finance&state=NY",
  "/sources",
  "/employer/harvard-university",
  "/group/amazon",
  "/guide",
  "/employer/no-such-employer",
];

for (const scheme of ["light", "dark"] as const) {
  test.describe(`axe, ${scheme} mode`, () => {
    test.use({ colorScheme: scheme });
    for (const path of PAGES) {
      test(`${path} has no WCAG A/AA violations`, async ({ page }) => {
        await page.goto(path);
        const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
        const summary = res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`);
        expect(summary).toEqual([]);
      });
    }
  });
}

test("skip link is the first stop and moves focus to the content", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium");
  await page.goto("/explore");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);
});

test("explore filters are reachable by keyboard", async ({ page }) => {
  await page.goto("/explore");
  await page.getByRole("checkbox", { name: "Finance" }).focus();
  await page.keyboard.press("Space");
  await page.getByRole("button", { name: "Apply" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/role=Finance/);
});
