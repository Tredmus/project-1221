import i18next from 'i18next';
import type { Locale } from '../config';
import bg from './bg.json';
import en from './en.json';

// Every piece of player-facing text lives in these files (GDD 13: BG/EN). en.json is the
// source of truth for keys; t('...') is type-checked against it.
export const resources = {
  en: { translation: en },
  bg: { translation: bg },
} as const;

declare module 'i18next' {
  interface CustomTypeOptions {
    resources: { translation: typeof en };
  }
}

export const i18nOptions = {
  resources,
  fallbackLng: 'en',
  initAsync: false,
  interpolation: { escapeValue: false },
} as const;

/** A standalone translator for server code. */
export function getTranslator(lng: Locale) {
  const instance = i18next.createInstance();
  void instance.init({ ...i18nOptions, lng });
  return instance.t;
}
