/**
 * Public connection values for the Supabase project. The publishable key is safe to ship in
 * apps: row-level security protects the data, and admin rights are checked in the database.
 */
export const SUPABASE_URL = 'https://fcpagfljhnozqmjxxlyx.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_vJG8D7MjHHnjaFO21Dh4sw_7IKAhRGU';

export type Locale = 'en' | 'bg';
export const LOCALES: Locale[] = ['en', 'bg'];
export const DEFAULT_LOCALE: Locale = 'en';
