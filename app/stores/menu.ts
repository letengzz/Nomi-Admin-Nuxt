/**
 * 菜单 store —— docs/状态管理.md 第 4 章（menu.ts，110 行）。
 *
 * 文档里的这一层管四件事：菜单数据、首页路径、菜单宽度、动态路由的注销函数。
 * 本项目是 Nuxt 文件路由，没有「登录后 addRoute」这一步，但剩下的三件仍然需要
 * 一个运行期的落点：
 *
 *   · 菜单目前来自 constants/layout.ts 的静态常量，接真实后端时换成接口返回的
 *     setMenuList() 即可，面包屑 / 标签页 / 搜索都会跟着变（它们都读 flatMenu）；
 *   · 登出要把菜单还原、把首页路径清掉，否则下一个用户可能落进上一个用户的
 *     默认页；
 *   · removeRouteFns 保留下来，接「按权限动态注册路由」时不必再改 store 形状。
 *
 * 不持久化：菜单属于会话数据，刷新页面重新取一次比缓存一份可能过期的权限
 * 列表安全得多（文档第 4 章同样是「无持久化」）。
 */
import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import {
  flattenMenus,
  HIDDEN_MENU_LIST,
  HOME_PATH,
  MENU_LIST,
  type FlatMenuItem,
  type NomiMenuItem,
} from '../constants/layout';

/** 深拷贝菜单树：store 里的是一份可变副本，直接改常量数组会污染其他模块。 */
function cloneMenus(list: readonly NomiMenuItem[]): NomiMenuItem[] {
  return list.map((item) => ({
    ...item,
    ...(item.children ? { children: cloneMenus(item.children) } : {}),
  }));
}

/** 第一个可导航的叶子节点（目录项的 path 是 `#group-*` 占位，不能当首页）。 */
function firstLeafPath(list: readonly NomiMenuItem[]): string | undefined {
  for (const item of list) {
    if (item.children?.length) {
      const child = firstLeafPath(item.children);
      if (child) return child;
    } else {
      return item.path;
    }
  }
  return undefined;
}

export const useMenuStore = defineStore('menu', () => {
  const homePath = ref<string>(HOME_PATH);
  const menuList = ref<NomiMenuItem[]>(cloneMenus(MENU_LIST));
  /** 菜单栏实际宽度，由布局在测量后写入（文档 setMenuWidth）。 */
  const menuWidth = ref('');
  const removeRouteFns = ref<Array<() => void>>([]);

  /** 扁平表由菜单树派生，不另存一份，避免两份数据不同步。 */
  const flatMenu = computed<FlatMenuItem[]>(() => flattenMenus(menuList.value));
  /**
   * 隐藏页（个人中心）的扁平表：不参与侧栏 / 搜索渲染，只用来查标题。
   * 它是静态常量而不是从接口菜单里来 —— 接口菜单里本来就不该有它。
   */
  const hiddenMenu = computed<FlatMenuItem[]>(() => flattenMenus(HIDDEN_MENU_LIST));
  const menuPaths = computed<ReadonlySet<string>>(
    () => new Set([...flatMenu.value, ...hiddenMenu.value].map((item) => item.path)),
  );

  /**
   * 按路径查菜单项。先查可见菜单，再查隐藏页 —— 后者只为拿到标题与图标，
   * 所以调用方（面包屑 / 标签栏 / 标题）拿到的是「有名字的页面」而不是空值。
   */
  function findMenu(path: string): FlatMenuItem | undefined {
    return (
      flatMenu.value.find((item) => item.path === path) ??
      hiddenMenu.value.find((item) => item.path === path)
    );
  }

  /** 详情页用 activePath 指回所属列表项（`/admin/orders/detail` → `/admin/orders`）。 */
  function activePathOf(path: string): string {
    return findMenu(path)?.activePath ?? path;
  }

  /** 设置菜单并自动推导首页路径（文档 4.2：setMenuList 同时设置 homePath）。 */
  function setMenuList(list: readonly NomiMenuItem[]): void {
    menuList.value = cloneMenus(list);
    homePath.value = firstLeafPath(menuList.value) ?? HOME_PATH;
  }

  function getHomePath(): string {
    return homePath.value;
  }

  function setHomePath(path: string): void {
    homePath.value = path || HOME_PATH;
  }

  function setMenuWidth(width: string): void {
    menuWidth.value = width;
  }

  /** 登记动态路由的注销函数（Nuxt 文件路由下暂时为空，留给权限路由用）。 */
  function addRemoveRouteFns(fns: Array<() => void>): void {
    removeRouteFns.value = [...removeRouteFns.value, ...fns];
  }

  /**
   * 逐个执行注销函数。
   * 用 try/catch 包住单次调用：一个路由注销失败不应该让后面全部漏掉 ——
   * 漏掉的那些会在下一次登录时与新路由撞名。
   */
  function removeAllDynamicRoutes(): void {
    for (const remove of removeRouteFns.value) {
      try {
        remove();
      } catch (error) {
        if (import.meta.dev) console.warn('[menu] 注销动态路由失败', error);
      }
    }
    removeRouteFns.value = [];
  }

  function clearRemoveRouteFns(): void {
    removeRouteFns.value = [];
  }

  /** 登出 / 重置：菜单回到静态基线，首页路径回到默认值。 */
  function reset(): void {
    menuList.value = cloneMenus(MENU_LIST);
    homePath.value = HOME_PATH;
    menuWidth.value = '';
    removeAllDynamicRoutes();
  }

  return {
    homePath,
    menuList,
    menuWidth,
    flatMenu,
    menuPaths,
    findMenu,
    activePathOf,
    setMenuList,
    getHomePath,
    setHomePath,
    setMenuWidth,
    addRemoveRouteFns,
    removeAllDynamicRoutes,
    clearRemoveRouteFns,
    reset,
  };
});
