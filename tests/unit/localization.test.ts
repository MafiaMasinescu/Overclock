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

  test("localizes stable command rejection keys in both languages", async () => {
    const i18n = await createAppI18n("ro");
    instances.push(i18n);

    expect(i18n.t("errors.command-not-available")).toBe("Comanda nu este disponibilă încă.");
    expect(i18n.t("errors.stale-tick")).toBe(
      "Comanda a fost creată pentru un alt tick al simulării.",
    );

    expect(i18n.t("errors.invalid-payload")).toBe("Comanda conține date invalide.");
    expect(i18n.t("errors.insufficient-cash")).toBe("Fonduri insuficiente.");
    expect(i18n.t("errors.insufficient-inventory")).toBe("Inventar insuficient.");
    expect(i18n.t("errors.research-required")).toBe("Cercetarea necesară nu este finalizată.");
    expect(i18n.t("errors.insufficient-research-data")).toBe("Date de cercetare insuficiente.");
    for (const key of [
      "errors.not-in-design-mode",
      "errors.already-in-design-mode",
      "errors.invalid-system",
      "errors.out-of-bounds",
      "errors.tile-occupied",
      "errors.route-out-of-bounds",
      "errors.route-tile-occupied",
      "errors.route-invalid-port",
      "errors.route-incompatible-ports",
      "errors.invalid-route-route-not-found",
      "errors.invalid-route-duplicate-endpoint-pair",
      "errors.invalid-route-path-too-short",
      "errors.invalid-route-path-too-long",
      "errors.invalid-route-path-endpoint-mismatch",
      "errors.invalid-route-non-orthogonal-segment",
      "errors.invalid-route-repeated-path-tile",
      "errors.overclock-target-invalid",
      "errors.overclock-unsupported",
      "errors.overclock-unavailable-in-design-mode",
    ]) {
      expect(i18n.t(key)).not.toBe(key);
    }

    await i18n.changeLanguage("en");

    expect(i18n.t("errors.command-not-available")).toBe("This command is not available yet.");
    expect(i18n.t("errors.stale-tick")).toBe(
      "The command was created for a different simulation tick.",
    );
    expect(i18n.t("errors.invalid-payload")).toBe("The command payload is invalid.");
    expect(i18n.t("errors.insufficient-cash")).toBe("Insufficient cash.");
    expect(i18n.t("errors.insufficient-inventory")).toBe("Insufficient inventory.");
    expect(i18n.t("errors.research-required")).toBe("The required research is not completed.");
    expect(i18n.t("errors.insufficient-research-data")).toBe("Insufficient research data.");
    expect(i18n.t("errors.not-in-design-mode")).toBe("Design Mode is not active.");
    expect(i18n.t("errors.already-in-design-mode")).toBe("Design Mode is already active.");
    expect(i18n.t("errors.invalid-system")).toBe("The system state is invalid.");
    expect(i18n.t("errors.out-of-bounds")).toBe("The module footprint is outside the facility.");
    expect(i18n.t("errors.tile-occupied")).toBe("The module footprint overlaps an occupied tile.");
    expect(i18n.t("errors.overclock-target-invalid")).toBe("The overclock target is invalid.");
    expect(i18n.t("errors.overclock-unsupported")).toBe(
      "This module does not support overclocking.",
    );
    expect(i18n.t("errors.overclock-unavailable-in-design-mode")).toBe(
      "Overclock settings cannot change while Design Mode is active.",
    );
  });
});
