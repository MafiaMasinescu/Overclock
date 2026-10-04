import { expect, test, type Page } from "@playwright/test";
import type { mount } from "./fixtures/task23ShellHarness.tsx";

declare global {
  interface Window {
    task23Shell: Awaited<ReturnType<typeof mount>>;
  }
}
async function shell(page: Page) {
  await page.goto("/tests/e2e/fixtures/task23ShellHarness.html");
  await page.evaluate(async () => {
    const url = "/tests/e2e/fixtures/task23ShellHarness.tsx";
    const module = (await import(/* @vite-ignore */ url)) as { mount: typeof mount };
    window.task23Shell = await module.mount();
  });
  await expect(page.locator("canvas")).toBeVisible();
}
const moduleA = "module-instance-00000002";
const route = "route-00000001";

test("client replacement keeps the selected Pan tool synchronized with the new canvas", async ({
  page,
}) => {
  await shell(page);
  const pan = page.getByRole("button", { name: "Pan", exact: true });
  await pan.click();
  const canvas = page.locator("canvas");
  const previousCanvas = await canvas.elementHandle();
  await page.evaluate(() => window.task23Shell.replace("client"));
  await expect.poll(() => previousCanvas.evaluate((node) => node.isConnected)).toBe(false);
  await expect(canvas).toBeVisible();
  await expect(pan).toHaveAttribute("aria-pressed", "true");
  const before = await canvas.screenshot();
  const bounds = await canvas.boundingBox();
  if (bounds === null) throw new Error("Canvas missing");
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 70, center.y + 60);
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.task23Shell.contexts)).toEqual([]);
  await expect.poll(async () => (await canvas.screenshot()).equals(before)).toBe(false);
  expect(
    await page.evaluate(() => window.task23Shell.snapshot().inspector.selectedEntityId),
  ).toBeNull();
});

test("same-epoch full resync synchronizes cleared selection instead of restoring old outlines", async ({
  page,
}) => {
  await shell(page);
  const option = page.getByRole("option", { name: moduleA, exact: true });
  await option.click();
  await expect
    .poll(() => page.evaluate(() => window.task23Shell.snapshot().inspector.selectedEntityId))
    .toBe(moduleA);
  const transitions = await page.evaluate(() => window.task23Shell.resyncSelection());
  expect(transitions).toContain("resync-required");
  await expect(option).toHaveAttribute("aria-selected", "false");
  await expect
    .poll(() => page.evaluate(() => window.task23Shell.snapshot().inspector.selectedEntityId))
    .toBeNull();
  await expect
    .poll(() => page.evaluate(() => window.task23Shell.getClient().getConnectionStatus()))
    .toBe("live");
  expect(
    (await page.evaluate(() => window.task23Shell.grid().modules)).every(
      (module) => !module.selected,
    ),
  ).toBe(true);
  expect(
    (await page.evaluate(() => window.task23Shell.grid().routes)).every((route) => !route.selected),
  ).toBe(true);
  expect((await page.evaluate(() => window.task23Shell.contexts)).at(-1)).toEqual([]);
  await option.click();
  await expect
    .poll(() => page.evaluate(() => window.task23Shell.snapshot().inspector.selectedEntityId))
    .toBe(moduleA);
});

test("Worker failure cancels selection gestures and disables clock without unhandled rejection", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await shell(page);
  await page.getByRole("option", { name: moduleA, exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.task23Shell.snapshot().inspector.selectedEntityId))
    .toBe(moduleA);
  const canvas = page.locator("canvas");
  const bounds = await canvas.boundingBox();
  if (bounds === null) throw new Error("Canvas missing");
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 70, bounds.y + bounds.height / 2 + 70);
  await page.evaluate(() => window.task23Shell.failWorker());
  await expect(page.locator(".connection-banner")).toBeVisible();
  await expect(page.getByRole("option", { name: route, exact: true })).toBeDisabled();
  await expect(page.getByRole("option", { name: moduleA, exact: true })).toHaveAttribute(
    "aria-selected",
    "false",
  );
  await expect(page.getByRole("button", { name: "2×", exact: true })).toBeDisabled();
  await expect(page.locator(".pause-indicator")).toBeDisabled();
  await page.mouse.up();
  await canvas.dispatchEvent("keydown", { key: "Enter" });
  await page.getByRole("option", { name: route, exact: true }).dispatchEvent("click");
  await page.getByRole("button", { name: "2×", exact: true }).dispatchEvent("click");
  await page.locator(".pause-indicator").dispatchEvent("click");
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.task23Shell.contexts)).toEqual([[moduleA]]);
  expect(errors).toEqual([]);
  await page.evaluate(() => window.task23Shell.replace("client"));
  await expect(page.getByRole("option", { name: route, exact: true })).toBeEnabled();
  await page.getByRole("option", { name: route, exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.task23Shell.snapshot().inspector.selectedEntityId))
    .toBe(route);
});

test("DOM and canvas share selection without publication feedback", async ({ page }) => {
  await shell(page);
  const before = await page.evaluate(() => window.task23Shell.savedEvidence());
  const option = page.getByRole("option", { name: moduleA, exact: true });
  await option.click();
  await expect(option).toHaveAttribute("aria-selected", "true");
  await expect
    .poll(() => page.evaluate(() => window.task23Shell.snapshot().inspector.selectedEntityId))
    .toBe(moduleA);
  const after = await page.evaluate(() => window.task23Shell.savedEvidence());
  expect(after).toEqual(before);
  console.log(`Task23 selection save evidence: ${JSON.stringify(before)}`);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.screenshot({ path: "test-results/task23-worker-shell-en-1600x900.png" });
  await page.evaluate(() => window.task23Shell.setLanguage("ro"));
  await expect(page.getByTestId("operations-stack")).toContainText("Inspector");
  await page.screenshot({ path: "test-results/task23-worker-shell-ro-1600x900.png" });
  await page.evaluate(() => window.task23Shell.setLanguage("en"));
  await page.evaluate(() => window.task23Shell.command({ kind: "SET_SPEED", speed: 2 }));
  await expect(option).toHaveAttribute("aria-selected", "true");
  await page.waitForTimeout(350);
  expect(await page.evaluate(() => window.task23Shell.contexts)).toEqual([[moduleA]]);
  await page.getByRole("option", { name: route, exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.task23Shell.snapshot().inspector.selectedEntityId))
    .toBe(route);
  const canvas = page.locator("canvas");
  await canvas.focus();
  await page.keyboard.press("Enter");
  await expect
    .poll(() => page.evaluate(() => window.task23Shell.snapshot().inspector.selectedEntityId))
    .toBe("tile:0:0");
  await option.click();
  await expect(option).toHaveAttribute("aria-selected", "true");
  await page.waitForTimeout(350);
  expect(await page.evaluate(() => window.task23Shell.contexts)).toEqual([
    [moduleA],
    [route],
    ["tile:0:0"],
    [moduleA],
  ]);
});

test("moved draft geometry keeps Live physical source and observed tick", async ({ page }) => {
  await shell(page);
  await page.getByRole("option", { name: moduleA, exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.task23Shell.snapshot().inspector.selectedEntityId))
    .toBe(moduleA);
  const liveStats = await page.evaluate(() => window.task23Shell.snapshot().inspector.stats);
  await page.evaluate(async () => {
    await window.task23Shell.command({ kind: "ENTER_DESIGN_MODE" });
    await window.task23Shell.command({
      kind: "MOVE_MODULE",
      moduleInstanceId: "module-instance-00000002",
      position: { x: 4, y: 4 },
    });
  });
  await page.getByRole("option", { name: moduleA, exact: true }).click();
  const inspector = page.locator(".inspector-card");
  await expect(inspector.locator(".inspector-title-row .source-badge")).toHaveText("Draft");
  const tick = await page.evaluate(() => window.task23Shell.snapshot().tick);
  await expect(inspector.locator(".inspector-stats .source-badge")).toHaveText(
    `Live · tick ${tick}`,
  );
  const projected = await page.evaluate(() => window.task23Shell.snapshot().inspector.stats);
  expect(projected).toEqual(liveStats);
  expect(
    projected.some((stat) => stat.labelKey === "ui.temperature" && typeof stat.value === "number"),
  ).toBe(true);
  for (const stat of projected) {
    await expect(inspector.locator(".inspector-stats")).toContainText(
      new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(Number(stat.value)),
    );
  }
});

test("draft-only module and route keep measurements unavailable; live route keeps its published power", async ({
  page,
}) => {
  await shell(page);
  const inspector = page.locator(".inspector-card");
  await page.getByRole("option", { name: route, exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.task23Shell.snapshot().inspector.selectedEntityId))
    .toBe(route);
  const liveStats = await page.evaluate(() => window.task23Shell.snapshot().inspector.stats);
  expect(
    liveStats.some((stat) => stat.labelKey === "ui.power" && typeof stat.value === "number"),
  ).toBe(true);
  await expect(inspector.locator(".inspector-stats .source-badge")).toHaveText(/Live · tick \d+/);
  await expect(inspector.locator(".inspector-route-details")).toContainText("Unavailable");
  await page.evaluate(async () => {
    await window.task23Shell.command({ kind: "ENTER_DESIGN_MODE" });
    await window.task23Shell.command({
      kind: "BUY_MODULE",
      definitionId: "module-power-distribution",
      quantity: 1,
    });
    await window.task23Shell.command({
      kind: "BUY_MODULE",
      definitionId: "module-vacuum-tube-logic",
      quantity: 1,
    });
    await window.task23Shell.command({
      kind: "PLACE_MODULE",
      definitionId: "module-power-distribution",
      position: { x: 0, y: 5 },
      rotation: 0,
    });
    await window.task23Shell.command({
      kind: "PLACE_MODULE",
      definitionId: "module-vacuum-tube-logic",
      position: { x: 4, y: 5 },
      rotation: 0,
    });
    await window.task23Shell.command({
      kind: "CONNECT_PORTS",
      from: { moduleInstanceId: "module-instance-00000004", portId: "power-out-east" },
      to: { moduleInstanceId: "module-instance-00000005", portId: "power-in-west" },
      path: [1, 2, 3, 4].map((x) => ({ x, y: 5 })),
    });
  });
  await page.getByRole("option", { name: "module-instance-00000005", exact: true }).click();
  await expect(inspector.locator(".inspector-title-row .source-badge")).toHaveText("Draft");
  await expect(
    inspector.locator(".inspector-stats dd").filter({ hasText: "Unavailable" }),
  ).toHaveCount(3);
  expect(
    await page.evaluate(
      () =>
        window.task23Shell.grid().modules.find((module) => module.id === "module-instance-00000005")
          ?.temperatureC,
    ),
  ).toBeNull();
  await page.getByRole("option", { name: "route-00000002", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.task23Shell.snapshot().inspector.selectedEntityId))
    .toBe("route-00000002");
  await expect(
    inspector.locator(".inspector-stats dd").filter({ hasText: "Unavailable" }),
  ).toHaveCount(1);
  expect(await page.evaluate(() => window.task23Shell.snapshot().inspector.stats)).toEqual([]);
});

for (const kind of ["load", "recover", "client"] as const) {
  test(`${kind} replacement clears selection even with surviving IDs`, async ({ page }) => {
    await shell(page);
    await page.getByRole("option", { name: moduleA, exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => window.task23Shell.snapshot().inspector.selectedEntityId))
      .toBe(moduleA);
    await page.waitForTimeout(200);
    await page.evaluate((kind) => window.task23Shell.replace(kind), kind);
    await expect(page.getByRole("option", { name: moduleA, exact: true })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    await expect
      .poll(() => page.evaluate(() => window.task23Shell.snapshot().inspector.selectedEntityId))
      .toBeNull();
    await page.waitForTimeout(350);
    await expect
      .poll(() => page.evaluate(() => window.task23Shell.snapshot().inspector.selectedEntityId))
      .toBeNull();
  });
}

test("removed module and attached route references are pruned from shared selection", async ({
  page,
}) => {
  await shell(page);
  await page.evaluate(() => window.task23Shell.command({ kind: "ENTER_DESIGN_MODE" }));
  await page.getByRole("option", { name: moduleA, exact: true }).click();
  await page.getByRole("option", { name: route, exact: true }).click({ modifiers: ["Shift"] });
  await expect(page.getByRole("option", { name: moduleA, exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("option", { name: route, exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.evaluate(() =>
    window.task23Shell.command({
      kind: "REMOVE_MODULE",
      moduleInstanceId: "module-instance-00000002",
    }),
  );
  await expect(page.getByRole("option", { name: moduleA, exact: true })).toHaveCount(0);
  await expect(page.getByRole("option", { name: route, exact: true })).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.task23Shell.snapshot().inspector.selectedEntityId))
    .toBeNull();
});
