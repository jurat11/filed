import { defineConfig, devices } from "@playwright/test";

// End-to-end tests run against a production build reading a Postgres seeded from the test
// fixtures (`uv run filed seed`), never against Neon. See README "Tests".
const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `pnpm start -p ${PORT}`,
    url: `http://localhost:${PORT}/sources`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: { REVALIDATE_SECRET: process.env.REVALIDATE_SECRET ?? "e2e-secret" },
  },
});
