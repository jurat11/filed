import { expect, test } from "@playwright/test";

const SECRET = process.env.REVALIDATE_SECRET ?? "e2e-secret";

test.describe("search", () => {
  test("ranks an exact normalized match first and treats & and 'and' alike", async ({ page }) => {
    await page.goto("/?q=ernst+and+young");
    await expect(page.locator("main ul li").first()).toContainText("Ernst & Young U.S. LLP");
    await page.goto("/?q=microsoft");
    await expect(page.locator("main ul li").first()).toContainText("Microsoft Corporation");
  });

  test("shows the matched name variant when it differs from the display name", async ({ page }) => {
    await page.goto("/?q=government+employees+insurance");
    const hit = page.locator("main ul li").first();
    await expect(hit).toContainText("Government Employee Insurance Company (GEICO)");
    await expect(hit).toContainText("matched “Government Employees Insurance Company (GEICO)”");
  });

  test("typeahead suggests and navigates with the keyboard", async ({ page }) => {
    await page.goto("/");
    const box = page.getByRole("combobox", { name: "Employer name" });
    await box.fill("goog");
    const list = page.getByRole("listbox", { name: "Employer suggestions" });
    await expect(list.getByRole("option").first()).toContainText("Google LLC");
    await box.press("ArrowDown");
    await expect(box).toHaveAttribute("aria-activedescendant", /.+/);
    await box.press("Enter");
    await expect(page).toHaveURL(/\/employer\/google-llc$/);
  });

  test("works without JavaScript", async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false });
    const page = await ctx.newPage();
    await page.goto("/");
    await page.getByLabel("Employer name").fill("google");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page.getByRole("link", { name: /Google LLC/ })).toBeVisible();
    await ctx.close();
  });
});

test.describe("employer page", () => {
  test("has a trend line, per-role wages and similar employers", async ({ page }) => {
    await page.goto("/employer/compunnel-software-group-inc");
    await expect(page.getByRole("img", { name: /Certified LCAs by fiscal year/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Offered wage by role group/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Similar employers" })).toBeVisible();
    await expect(page.getByText(/Same NAICS industry code \(541511/)).toBeVisible();
  });

  test("links related legal entities both ways without merging them", async ({ page }) => {
    await page.goto("/employer/asml-us-llc");
    const related = () =>
      page.locator("section", { has: page.getByRole("heading", { name: "Related legal entities" }) });
    await related().getByRole("link", { name: "ASML US, LP" }).click();
    await expect(page).toHaveURL(/\/employer\/asml-us-lp$/);
    await expect(related().getByRole("link", { name: "ASML US, LLC" })).toBeVisible();
  });

  test("has an Open Graph image with a source line", async ({ page, request }) => {
    await page.goto("/employer/google-llc");
    const og = await page.locator('meta[property="og:image"]').getAttribute("content");
    expect(og).toContain("/employer/google-llc/opengraph-image");
    const res = await request.get(new URL(og!).pathname);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("image/png");
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /certified H-1B LCAs in FY2026/);
  });
});

test.describe("explore", () => {
  test("paginates, and the CSV lists exactly the employers of every page in order", async ({ page, request }) => {
    const q = "sort=wage&level=I,II";
    await page.goto(`/explore?${q}`);
    const pages = Number((await page.getByText(/^Page 1 of \d+$/).innerText()).split(" of ")[1]);
    expect(pages).toBeGreaterThan(1);
    const names: string[] = [];
    for (let i = 1; i <= pages; i++) {
      await page.goto(`/explore?${q}&page=${i}`);
      names.push(...(await page.locator("tbody tr td:first-child > a").allInnerTexts()));
    }
    expect(names.length).toBeGreaterThan(50);
    const csv = await (await request.get(`/explore/export?${q}`)).text();
    const exported = csv
      .trim()
      .split("\n")
      .slice(1)
      .map((l) => (l.startsWith('"') ? l.slice(1, l.indexOf('",')).replace(/""/g, '"') : l.split(",")[0]));
    expect(exported).toEqual(names);
  });

  test("filter chips reflect the URL and remove one filter each", async ({ page }) => {
    await page.goto("/explore?role=Finance&state=NY,NJ&level=I");
    const chips = page.getByLabel("Active filters");
    await expect(chips.getByRole("link", { name: "Remove filter: NY" })).toBeVisible();
    await chips.getByRole("link", { name: "Remove filter: NY" }).click();
    await expect(page).toHaveURL(/state=NJ/);
    await expect(page).not.toHaveURL(/NY/);
    await expect(page.getByLabel("Active filters").getByRole("link", { name: "Remove filter: Finance" })).toBeVisible();
  });

  test("state multi-select submits several states", async ({ page }) => {
    await page.goto("/explore");
    await page.getByText("Worksite states: all").click();
    await page.getByRole("checkbox", { name: "TX" }).check();
    await page.getByRole("checkbox", { name: "CA" }).check();
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/state=CA.*state=TX|state=TX.*state=CA/);
    await expect(page.getByLabel("Active filters").getByRole("link", { name: "Remove filter: TX" })).toBeVisible();
  });

  test("a page past the end goes back to page 1", async ({ page }) => {
    await page.goto("/explore?page=9999");
    await expect(page).toHaveURL(/\/explore$/);
  });
});

test.describe("crawlers", () => {
  test("sitemap index, chunks and robots.txt", async ({ request }) => {
    const index = await (await request.get("/sitemap.xml")).text();
    expect(index).toContain("<sitemapindex");
    expect(index).toContain("/sitemaps/0");
    const chunk = await (await request.get("/sitemaps/0")).text();
    expect(chunk).toContain("/employer/google-llc</loc>");
    expect((await request.get("/sitemaps/abc")).status()).toBe(404);
    const robots = await (await request.get("/robots.txt")).text();
    expect(robots).toContain("Disallow: /api/");
    expect(robots).toMatch(/Sitemap: .*\/sitemap\.xml/);
  });
});

test.describe("revalidate route", () => {
  test("rejects a wrong secret", async ({ request }) => {
    const res = await request.post("/api/revalidate", {
      headers: { Authorization: "Bearer nope" },
      data: { loaded_at: "x" },
    });
    expect(res.status()).toBe(401);
  });

  test("refuses a loaded_at the database does not show, accepts the current one", async ({ request }) => {
    const headers = { Authorization: `Bearer ${SECRET}` };
    const stale = await request.post("/api/revalidate", { headers, data: { loaded_at: "1999-01-01" } });
    expect(stale.status()).toBe(409);
    const { current } = await stale.json();
    const ok = await request.post("/api/revalidate", { headers, data: { loaded_at: current } });
    expect(ok.status()).toBe(200);
    expect(await ok.json()).toEqual({ revalidated: true, loaded_at: current });
  });
});
