/**
 * 工作标签栏 store —— docs/状态管理.md 第 5 章（worktab.ts，569 行）+
 * docs/主布局设计.md 第 15 / 17.6 章。
 *
 * 与文档对齐的三条关键设计：
 *  ① **按路由名优先复用标签**：动态路由（`/user/1` → `/user/2`）路径不同但是同一
 *     个页面，必须共用一个标签。先按 name 找，找不到再按 path 找。
 *  ② **关标签 = 清缓存**：关闭时把组件 name 塞进 keepAliveExclude，包在
 *     <KeepAlive :exclude> 上才会真正销毁实例；重新打开时再移出名单，保证拿到
 *     全新实例而不是一份几小时前的旧数据。
 *  ③ **store 不导航**：关闭标签只返回「接下来该激活哪个路径」，由组件决定
 *     navigateTo / router.push。这样 store 能在纯 vitest 里测，也不绑死 Nuxt 的
 *     自动导入（tests/layout-store.spec.ts 就是这么跑的）。
 *
 * 与文档的一处差异：文档把 current（当前激活标签）也放在 store 里，这里没有。
 * Nuxt 的路由本来就是「当前在哪」的唯一事实来源，再存一份 current 迟早出现
 * route.path 与 current.path 打架（浏览器前进后退时尤其明显），所以激活态由
 * 组件读 route.path。
 */
import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { usePersistedState } from '../composables/usePersistedState';
import { HOME_PATH } from '../constants/layout';
import { legacyStorageKey, storageKey } from '../utils/storage-key';
import { useMenuStore } from './menu';

export interface WorkTabItem {
  path: string;
  /** i18n key */
  title: string;
  icon: string;
  query?: Record<string, string>;
  params?: Record<string, string>;
  fixedTab?: boolean;
  /** 运行时自定义标题，优先级高于 title */
  customTitle?: string;
  /** 组件 name，用于 KeepAlive 排除名单与标签复用 */
  name?: string;
}

export const HOME_TAB: WorkTabItem = {
  path: HOME_PATH,
  title: 'layout.menu.dashboard',
  icon: 'dashboard',
  fixedTab: true,
};

export const WORKTAB_STORAGE_KEY = storageKey('worktab');

export const useWorktabStore = defineStore('worktab', () => {
  /**
   * 标签列表持久化：刷新浏览器后标签栏还在，是这类后台的默认预期。
   * mergeDefaults 关掉 —— 数组没有「缺字段」的概念，多一层合并只会让
   * 存储里的空数组被默认标签覆盖（用户关光了标签，刷新后又全回来了）。
   */
  const opened = usePersistedState<WorkTabItem[]>('worktab', [{ ...HOME_TAB }], {
    legacyKeys: [legacyStorageKey('worktabs')],
    mergeDefaults: false,
  });

  /** 缓存排除名单不持久化：它只在当前会话的 <KeepAlive> 里有意义。 */
  const keepAliveExclude = ref<string[]>([]);

  const hasOpenedTabs = computed(() => opened.value.length > 0);
  const hasMultipleTabs = computed(() => opened.value.length > 1);
  const fixedTabs = computed(() => opened.value.filter((tab) => tab.fixedTab));

  function currentIndex(path: string): number {
    return opened.value.findIndex((tab) => tab.path === path);
  }

  function findTab(path: string, name?: string): WorkTabItem | undefined {
    if (name) {
      const byName = opened.value.find((tab) => tab.name === name);
      if (byName) return byName;
    }
    return opened.value.find((tab) => tab.path === path);
  }

  function tabFromPath(path: string): WorkTabItem | undefined {
    const menu = useMenuStore().findMenu(path);
    if (!menu) return undefined;
    return {
      path: menu.path,
      title: menu.title,
      icon: menu.icon,
      fixedTab: menu.fixedTab,
    };
  }

  /**
   * 打开或激活标签。
   *
   * 命中已有标签时只更新元信息（query / params / path / 标题），不新增 —— 这就是
   * 「`/user/1` 与 `/user/2` 共用一个标签」的实现点。
   */
  function openTab(path: string, extra?: Partial<WorkTabItem>): void {
    const menu = useMenuStore().findMenu(path);
    if (!menu) return;

    const existing = findTab(path, extra?.name);
    if (existing) {
      existing.path = path;
      if (extra?.query) existing.query = extra.query;
      if (extra?.params) existing.params = extra.params;
      if (extra?.customTitle) existing.customTitle = extra.customTitle;
      // 重新打开时把该页面请出缓存排除名单，让它拥有全新的实例。
      if (existing.name) removeKeepAliveExclude(existing.name);
      return;
    }

    const tab: WorkTabItem = {
      path: menu.path,
      title: menu.title,
      icon: menu.icon,
      fixedTab: menu.fixedTab,
      ...extra,
    };

    // 固定标签永远排在所有固定项之后、普通项之前。
    if (tab.fixedTab) {
      opened.value.splice(fixedTabs.value.length, 0, tab);
    } else {
      opened.value.push(tab);
    }
  }

  function addKeepAliveExclude(name: string): void {
    if (name && !keepAliveExclude.value.includes(name)) {
      keepAliveExclude.value = [...keepAliveExclude.value, name];
    }
  }

  function removeKeepAliveExclude(name: string): void {
    keepAliveExclude.value = keepAliveExclude.value.filter((item) => item !== name);
  }

  function markRemoved(tabs: WorkTabItem[]): void {
    for (const tab of tabs) {
      if (tab.name) addKeepAliveExclude(tab.name);
    }
  }

  /** 关掉当前标签时返回应当激活的路径；固定标签不可关闭（返回 undefined）。 */
  function removeTab(path: string, currentPath: string): string | undefined {
    const index = currentIndex(path);
    if (index < 0 || opened.value[index]?.fixedTab) return undefined;
    const [removed] = opened.value.splice(index, 1);
    if (removed) markRemoved([removed]);
    if (path !== currentPath || opened.value.length === 0) return undefined;
    const next = opened.value[Math.min(index, opened.value.length - 1)];
    return next?.path;
  }

  function removeSide(side: 'left' | 'right', path: string, currentPath: string): string | undefined {
    const index = currentIndex(path);
    if (index < 0) return undefined;
    const candidates = side === 'left' ? opened.value.slice(0, index) : opened.value.slice(index + 1);
    const removable = candidates.filter((tab) => !tab.fixedTab);
    markRemoved(removable);
    const paths = new Set(removable.map((tab) => tab.path));
    opened.value = opened.value.filter((tab) => !paths.has(tab.path));
    return paths.has(currentPath)
      ? (opened.value.find((tab) => tab.path === path)?.path ?? opened.value[0]?.path)
      : undefined;
  }

  function removeOthers(path: string, currentPath: string): string | undefined {
    return closeExcept(new Set([path]), currentPath);
  }

  function removeAll(currentPath: string): string | undefined {
    return closeExcept(new Set(fixedTabs.value.map((tab) => tab.path)), currentPath);
  }

  function closeExcept(keep: ReadonlySet<string>, currentPath: string): string | undefined {
    const removable = opened.value.filter((tab) => !keep.has(tab.path) && !tab.fixedTab);
    markRemoved(removable);
    const paths = new Set(removable.map((tab) => tab.path));
    opened.value = opened.value.filter((tab) => !paths.has(tab.path));
    if (!paths.has(currentPath)) return undefined;
    return opened.value.find((tab) => keep.has(tab.path))?.path ?? opened.value[0]?.path;
  }

  function toggleFixedTab(path: string): void {
    const tab = findTab(path);
    if (!tab) return;
    tab.fixedTab = !tab.fixedTab;
    const fixedCount = opened.value.filter((item) => item !== tab && item.fixedTab).length;
    const index = currentIndex(path);
    if (index >= 0) opened.value.splice(index, 1);
    opened.value.splice(tab.fixedTab ? fixedCount : opened.value.length, 0, tab);
  }

  function updateTabTitle(path: string, customTitle: string): void {
    const tab = findTab(path);
    if (tab) tab.customTitle = customTitle;
  }

  /**
   * 菜单变更后清掉失效标签（文档 5.4 validateWorktabs）。
   * 不清的后果是刷新浏览器后标签栏里留着一批点开就 404 的入口。
   */
  function validateWorktabs(): void {
    const menu = useMenuStore();
    opened.value = opened.value.filter((tab) => menu.menuPaths.has(tab.path));
    if (opened.value.length === 0) opened.value = [{ ...HOME_TAB }];
  }

  /** 换用户登录 / 登出时清空：标签里可能残留上一个身份才看得到的页面。 */
  function reset(): void {
    opened.value = [{ ...HOME_TAB }];
    keepAliveExclude.value = [];
  }

  return {
    opened,
    keepAliveExclude,
    hasOpenedTabs,
    hasMultipleTabs,
    fixedTabs,
    currentIndex,
    findTab,
    tabFromPath,
    openTab,
    removeTab,
    removeSide,
    removeOthers,
    removeAll,
    toggleFixedTab,
    updateTabTitle,
    addKeepAliveExclude,
    removeKeepAliveExclude,
    validateWorktabs,
    reset,
  };
});
