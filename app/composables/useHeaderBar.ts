import { computed } from 'vue';
import { useWindowSize } from '@vueuse/core';
import {
  FAST_ENTER_MIN_WIDTH,
  HEADER_BAR_CONFIG,
  type HeaderBarFeature,
} from '../constants/layout';
import { isMobileWidth } from './useLayout';
import { useLayoutStore, type LayoutState } from '../stores/layout';

/**
 * 顶栏三级开关（第 1.10 / 17.5 节）。
 *
 *  硬开关：constants/layout.ts 的 HEADER_BAR_CONFIG，改代码才变；
 *  软开关：layout store，用户在设置面板切换并持久化；
 *  宽度门限：useWindowSize() / CSS 媒体查询。
 *
 * 设置面板反过来用 visibleSoftSwitches 过滤自己的开关列表，双向一致，
 * 不会出现「面板里有开关、改了没反应」的死开关。
 */
export const SOFT_SWITCH_BY_FEATURE: Partial<Record<HeaderBarFeature, keyof LayoutState>> = {
  menuButton: 'showMenuButton',
  refreshButton: 'showRefreshButton',
  fastEnter: 'showFastEnter',
  breadcrumb: 'showCrumbs',
  globalSearch: 'showGlobalSearch',
  fullscreen: 'showFullscreen',
  notification: 'showNotification',
  chat: 'showChat',
  language: 'showLanguage',
  settings: 'showSettings',
  themeToggle: 'showThemeToggle',
};

export function isFeatureEnabled(feature: HeaderBarFeature): boolean {
  return HEADER_BAR_CONFIG[feature].enabled === true;
}

/** 设置面板只展示硬开关已启用的项。 */
export function visibleSoftSwitches(): HeaderBarFeature[] {
  return (Object.keys(SOFT_SWITCH_BY_FEATURE) as HeaderBarFeature[]).filter(isFeatureEnabled);
}

export function useHeaderBar() {
  const layout = useLayoutStore();
  const { width } = useWindowSize();
  /** ≤800px：顶栏切换为「汉堡 + 页名 + 少量主操作 + 更多」的紧凑形态。 */
  const isMobileHeader = computed(() => isMobileWidth(width.value));

  function soft(feature: HeaderBarFeature): boolean {
    const key = SOFT_SWITCH_BY_FEATURE[feature];
    if (!key) return true;
    return layout.state[key] === true;
  }

  function allowed(feature: HeaderBarFeature): boolean {
    return isFeatureEnabled(feature) && soft(feature);
  }

  const shouldShowMenuButton = computed(() => allowed('menuButton'));
  const shouldShowRefreshButton = computed(() => allowed('refreshButton'));
  const shouldShowFastEnter = computed(() =>
    allowed('fastEnter') && width.value >= FAST_ENTER_MIN_WIDTH,
  );
  const shouldShowBreadcrumb = computed(() => allowed('breadcrumb'));
  const shouldShowGlobalSearch = computed(() => allowed('globalSearch'));
  const shouldShowFullscreen = computed(() => allowed('fullscreen'));
  const shouldShowNotification = computed(() => allowed('notification'));
  const shouldShowChat = computed(() => allowed('chat'));
  const shouldShowLanguage = computed(() => allowed('language'));
  const shouldShowSettings = computed(() => allowed('settings'));
  const shouldShowThemeToggle = computed(() => allowed('themeToggle'));

  return {
    isMobileHeader,
    shouldShowMenuButton,
    shouldShowRefreshButton,
    shouldShowFastEnter,
    shouldShowBreadcrumb,
    shouldShowGlobalSearch,
    shouldShowFullscreen,
    shouldShowNotification,
    shouldShowChat,
    shouldShowLanguage,
    shouldShowSettings,
    shouldShowThemeToggle,
    fastEnterMinWidth: FAST_ENTER_MIN_WIDTH,
  };
}
