import { afterEach, describe, expect, test } from "vitest";

import { createAppI18n } from "../../src/localization/i18n.ts";

describe("application localization", () => {
  const instances: Awaited<ReturnType<typeof createAppI18n>>[] = [];

  afterEach(() => {
    for (const instance of instances) {
      instance.off("languageChanged");
    }
    instances.length = 0;
  });

  test("switches placeholder text between Romanian and English", async () => {
    const i18n = await createAppI18n("ro");
    instances.push(i18n);

    expect(i18n.t("ui.settings")).toBe("Setări");
    expect(i18n.t("ui.shell-status")).toBe("Consolă de dezvoltare — simulare oprită");

    await i18n.changeLanguage("en");

    expect(i18n.t("ui.settings")).toBe("Settings");
    expect(i18n.t("ui.shell-status")).toBe("Development console — simulation offline");
  });
});
