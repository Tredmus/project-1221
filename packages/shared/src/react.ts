// React-only helpers (hooks, react-i18next). Import from '@1221/shared/react' so server code
// can use '@1221/shared' without pulling in client APIs.
import i18next from 'i18next';
import { useEffect, useState } from 'react';
import { initReactI18next } from 'react-i18next';
import type { Session } from '@supabase/supabase-js';
import type { Locale } from './config';
import { checkDatabase, type DatabaseStatus } from './connection';
import { i18nOptions } from './i18n';
import type { AppSupabaseClient } from './supabase';

/** Sets up the shared i18next instance used by react-i18next's useTranslation(). */
export function initI18n(lng: Locale) {
  if (i18next.isInitialized) {
    void i18next.changeLanguage(lng);
  } else {
    void i18next.use(initReactI18next).init({ ...i18nOptions, lng });
  }
  return i18next;
}

export function useDatabaseStatus(client: AppSupabaseClient): DatabaseStatus {
  const [status, setStatus] = useState<DatabaseStatus>({ state: 'checking' });

  useEffect(() => {
    let cancelled = false;
    void checkDatabase(client).then((result) => {
      if (!cancelled) setStatus(result);
    });
    return () => {
      cancelled = true;
    };
  }, [client]);

  return status;
}

/** The current login session, kept in sync with sign-in, sign-out and token refresh. */
export function useSession(client: AppSupabaseClient): { session: Session | null; loading: boolean } {
  const [state, setState] = useState<{ session: Session | null; loading: boolean }>({ session: null, loading: true });

  useEffect(() => {
    let active = true;
    void client.auth.getSession().then(({ data }) => {
      if (active) setState({ session: data.session, loading: false });
    });
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      if (active) setState({ session, loading: false });
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [client]);

  return state;
}
