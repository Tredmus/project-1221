// Placeholder home screen: proves the app reaches Supabase and speaks both languages.
// The map test (react-native-svg vs Skia, GDD 13) comes in phase 2.
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { gameDate } from '@1221/game-core';
import type { Locale } from '@1221/shared';
import { useDatabaseStatus } from '@1221/shared/react';
import { spacing } from '@1221/ui';
import { supabase } from '@/lib/app';

export default function Home() {
  const { t, i18n } = useTranslation();
  const status = useDatabaseStatus(supabase);
  const date = gameDate();
  const next: Locale = i18n.language === 'bg' ? 'en' : 'bg';

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.body}>
        <Text style={styles.title}>{t('app.title')}</Text>
        <Text style={styles.tagline}>
          {t('app.tagline', { day: date.day, month: t(`months.${date.month}` as 'months.1'), year: date.year })}
        </Text>
        <Text style={styles.status}>
          {status.state === 'error' ? t('connection.error', { message: status.message }) : t(`connection.${status.state}`)}
        </Text>
      </View>
      <Pressable accessibilityRole="button" onPress={() => void i18n.changeLanguage(next)} style={styles.language}>
        <Text>{next === 'bg' ? t('common.bulgarian') : t('common.english')}</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: spacing.xl },
  body: { flex: 1, justifyContent: 'center', gap: spacing.md },
  title: { fontSize: 34, fontWeight: '700' },
  tagline: { fontSize: 17, opacity: 0.75 },
  status: { fontSize: 14, opacity: 0.6 },
  language: { alignSelf: 'center', padding: spacing.md },
});
