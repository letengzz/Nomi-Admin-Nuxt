import { defineStore, skipHydrate } from 'pinia';
import { computed } from 'vue';
import { usePreferredDark, useStorage } from '@vueuse/core';
import { THEME_STORAGE_KEYS } from '#shared/utils/theme-bootstrap';
import { applyThemeToDocument, THEME_COLORS, type ColorMode, type ThemeColor } from '../utils/theme';
import { revealTheme } from '../utils/theme-transition';

/**
 * 主题设置：主色 + 明暗模式（auto 跟随系统）。
 * 状态持久化在 localStorage，CSS 变量由 applyThemeToDocument 统一写入 <html>，
 * 组件只读变量，不感知主题实现。
 *
 * 存储键来自 shared/utils/theme-bootstrap.ts —— <head> 里的内联脚本读的是同一份
 * 键名，两边各写一个字符串迟早会错开，而症状是「设置能存，刷新后主题丢失」。
 *
 * 这也是**唯一不走 usePersistedState / 版本化键**的 store：内联脚本必须在
 * 第一批字节里就同步读到主题偏好，而键名带 schema 版本意味着每次升版都要同步
 * 改内联脚本，且迁移只能发生在 JS 加载之后（首帧会闪一次默认主题）。
 * 布局类偏好没有这个约束，所以它们用 `nomi:v1:*`。
 *
 * 文档里「设置」是单个 451 行的 store；本项目按「是否参与首帧」拆成两个：
 * 本文件（主题）+ app/stores/layout.ts（菜单 / 显示 / 样式）。
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

  /**
   * 明暗真的翻转时才放圆形揭示动画，只换主色或模式没变（例如本来就亮色还点亮色）
   * 直接落值 —— 没变化还放动画会像是在空转。
   *
   * 方向：切明亮 → 亮色从明暗按钮的位置铺开；切暗黑 → 亮色缩回那颗按钮。
   * anchor 是那颗按钮（模板里传 `$event.currentTarget`），圆心由它决定。
   */
  function commitColorMode(mode: ColorMode, anchor?: unknown): void {
    const nextDark = mode === 'auto' ? prefersDark.value : mode === 'dark';
    const commit = (): void => {
      colorMode.value = mode;
      applyTheme();
    };
    if (nextDark === isDark.value) {
      commit();
      return;
    }
    revealTheme(nextDark ? 'contract' : 'expand', commit, anchor);
  }

  function setColorMode(mode: ColorMode, anchor?: unknown): void {
    commitColorMode(mode, anchor);
  }

  function toggleDark(anchor?: unknown): void {
    commitColorMode(isDark.value ? 'light' : 'dark', anchor);
  }

  /** 恢复到跟随系统 + 默认主色（设置面板的「重置」用）。 */
  function resetTheme(anchor?: unknown): void {
    const commit = (): void => {
      colorMode.value = 'auto';
      themeColor.value = THEME_COLORS[0];
      applyTheme();
    };
    // 重置可能顺带翻转明暗，翻转就跟着放动画，否则只换主色会突兀地闪一下。
    if (prefersDark.value === isDark.value) {
      commit();
      return;
    }
    revealTheme(prefersDark.value ? 'contract' : 'expand', commit, anchor);
  }

  return {
    colorMode,
    themeColor,
    isDark,
    applyTheme,
    setThemeColor,
    setColorMode,
    toggleDark,
    resetTheme,
  };
});
