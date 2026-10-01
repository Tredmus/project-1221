import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Platform } from 'react-native';
import { DEFAULT_LOCALE, createSupabaseClient } from '@1221/shared';
import { initI18n } from '@1221/shared/react';

// On web the client uses localStorage itself.
export const supabase = createSupabaseClient({
  storage: Platform.OS === 'web' ? undefined : AsyncStorage,
  detectSessionInUrl: Platform.OS === 'web',
});

// Keep the session fresh only while the app is in the foreground.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') void supabase.auth.startAutoRefresh();
    else void supabase.auth.stopAutoRefresh();
  });
}

initI18n(DEFAULT_LOCALE);
