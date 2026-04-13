"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { en, type TranslationKeys } from "./translations/en";
import { pt } from "./translations/pt";
import { es } from "./translations/es";

export type Language = "en" | "pt" | "es";

const translations: Record<Language, TranslationKeys> = { en, pt, es };

export const LANGUAGES: { code: Language; flag: string; label: string }[] = [
  { code: "en", flag: "\ud83c\uddfa\ud83c\uddf8", label: "English" },
  { code: "pt", flag: "\ud83c\udde7\ud83c\uddf7", label: "Portugu\u00eas" },
  { code: "es", flag: "\ud83c\uddea\ud83c\uddf8", label: "Espa\u00f1ol" },
];

function getStoredLanguage(): Language {
  if (typeof window === "undefined") return "en";
  const stored = localStorage.getItem("polystream-lang");
  if (stored && (stored === "en" || stored === "pt" || stored === "es")) return stored;
  return "en";
}

interface I18nContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: TranslationKeys;
}

const I18nContext = createContext<I18nContextType>({
  language: "en",
  setLanguage: () => {},
  t: en,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLang] = useState<Language>(getStoredLanguage);

  const setLanguage = useCallback((lang: Language) => {
    setLang(lang);
    localStorage.setItem("polystream-lang", lang);
  }, []);

  const t = translations[language];

  return (
    <I18nContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </I18nContext.Provider>
  );
}

/**
 * Hook to access translations.
 * Usage: const { t, language, setLanguage } = useT();
 *        <h1>{t.nav.news}</h1>
 */
export function useT() {
  return useContext(I18nContext);
}
