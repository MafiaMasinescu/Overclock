import i18next, { type i18n } from "i18next";

import { loadContentBundle } from "../content/loader/contentLoader.ts";

export type SupportedLanguage = "ro" | "en";

export async function createAppI18n(language: SupportedLanguage = "ro"): Promise<i18n> {
  const instance = i18next.createInstance();
  const { locales } = loadContentBundle();

  await instance.init({
    lng: language,
    fallbackLng: "en",
    supportedLngs: ["ro", "en"],
    defaultNS: "translation",
    resources: {
      ro: { translation: locales.ro },
      en: { translation: locales.en },
    },
    interpolation: {
      escapeValue: false,
    },
  });

  return instance;
}
