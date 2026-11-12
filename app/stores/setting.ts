import { defineStore, skipHydrate } from 'pinia';
import { computed } from 'vue';
import { usePreferredDark, useStorage } from '@vueuse/core';
import { THEME_STORAGE_KEYS } from '#shared/utils/theme-bootstrap';
import { applyThemeToDocument, THEME_COLORS, type ColorMode, type ThemeColor } from '../utils/theme';

/**
 * 主题设置：主色 + 明暗模式（auto 跟随系统）。
 * 状态持久化在 localStorage，CSS 变量由 applyThemeToDocument 统一写入 <html>，
 * 组件只读变量，不感知主题实现。
 *
 * 存储键来自 shared/utils/theme-bootstrap.ts —— <head> 里的内联脚本读的是同一份
 * 键名，两边各写一个字符串迟早会错开，而症状是「设置能存，刷新后主题丢失」。
 *
 * 必须包一层 skipHydrate：
 *   SSR 期间读不到 localStorage，store 里是默认值 'auto'，这份默认值会随
 *   payload 发到浏览器；水合时 Pinia 会用它**覆盖** ref 的当前值。
 *   而 useStorage 在 createStore 阶段已经把 localStorage 里的真实偏好读进来了，
 *   覆盖之后值退回 'auto'，紧接着 useStorage 的 watch 又把 'auto' 写回存储 ——
 *   表现为「用户选了暗色，刷新一次就变回跟随系统」，且存储被彻底改坏。
 *   skipHydrate 告诉 Pinia「这个 ref 自持久化，别拿 SSR 快照覆盖它」。
 */
export const useSettingStore = defineStore('setting', () => {
  const colorMode = skipHydrate(useStorage<ColorMode>(THEME_STORAGE_KEYS.mode, 'auto'));
  const themeColor = skipHydrate(useStorage<string>(THEME_STORAGE_KEYS.color, THEME_COLORS[0]));
  const prefersDark = usePreferredDark();
  const isDark = computed(() =>
    colorMode.value === 'auto' ? prefersDark.value : colorMode.value === 'dark',
  );

  function applyTheme(): void {
    if (typeof document === 'undefined') return;
    applyThemeToDocument(document.documentElement, themeColor.value, isDark.value);
  }

  function setThemeColor(color: string): void {
    if (!THEME_COLORS.includes(color as ThemeColor)) return;
    themeColor.value = color;
    applyTheme();
  }

  function setColorMode(mode: ColorMode): void {
    colorMode.value = mode;
    applyTheme();
  }

  function toggleDark(): void {
    setColorMode(isDark.value ? 'light' : 'dark');
  }

  return { colorMode, themeColor, isDark, applyTheme, setThemeColor, setColorMode, toggleDark };
});
