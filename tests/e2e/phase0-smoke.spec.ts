import { expect, test } from "@playwright/test";

const requiredViewports = [
  { width: 1920, height: 1080 },
  { width: 1600, height: 900 },
  { width: 1366, height: 768 },
  { width: 1280, height: 720 },
] as const;

for (const viewport of requiredViewports) {
  test(`keeps every Phase 0 shell region usable at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");

    for (const region of [
      "header",
      "left-rail",
      "center-workspace",
      "build-tray",
      "operations-stack",
    ]) {
      await expect(page.getByTestId(region)).toBeVisible();
    }
    await expect(page.getByTestId("active-task")).toBeVisible();
    await expect(page.getByText("Power", { exact: true })).toBeVisible();
    await expect(page.getByText("Temperature", { exact: true })).toBeVisible();

    const viewportFit = await page.evaluate(() => ({
      horizontalOverflow:
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
      verticalOverflow:
        document.documentElement.scrollHeight - document.documentElement.clientHeight,
    }));
    expect(viewportFit.horizontalOverflow).toBeLessThanOrEqual(1);
    expect(viewportFit.verticalOverflow).toBeLessThanOrEqual(1);

    const workspace = await page.getByTestId("center-workspace").boundingBox();
    expect(workspace?.width).toBeGreaterThan(500);
    expect(workspace?.height).toBeGreaterThan(280);
  });
}

test("resizes and destroys the empty Pixi canvas without application warnings", async ({
  page,
}) => {
  const browserProblems: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    const isChromiumDriverDiagnostic =
      text.includes("GL Driver Message") && text.includes("ReadPixels");
    if (
      (message.type() === "warning" || message.type() === "error") &&
      !isChromiumDriverDiagnostic
    ) {
      browserProblems.push(text);
    }
  });
  page.on("pageerror", (error) => browserProblems.push(error.message));

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  const canvas = page.getByTestId("pixi-canvas-host").locator("canvas");
  await expect(canvas).toBeVisible();

  const large = await canvas.evaluate((element) => ({
    backingWidth: (element as HTMLCanvasElement).width,
    backingHeight: (element as HTMLCanvasElement).height,
    clientWidth: element.clientWidth,
    clientHeight: element.clientHeight,
  }));
  expect(large.backingWidth).toBeGreaterThan(0);
  expect(large.backingHeight).toBeGreaterThan(0);

  await page.setViewportSize({ width: 1280, height: 720 });
  await expect
    .poll(async () => canvas.evaluate((element) => element.clientWidth))
    .not.toBe(large.clientWidth);
  const compact = await canvas.evaluate((element) => ({
    backingWidth: (element as HTMLCanvasElement).width,
    backingHeight: (element as HTMLCanvasElement).height,
    clientWidth: element.clientWidth,
    clientHeight: element.clientHeight,
  }));
  expect(compact.clientWidth).toBeLessThan(large.clientWidth);
  expect(compact.clientHeight).toBeLessThan(large.clientHeight);
  expect(compact.backingWidth).toBeGreaterThanOrEqual(compact.clientWidth);
  expect(compact.backingHeight).toBeGreaterThanOrEqual(compact.clientHeight);

  await page.reload();
  await expect(page.getByTestId("pixi-canvas-host").locator("canvas")).toHaveCount(1);
  expect(browserProblems).toEqual([]);
});

test("switches all placeholder chrome from Romanian to English", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("button", { name: "Setări" })).toBeVisible();
  await expect(page.getByText("Consolă de dezvoltare — simulare oprită")).toBeVisible();

  await page.getByRole("combobox", { name: "Limbă" }).selectOption("en");

  await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();
  await expect(page.getByText("Development console — simulation offline")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});
