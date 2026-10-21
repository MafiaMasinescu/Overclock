import { expect, test } from "@playwright/test";

test.describe("Task 24 Build Tray", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("build-card-list")).toBeVisible();
  });

  test("filters the owned catalog without changing the authoritative cash readout", async ({
    page,
  }) => {
    const cashBefore = await page
      .getByTestId("header")
      .locator(".resource-cash strong")
      .innerText();
    const search = page.getByRole("searchbox", { name: "Caută module" });
    await search.fill("tuburi");
    await expect(page.getByTestId("build-card-module-vacuum-tube-logic")).toBeVisible();
    await expect(
      page.getByTestId("build-card-list").locator("[data-testid^='build-card-']"),
    ).toHaveCount(1);
    await expect(page.getByTestId("header").locator(".resource-cash strong")).toHaveText(
      cashBefore,
    );
  });

  test("shows query-owned Catalog reasons and enters Draft once after a selection", async ({
    page,
  }) => {
    await page.getByRole("tab", { name: "Catalog" }).click();
    await expect(page.getByText("Cercetare necesară").first()).toBeVisible();
    const powerCard = page.getByTestId("build-card-module-power-distribution");
    await expect(powerCard).toBeEnabled();
    const cashBefore = await page
      .getByTestId("header")
      .locator(".resource-cash strong")
      .innerText();
    await powerCard.click();
    await expect(page.getByText("Draft activ · simularea live continuă")).toBeVisible();
    await expect(page.getByTestId("header").locator(".resource-cash strong")).toHaveText(
      cashBefore,
    );
    await powerCard.click();
    await expect(page.getByText("Draft activ · simularea live continuă")).toHaveCount(1);
  });

  test("places one catalog module through keyboard, applies it, then saves and reloads", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.getByRole("tab", { name: "Catalog" }).click();
    const powerCard = page.getByTestId("build-card-module-power-distribution");
    await powerCard.click();
    await expect(page.getByText("Draft activ · simularea live continuă")).toBeVisible();
    await expect(powerCard).toHaveClass(/part-card-selected/);
    await expect(page.getByTestId("build-placement-status")).toHaveText("ready");

    const moduleOptions = page.locator(".entity-list [role=option]");
    const beforeModules = await moduleOptions.count();
    const canvas = page.getByTestId("pixi-canvas-host").locator("canvas");
    await canvas.focus();
    await canvas.press("Enter");
    await expect.poll(() => moduleOptions.count()).toBe(beforeModules + 1);

    await page.getByRole("button", { name: "Aplică draftul" }).click();
    const romanianDialog = page.getByRole("dialog", { name: "Verifică modificările draftului" });
    await expect(romanianDialog).toBeVisible();
    for (const label of [
      "Module modificate",
      "Linii de inventar",
      "Valoarea contabilă a inventarului consumat",
      "Manoperă",
      "Credit din recuperare",
      "Plată / credit net",
      "Downtime maxim la pornire",
    ]) {
      await expect(romanianDialog.getByText(label)).toBeVisible();
    }
    await page.getByRole("combobox", { name: "Limbă" }).selectOption("en");
    const englishDialog = page.getByRole("dialog", { name: "Review draft changes" });
    await expect(englishDialog).toBeVisible();
    for (const label of [
      "Changed modules",
      "Inventory lines",
      "Consumed inventory book value",
      "Labor",
      "Salvage credit",
      "Net payment / credit",
      "Maximum startup downtime",
    ]) {
      await expect(englishDialog.getByText(label)).toBeVisible();
    }
    const dialogBox = await englishDialog.boundingBox();
    expect(dialogBox).not.toBeNull();
    expect((dialogBox?.y ?? 0) + (dialogBox?.height ?? 0)).toBeLessThanOrEqual(720);
    await page.getByRole("combobox", { name: "Language" }).selectOption("ro");
    await page.getByRole("dialog").getByRole("button", { name: "Confirmă" }).click();
    await expect(page.getByText("Draft activ · simularea live continuă")).toBeHidden();

    const persistence = page.getByTestId("persistence-controls");
    await persistence.locator("summary").click();
    await persistence.getByRole("button", { name: "Salvează" }).click();
    await expect(persistence.getByText(/Salvare|Salvat/)).toBeVisible();
    const slots = persistence.locator("#persistence-slot-select");
    await expect(slots.locator("option")).toHaveCount(2);
    await slots.selectOption({ index: 1 });
    await persistence.getByRole("button", { name: "Încarcă" }).click();
    await expect(persistence.getByText(/încărcat/i)).toBeVisible();

    await powerCard.click();
    await expect(page.getByText("Draft activ · simularea live continuă")).toBeVisible();
    await moduleOptions.first().click();
    const moveButton = page.getByRole("button", { name: "Mută selecția" });
    await expect(moveButton).toBeEnabled();
    await moveButton.click();
    await expect(page.getByTestId("build-placement-status")).toHaveText("ready");
    await canvas.press("e");
    await expect(page.getByTestId("build-placement-status")).toHaveText("idle");
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByRole("button", { name: "Redo" })).toBeEnabled();
    await page.getByRole("button", { name: "Redo" }).click();
  });
});
