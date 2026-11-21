import { computed, onUnmounted, watch, watchEffect } from 'vue';
import { useBreakpoints, useEventListener, useWindowSize } from '@vueuse/core';
import {
  HEADER_HEIGHT,
  LAYOUT_BREAKPOINTS,
  MOBILE_DRAWER_MAX_WIDTH,
  MOBILE_DRAWER_WIDTH_RATIO,
  MENU_CLOSE_WIDTH,
  MenuThemeEnum,
  MenuTypeEnum,
  type MenuType,
  type NomiMenuItem,
} from '../constants/layout';
import { useLayoutStore } from '../stores/layout';
import { useMenuStore } from '../stores/menu';
import { useSettingStore } from '../stores/setting';
import { normalizeMenuPath } from '../utils/path';

/**
 * 布局的派生状态与副作用 —— 对应文档第 1.4 / 6.5 / 16.2 / 20.1-20.2 节。
 *
 * 所有区域组件只读这里给出的 computed，不自己解释 menuType：
 * 四种布局的显隐矩阵集中在同一处，加第五种布局时只改这一个文件。
 *
 * 菜单数据不再直接读 constants/layout.ts，而是读 menu store（docs/状态管理.md
 * 第 4 章）：接真实后端时只要 setMenuList()，面包屑、侧栏、标签页会一起更新，
 * 不用去每个组件里改数据源。
 */
export function useLayoutComputed() {
  const layout = useLayoutStore();
  const menu = useMenuStore();
  const route = useRoute();

  const isLeftMenu = computed(() => layout.state.menuType === MenuTypeEnum.LEFT);
  const isTopMenu = computed(() => layout.state.menuType === MenuTypeEnum.TOP);
  const isTopLeftMenu = computed(() => layout.state.menuType === MenuTypeEnum.TOP_LEFT);
  const isDualMenu = computed(() => layout.state.menuType === MenuTypeEnum.DUAL_MENU);
  /** 第 6.1 节 L5：v-if="showLeftMenu || isDualMenu" */
  const showLeftMenu = computed(() => isLeftMenu.value || isTopLeftMenu.value);

  /**
   * 菜单匹配用的路径：先剥掉 i18n 语言前缀。
   * 菜单树的 index 都是不带前缀的 /admin/...，直接拿 route.path 比对的话，
   * 切到英文（/en/admin/...）会全部失配 —— ElMenu 的 default-active 落空就清掉
   * 高亮，只有点击菜单项时 ElMenu 内部设置的 activeIndex 才让它显色。
   * 面包屑、一级菜单、顶栏标题也共用这一个入口，避免各自的判断口径不一致。
   */
  const menuPath = computed(() => normalizeMenuPath(route.path));

  /** 当前路由高亮的菜单（详情页用 activePath 指回所属列表）。 */
  const activeMenuPath = computed(() => {
    const metaActive = route.meta.activePath;
    return typeof metaActive === 'string' ? metaActive : menu.activePathOf(menuPath.value);
  });

  /** 当前所属的一级菜单；顶层页面自己就是一级。 */
  const activeTopMenu = computed<NomiMenuItem | undefined>(() => {
    const flat = menu.findMenu(menuPath.value);
    if (!flat?.parent) return menu.menuList.find((item) => item.path === menuPath.value);
    return menu.menuList.find((item) =>
      item.children?.some((child) => child.path === menuPath.value),
    );
  });

  /**
   * 侧栏数据切片（第 6.5 节）：
   *  left → 完整菜单；top-left / dual-menu → 当前一级的 children；top → 不渲染。
   */
  const sidebarMenuList = computed<readonly NomiMenuItem[]>(() => {
    if (isLeftMenu.value) return menu.menuList;
    if (isTopLeftMenu.value || isDualMenu.value) return activeTopMenu.value?.children ?? [];
    return [];
  });

  /** 一级菜单点击时跳到的第一个可导航叶子（文档 handleMenuJump 的 jumpToFirst）。 */
  function firstChildPath(target: NomiMenuItem): string {
    return target.children?.[0]?.path ?? target.path;
  }

  /** 面包屑：[所属分组（可选）, 当前页]，标题都是 i18n key。 */
  const breadcrumbs = computed(() => {
    const flat = menu.findMenu(menuPath.value);
    if (!flat) return [];
    const result: { title: string; path?: string }[] = [];
    if (flat.parent) result.push({ title: flat.parent });
    result.push({ title: flat.title, path: flat.path });
    return result;
  });

  const sidebarWidth = computed(() =>
    layout.state.menuOpen ? `${layout.state.menuOpenWidth}px` : `${MENU_CLOSE_WIDTH}px`,
  );

  return {
    isLeftMenu,
    isTopMenu,
    isTopLeftMenu,
    isDualMenu,
    showLeftMenu,
    activeMenuPath,
    activeTopMenu,
    sidebarMenuList,
    breadcrumbs,
    sidebarWidth,
    firstChildPath,
    /** store 里的菜单是响应式的：接口换了菜单，水平/混合菜单会自动跟着变。 */
    firstLevelMenus: menu.menuList,
    homePath: menu.homePath,
  };
}

/**
 * 响应式降级（第 16.2 节 useResponsiveLayout + 第 20.2 节修复）。
 *
 * 只在「跨断点」时收起菜单，而不是每次 resize 都写 store —— 后者会让用户在
 * 桌面端手动收起的侧栏被一次无意义的窗口抖动强行展开。
 * 桌面布局备份在 localStorage，回到宽屏时原样恢复。
 */
const RESPONSIVE_MENU_TYPE_KEY = 'nomi:responsive-menu-type';

export function useResponsiveLayout(): void {
  // 视口宽度与 localStorage 都只在浏览器有意义；服务端写 store 会让水合后的
  // DOM 类名与服务端 HTML 对不上（/admin/** 已是 SPA，这里仍做防御）。
  if (!import.meta.client) return;
  const layout = useLayoutStore();
  const { width } = useWindowSize();
  const breakpoints = useBreakpoints({
    tablet: LAYOUT_BREAKPOINTS.TABLET,
    mobile: LAYOUT_BREAKPOINTS.MOBILE,
  });
  const isNarrow = breakpoints.smaller('tablet');
  const isMobile = computed(() => isMobileWidth(width.value));

  function readBackup(): string | null {
    if (!import.meta.client) return null;
    return localStorage.getItem(RESPONSIVE_MENU_TYPE_KEY);
  }

  watch(
    isNarrow,
    (narrow) => {
      if (narrow) {
        if (readBackup() === null && layout.state.menuType !== MenuTypeEnum.LEFT) {
          localStorage.setItem(RESPONSIVE_MENU_TYPE_KEY, layout.state.menuType);
          layout.switchMenuLayouts(MenuTypeEnum.LEFT);
        }
        layout.setMenuOpen(false);
      } else {
        const backup = readBackup();
        if (backup && layout.state.menuType === MenuTypeEnum.LEFT) {
          layout.switchMenuLayouts(backup as MenuType);
        }
        if (import.meta.client) localStorage.removeItem(RESPONSIVE_MENU_TYPE_KEY);
        layout.setMenuOpen(true);
      }
    },
    { immediate: true },
  );

  // ≤800px 时侧栏是 fixed 抽屉，桌面态的展开值不能带进小屏。
  watch(isMobile, (mobile) => {
    layout.setMenuOpen(!mobile);
  });
}

// ---------------------------------------------------------------------------
// 菜单风格跟随明暗主题（第 17.4 节的补充）
// ---------------------------------------------------------------------------
/**
 * 切到暗色模式时把菜单风格一起切成暗色 —— 这两件事在用户眼里是同一件事。
 *
 * 侧栏的亮色预设是白底：暗色界面里它会是整屏最亮的一块，比内容区还抢眼，
 * 看上去像样式坏了。所以「暗色 → 暗色菜单」是规则，不是可选优化。
 *
 * 只同步「主题变化」这一刻，不接管每一次手动选择：
 *   · 亮色主题下选暗色菜单（深侧栏 + 浅内容区）是常见搭配，允许留着；
 *   · 双栏菜单的第一列本来就是浅色图标条，store 已强制亮色，这里不越权；
 *   · 首屏只修「暗色主题 + 亮色菜单」这个坏组合，避免刷新时把上面的搭配改掉。
 * 另外 menuTheme 的色值已经改成变量（见 constants/layout.ts + layout.scss），
 * 即使有人硬留在「亮色菜单 + 暗色主题」，侧栏也是深色卡片而不是白板。
 */
export function useMenuThemeSync(): void {
  if (!import.meta.client) return;
  const layout = useLayoutStore();
  const setting = useSettingStore();

  function sync(dark: boolean): void {
    if (layout.state.menuType === MenuTypeEnum.DUAL_MENU) return;
    const next = dark ? MenuThemeEnum.DARK : MenuThemeEnum.LIGHT;
    if (layout.state.menuTheme !== next) layout.patch({ menuTheme: next });
  }

  if (setting.isDark && layout.state.menuTheme === MenuThemeEnum.LIGHT) sync(true);

  watch(() => setting.isDark, sync);
}

// ---------------------------------------------------------------------------
// 移动端抽屉（第 1.6 / 20.2 节的延伸）
//
// ≤800px 时侧栏不再是「收起成 64px 的常驻窄条」，而是完全移出视口的抽屉：
// 继续复用 store 的 menuOpen 当开关，是为了让顶栏折叠按钮、设置面板、
// 响应式降级这三条已有的写入路径不必各存一份状态。
// ---------------------------------------------------------------------------

/** 纯函数：所有需要判断「是否小屏」的地方共用，断点数字只在一处定义。 */
export function isMobileWidth(width: number): boolean {
  return Number.isFinite(width) && width > 0 && width <= LAYOUT_BREAKPOINTS.MOBILE;
}

/** 抽屉宽度：视口的 82%，封顶 288px；服务端拿不到视口时给一个合理值。 */
export function getMobileDrawerWidth(width: number): string {
  const viewport = Number.isFinite(width) && width > 0 ? width : 360;
  return `${Math.round(Math.min(viewport * MOBILE_DRAWER_WIDTH_RATIO, MOBILE_DRAWER_MAX_WIDTH))}px`;
}

/** 抽屉开合状态；区域组件只读，不自己解释视口宽度。 */
export function useMobileDrawer() {
  const layout = useLayoutStore();
  const { width } = useWindowSize();
  const isMobile = computed(() => isMobileWidth(width.value));
  const isOpen = computed(() => isMobile.value && layout.state.menuOpen);

  function close(): void {
    if (isMobile.value) layout.setMenuOpen(false);
  }

  function toggle(): void {
    layout.toggleMenu();
  }

  return { isMobile, isOpen, close, toggle };
}

/**
 * 抽屉的全局副作用只在布局容器里挂一次：
 *  · html.nomi-drawer-open → CSS 锁背景滚动、控制滑入动画；
 *  · 任意导航（含顶栏、面包屑、浏览器后退）都自动收起抽屉；
 *  · ESC 关闭，符合抽屉的可访问性预期。
 * 事件与 class 在卸载时自动清理，不会污染登录页等无布局路由。
 */
export function useMobileDrawerEffects(): void {
  if (!import.meta.client) return;
  const route = useRoute();
  const { isOpen, close } = useMobileDrawer();

  watch(
    isOpen,
    (open) => {
      document.documentElement.classList.toggle('nomi-drawer-open', open);
    },
    { immediate: true },
  );

  watch(() => route.fullPath, close);

  useEventListener(document, 'keydown', (event: KeyboardEvent) => {
    if (event.key === 'Escape' && isOpen.value) close();
  });

  onUnmounted(() => {
    document.documentElement.classList.remove('nomi-drawer-open');
  });
}

/**
 * 把 store 里的视觉偏好写进 <html>（第 1.8 节五层 CSS 变量链的最后一环）。
 * 颜色交给 app/stores/setting.ts 的主题插件，这里只管圆角与盒子模式。
 */
export function useLayoutDom(): void {
  const layout = useLayoutStore();
  watchEffect(() => {
    if (!import.meta.client) return;
    const root = document.documentElement;
    root.style.setProperty('--nomi-radius', `${layout.state.customRadius}rem`);
    root.dataset.boxMode = layout.state.boxBorderMode ? 'border' : 'shadow';
  });
}

/** 每次导航回到主区顶部 —— 滚动容器是 #app-main，不是 window（第 1.5 节）。 */
export function scrollMainToTop(): void {
  if (!import.meta.client) return;
  document.getElementById('app-main')?.scrollTo({ top: 0 });
  // ≤800px 时滚动容器从 #app-main 交还给文档，只滚主区不会回到顶部。
  if (isMobileWidth(window.innerWidth)) window.scrollTo({ top: 0 });
}

/** 内容区最小高度（第 14 章），保证短页面也能铺满背景。 */
export function useLayoutHeight() {
  const layout = useLayoutStore();
  const containerMinHeight = computed(() => {
    const workTab = layout.state.showWorkTab ? 44 : 0;
    return `calc(100dvh - ${HEADER_HEIGHT + workTab + 16}px)`;
  });
  return { containerMinHeight };
}
