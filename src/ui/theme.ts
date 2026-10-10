import { Capacitor } from '@capacitor/core';
import type { ThemeName } from '../prefs.ts';

export const THEMES: Record<ThemeName, { title: string; desc: string; bg: string; dark: boolean }> = {
  amoled: { title: 'Тёмная AMOLED', desc: 'Чистый чёрный фон, экономит батарею на OLED', bg: '#000000', dark: true },
  sand: { title: 'Светлая, светло-коричневая', desc: 'Тёплый песочный фон, мягкий для глаз', bg: '#efe4d2', dark: false },
};

export function applyTheme(name: ThemeName): void {
  const t = THEMES[name];
  document.documentElement.dataset.theme = name;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t.bg);
  if (Capacitor.isNativePlatform()) {
    void (async () => {
      try {
        const { StatusBar, Style } = await import('@capacitor/status-bar');
        await StatusBar.setStyle({ style: t.dark ? Style.Dark : Style.Light });
        await StatusBar.setBackgroundColor({ color: t.bg });
      } catch {
        /* плагин/функция недоступны на этой версии Android — не критично */
      }
    })();
  }
}
