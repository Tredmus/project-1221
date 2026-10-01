import en from './i18n/en.json';

export type ErrorKey = keyof (typeof en)['errors'];

/**
 * Database functions raise errors with a stable key in `hint` (e.g. 'clan_name_taken').
 * Map it to a translation: t(`errors.${errorKey(error)}`)
 */
export function errorKey(error: { hint?: string | null } | string | null | undefined): ErrorKey {
  const key = typeof error === 'string' ? error : error?.hint;
  return key && key in en.errors ? (key as ErrorKey) : 'unknown';
}
