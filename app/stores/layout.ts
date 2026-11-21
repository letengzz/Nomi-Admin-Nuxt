/**
 * 布局偏好 store —— 对应 docs/状态管理.md 第 2 章 setting store 里「界面设置」
 * 的那一半（文档 451 行里的菜单 / 显示 / 样式部分），以及
 * docs/主布局设计.md 第 17.1 节。
 *
 * 为什么和「主题」拆成两个 store（app/stores/setting.ts）：
 * 主题要参与首帧渲染 —— <head> 里的内联脚本读的是 localStorage 的裸键；
 * 布局偏好则不参与，它只需要在水合后恢复。两者的持久化约束不同，混在一起
 * 会让「首帧脚本该读哪个键」变得含糊。
 *
 * 三条实现取舍：
 *  ① 单个持久化对象而不是 30 个 ref：重置配置只需写回一份默认值；
 *     mergeDefaults 保证老用户存储里缺新字段时拿到默认值而不是 undefined。
 *  ② skipHydrate 必加：SSR 读不到 localStorage，水合时 Pinia 会用服务端快照
 *     覆盖 ref，再由 useStorage 的 watch 把默认值写回存储，刷新后偏好全丢。
 *     （test/setting-store.spec.ts 有断言守着。）
 *  ③ 显隐走「软开关」，另有 constants/layout.ts 的 HEADER_BAR_CONFIG 硬开关；
 *     最终要不要渲染由 useHeaderBar() 把两级 && 起来，组件不自己判断。
 *
 * 写入入口：设置面板目前统一用 patch()。文档里的 setXxx 方法是给「外部功能代码」
 * 用的语义化入口（读代码的人一眼知道改的是什么），两者改的是同一份状态。
 */
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { usePersistedState } from '../composables/usePersistedState';
import { legacyStorageKey, storageKey } from '../utils/storage-key';
import {
  ContainerWidthEnum,
  DEFAULT_MENU_OPEN_WIDTH,
  getMenuThemePreset,
  MenuThemeEnum,
  MenuTypeEnum,
  TabStyleEnum,
  type ContainerWidth,
  type MenuTheme,
  type MenuType,
  type PageTransition,
  type TabStyle,
} from '../constants/layout';

export interface LayoutState {
  menuType: MenuType;
  menuOpen: boolean;
  menuOpenWidth: number;
  dualMenuShowText: boolean;
  menuTheme: MenuTheme;
  containerWidth: ContainerWidth;
  pageTransition: PageTransition;
  tabStyle: TabStyle;
  /** 单位 rem，字符串是为了能直接拼 CSS 变量 */
  customRadius: string;
  boxBorderMode: boolean;
  uniqueOpened: boolean;
  showMenuButton: boolean;
  showFastEnter: boolean;
  showRefreshButton: boolean;
  showCrumbs: boolean;
  showWorkTab: boolean;
  showLanguage: boolean;
  showGlobalSearch: boolean;
  showFullscreen: boolean;
  showNotification: boolean;
  showChat: boolean;
  showSettings: boolean;
  showThemeToggle: boolean;
  showWatermark: boolean;
  showFestivalText: boolean;
  showSettingGuide: boolean;
}

export const LAYOUT_DEFAULTS: LayoutState = {
  menuType: MenuTypeEnum.LEFT,
  menuOpen: true,
  menuOpenWidth: DEFAULT_MENU_OPEN_WIDTH,
  dualMenuShowText: false,
  // 菜单风格只有亮色/暗色两档，默认亮色（见 MENU_THEME_CHOICES）。
  menuTheme: MenuThemeEnum.LIGHT,
  containerWidth: ContainerWidthEnum.FULL,
  pageTransition: 'slide-left',
  tabStyle: TabStyleEnum.DEFAULT,
  customRadius: '0.75',
  boxBorderMode: true,
  uniqueOpened: true,
  showMenuButton: true,
  showFastEnter: true,
  showRefreshButton: true,
  showCrumbs: true,
  showWorkTab: true,
  showLanguage: true,
  showGlobalSearch: true,
  showFullscreen: true,
  showNotification: true,
  showChat: true,
  showSettings: true,
  showThemeToggle: true,
  showWatermark: false,
  showFestivalText: false,
  showSettingGuide: true,
};

export const LAYOUT_STORAGE_KEY = storageKey('layout');

/** 菜单宽度的合理区间：窄于 180 放不下「图标 + 两个汉字」，宽于 400 挤压内容区。 */
const MENU_WIDTH_MIN = 180;
const MENU_WIDTH_MAX = 400;

/** LayoutState 里所有 boolean 字段的键名，供 setFlag 使用。 */
type BooleanLayoutKey = {
  [K in keyof LayoutState]: LayoutState[K] extends boolean ? K : never;
}[keyof LayoutState];

export const useLayoutStore = defineStore('layout', () => {
  const state = usePersistedState<LayoutState>('layout', { ...LAYOUT_DEFAULTS }, {
    legacyKeys: [legacyStorageKey('layout')],
  });

  // 老存储里的 'design' 已经不是可选项了，就地归一化为亮色，
  // 否则老用户进设置面板会看到「菜单风格一个都没选中」。
  if (state.value.menuTheme === MenuThemeEnum.DESIGN) {
    state.value = { ...state.value, menuTheme: MenuThemeEnum.LIGHT };
  }

  /** 刷新信号不持久化：浏览器重新打开时没有「需要重建的旧页面」。 */
  const refresh = ref(false);

  const getMenuOpenWidth = computed(() => `${state.value.menuOpenWidth}px`);
  const getMenuTheme = computed(() => getMenuThemePreset(state.value.menuTheme));
  const getCustomRadius = computed(() => `${state.value.customRadius}rem`);

  function patch(partial: Partial<LayoutState>): void {
    state.value = { ...state.value, ...partial };
  }

  function clampWidth(width: number): number {
    if (!Number.isFinite(width)) return LAYOUT_DEFAULTS.menuOpenWidth;
    return Math.min(MENU_WIDTH_MAX, Math.max(MENU_WIDTH_MIN, Math.round(width)));
  }

  /**
   * 布局切换的唯一入口（文档 2.3 switchMenuLayouts）。
   * 连锁规则必须集中在这里，不能散落在设置面板里，否则响应式降级与手动切换会打架。
   */
  function switchMenuLayouts(type: MenuType): void {
    patch({ menuType: type });
    if (type === MenuTypeEnum.LEFT || type === MenuTypeEnum.TOP_LEFT) {
      patch({ menuOpen: true });
    }
    if (type === MenuTypeEnum.DUAL_MENU) {
      // 双栏左列是浅色图标条，暗色菜单主题会破坏视觉，强制回到亮色。
      patch({ menuTheme: MenuThemeEnum.LIGHT, menuOpen: true });
    }
  }

  function setMenuOpen(open: boolean): void {
    patch({ menuOpen: open });
  }

  function toggleMenu(): void {
    patch({ menuOpen: !state.value.menuOpen });
  }

  function setMenuOpenWidth(width: number): void {
    patch({ menuOpenWidth: clampWidth(width) });
  }

  function setMenuTheme(theme: MenuTheme): void {
    patch({ menuTheme: theme });
  }

  function setDualMenuShowText(value: boolean): void {
    patch({ dualMenuShowText: value });
  }

  function setContainerWidth(width: ContainerWidth): void {
    patch({ containerWidth: width });
  }

  function setPageTransition(name: PageTransition): void {
    patch({ pageTransition: name });
  }

  function setTabStyle(style: TabStyle): void {
    patch({ tabStyle: style });
  }

  /** 圆角同时写进 CSS 变量（docs/主布局设计.md useLayoutDom 会再同步一次）。 */
  function setCustomRadius(radius: string): void {
    const value = radius.replace(/rem$/, '');
    if (!Number.isFinite(Number(value))) return;
    patch({ customRadius: value });
  }

  function setBoxBorderMode(value: boolean): void {
    patch({ boxBorderMode: value });
  }

  function toggleBoxBorderMode(): void {
    setBoxBorderMode(!state.value.boxBorderMode);
  }

  function setUniqueOpened(value: boolean): void {
    patch({ uniqueOpened: value });
  }

  /** 软开关的通用入口：设置面板里那排 showXxx 开关都走这里。 */
  function setFlag(key: BooleanLayoutKey, value: boolean): void {
    patch({ [key]: value } as Partial<LayoutState>);
  }

  function reload(): void {
    refresh.value = !refresh.value;
  }

  function hideSettingGuide(): void {
    patch({ showSettingGuide: false });
  }

  function reset(): void {
    state.value = { ...LAYOUT_DEFAULTS };
  }

  return {
    state,
    refresh,
    getMenuOpenWidth,
    getMenuTheme,
    getCustomRadius,
    patch,
    switchMenuLayouts,
    setMenuOpen,
    toggleMenu,
    setMenuOpenWidth,
    setMenuTheme,
    setDualMenuShowText,
    setContainerWidth,
    setPageTransition,
    setTabStyle,
    setCustomRadius,
    setBoxBorderMode,
    toggleBoxBorderMode,
    setUniqueOpened,
    setFlag,
    reload,
    hideSettingGuide,
    reset,
  };
});
