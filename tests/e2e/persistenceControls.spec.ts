import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

test("persistence controls keep imports local, explicit, and revision-bound", async ({ page }) => {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== "http://127.0.0.1:4173") {
      externalRequests.push(request.url());
    }
  });
  await page.goto("/");
  const drawer = page.getByTestId("persistence-controls");
  await drawer.locator("summary").click();
  const slotSelect = page.locator("#persistence-slot-select");
  const saveButton = page.getByRole("button", { name: "Salvează acum" });
  await saveButton.click();
  await expect(page.getByText(/Salvat la tick-ul/)).toBeVisible();
  await expect.poll(() => slotSelect.locator("option").count()).toBe(2);
  const originalSlotId = await slotSelect.locator("option").nth(1).getAttribute("value");
  expect(originalSlotId).toBeTruthy();
  await slotSelect.selectOption(originalSlotId ?? "");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportă" }).first().click();
  const saveDownload = await downloadPromise;
  const saveBytes = await readFile(await saveDownload.path());
  const fileInput = page.locator('input[type="file"]');
  const importDigest = async (): Promise<string> =>
    fileInput.evaluate(async (element) => {
      const file = (element as HTMLInputElement).files?.[0];
      if (file === undefined) throw new Error("Import file was not selected.");
      const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
        "",
      );
    });
  const setManualSaveAvailable = async (slotId: string, available: boolean): Promise<void> => {
    await page.evaluate(
      async ({ slotId, available }) => {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("overclock", 1);
          request.onsuccess = () => {
            resolve(request.result);
          };
          request.onerror = () => {
            reject(request.error ?? new Error("Unable to open the local save database."));
          };
        });
        await new Promise<void>((resolve, reject) => {
          const transaction = database.transaction("saves", "readwrite");
          const store = transaction.objectStore("saves");
          if (available) {
            const saved: unknown = Reflect.get(window, "__overclockRemovedManualSave");
            if (saved === undefined) {
              transaction.abort();
              return;
            }
            store.put(saved, slotId);
          } else {
            const request = store.get(slotId);
            request.onsuccess = () => {
              if (request.result === undefined) {
                transaction.abort();
                return;
              }
              Reflect.set(window, "__overclockRemovedManualSave", request.result);
              store.delete(slotId);
            };
          }
          transaction.oncomplete = () => {
            resolve();
          };
          transaction.onerror = () => {
            reject(transaction.error ?? new Error("Manual save mutation failed."));
          };
          transaction.onabort = () => {
            reject(transaction.error ?? new Error("Manual save mutation aborted."));
          };
        });
        database.close();
      },
      { slotId, available },
    );
  };

  await fileInput.setInputFiles({
    name: "backup.ocsave",
    mimeType: "application/json",
    buffer: saveBytes,
  });
  const originalDigest = await importDigest();
  const previewButton = page.getByRole("button", { name: "Verifică fișierul" });
  await expect(previewButton).toBeEnabled();
  await previewButton.click();
  await expect(page.getByTestId("import-preview")).toBeVisible();
  await expect(page.getByLabel("Aplică și setările salvate ale dispozitivului")).not.toBeChecked();
  await page.getByRole("button", { name: "Anulează" }).click();
  await expect(page.getByTestId("import-preview")).toHaveCount(0);
  expect(await importDigest()).toBe(originalDigest);
  await expect.poll(() => slotSelect.locator("option").count()).toBe(2);

  await fileInput.setInputFiles({
    name: "backup.ocsave",
    mimeType: "application/json",
    buffer: saveBytes,
  });
  await expect(previewButton).toBeEnabled();
  await previewButton.click();
  await expect(page.getByTestId("import-preview")).toBeVisible();
  await page.getByRole("button", { name: "Confirmă importul" }).click();
  await expect(page.getByText(/a fost importată\./)).toBeVisible();
  await expect.poll(() => slotSelect.locator("option").count()).toBe(3);
  expect(await importDigest()).toBe(originalDigest);

  const importedSlotId = await slotSelect
    .locator("option")
    .evaluateAll(
      (options, activeSlotId) =>
        options
          .map((option) => (option as HTMLOptionElement).value)
          .find((value) => value !== "" && value !== activeSlotId),
      originalSlotId,
    );
  expect(importedSlotId).toBeTruthy();
  await page.getByLabel("Destinație").selectOption(importedSlotId ?? "");
  await fileInput.setInputFiles({
    name: "backup.ocsave",
    mimeType: "application/json",
    buffer: saveBytes,
  });
  await expect(previewButton).toBeEnabled();
  await previewButton.click();
  await expect(page.getByTestId("import-preview")).toBeVisible();
  const cancelledOverwriteDialog = page.waitForEvent("dialog", { timeout: 2_000 });
  const cancelledOverwriteClick = page.getByRole("button", { name: "Confirmă importul" }).click();
  const overwriteDialog = await cancelledOverwriteDialog;
  expect(overwriteDialog.message()).toContain(importedSlotId ?? "");
  expect(overwriteDialog.message()).toMatch(/revizi/);
  await overwriteDialog.dismiss();
  await cancelledOverwriteClick;
  await expect(page.getByTestId("import-preview")).toBeVisible();
  await page.evaluate(async (slotId) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("overclock", 1);
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(request.error ?? new Error("Unable to open the local save database."));
      };
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("slotMeta", "readwrite");
      const store = transaction.objectStore("slotMeta");
      const request = store.get(slotId);
      request.onsuccess = () => {
        const meta = request.result as { revision: number } | undefined;
        if (meta === undefined) {
          transaction.abort();
          return;
        }
        store.put({ ...meta, revision: meta.revision + 1 }, slotId);
      };
      transaction.oncomplete = () => {
        resolve();
      };
      transaction.onerror = () => {
        reject(transaction.error ?? new Error("Revision update failed."));
      };
      transaction.onabort = () => {
        reject(transaction.error ?? new Error("Revision update aborted."));
      };
    });
    database.close();
  }, importedSlotId ?? "");
  const acceptedOverwriteDialog = page.waitForEvent("dialog");
  const acceptedOverwriteClick = page.getByRole("button", { name: "Confirmă importul" }).click();
  await (await acceptedOverwriteDialog).accept();
  await acceptedOverwriteClick;
  await expect(page.getByRole("status").filter({ hasText: "STALE_REVISION" })).toBeVisible();
  expect(await importDigest()).toBe(originalDigest);

  await slotSelect.selectOption(originalSlotId ?? "");
  await setManualSaveAvailable(originalSlotId ?? "", false);
  await page.getByRole("button", { name: "Încarcă" }).click();
  await expect(page.getByRole("status").filter({ hasText: "UNAVAILABLE" })).toBeVisible();
  await expect(page.getByTestId("import-preview")).toBeVisible();
  await setManualSaveAvailable(originalSlotId ?? "", true);
  await page.getByRole("button", { name: "Încarcă" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Runda a fost încărcată și este oprită." }),
  ).toBeVisible();
  await expect(page.getByTestId("import-preview")).toHaveCount(0);
  await expect(page.locator(".persistence-recovery-note")).toBeVisible();

  await fileInput.setInputFiles({
    name: "backup.ocsave",
    mimeType: "application/json",
    buffer: saveBytes,
  });
  await expect(previewButton).toBeEnabled();
  await previewButton.click();
  await expect(page.getByTestId("import-preview")).toBeVisible();
  await setManualSaveAvailable(originalSlotId ?? "", false);
  await page.getByRole("button", { name: "Recuperează" }).click();
  await expect(page.getByRole("status").filter({ hasText: "UNAVAILABLE" })).toBeVisible();
  await expect(page.getByTestId("import-preview")).toBeVisible();
  await setManualSaveAvailable(originalSlotId ?? "", true);
  await page.getByRole("button", { name: "Recuperează" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Runda salvată este pregătită." }),
  ).toBeVisible();
  await expect(page.getByTestId("import-preview")).toHaveCount(0);
  await page.getByRole("button", { name: "Continuă runda" }).click();
  await expect(page.locator(".persistence-recovery-note")).toHaveCount(0);

  await page.getByRole("button", { name: "Creează raport" }).click();
  await expect(page.getByText("Raportul a fost salvat pe acest dispozitiv.")).toBeVisible();
  const report = page.locator(".persistence-report-list");
  await expect(report.getByText("Raport de testare")).toBeVisible();
  const reportDownloadPromise = page.waitForEvent("download");
  await report.getByRole("button", { name: "Exportă" }).click();
  const reportDownload = await reportDownloadPromise;
  const reportBytes = await readFile(await reportDownload.path(), "utf8");
  const reportObject = JSON.parse(reportBytes) as Record<string, unknown>;
  expect(Object.keys(reportObject).sort()).toEqual([
    "appVersion",
    "capabilities",
    "category",
    "contentVersion",
    "counters",
    "createdAtIso",
    "durationMs",
    "errorCode",
    "reportId",
    "reportVersion",
    "tick",
    "year",
  ]);
  await expect(
    page.getByText("Salvările și rapoartele rămân pe dispozitiv. Nu se încarcă nicăieri."),
  ).toBeVisible();
  await report.getByRole("button", { name: "Șterge" }).click();
  await expect(report.getByText("Raport de testare")).toHaveCount(0);
  expect(externalRequests).toEqual([]);
});

test("a new run clears recovery controls from the previous session", async ({ page }) => {
  await page.goto("/");
  const drawer = page.getByTestId("persistence-controls");
  await drawer.locator("summary").click();
  await page.getByRole("button", { name: "Salvează acum" }).click();
  const slotSelect = page.locator("#persistence-slot-select");
  await expect.poll(() => slotSelect.locator("option").count()).toBe(2);
  const slotId = await slotSelect.locator("option").nth(1).getAttribute("value");
  await slotSelect.selectOption(slotId ?? "");
  await page.getByRole("button", { name: "Încarcă" }).click();
  await expect(page.locator(".persistence-recovery-note")).toBeVisible();
  await page.getByRole("button", { name: "Rundă nouă" }).click();
  await expect(page.locator(".persistence-recovery-note")).toHaveCount(0);
  await expect(drawer).toBeVisible();
});
