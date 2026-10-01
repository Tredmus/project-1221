import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import '@/lib/app';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
}
