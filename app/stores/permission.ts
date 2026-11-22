/**
 * 权限 store —— 前端权限的**唯一数据源**。
 *
 * 只存服务端下发的三份产物（对应文档 8.7 / 8.10）：
 *   · menus     → 菜单树（同时决定「哪些页面可达」）
 *   · authNode  → 路由 path → 该页可用动作（按钮显隐）
 *   · authNames → 完整节点名（`can('system/role/add')` 用）
 *
 * 刻意不做任何权限计算：判断逻辑在服务端，前端只做「查表」。
 * 这里也**不是安全边界** —— 真正的拦截在 server/utils/auth/handler.ts。
 */
import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { apiFetch } from '../utils/request';
import type { AdminInfo, InitPayload, MenuNode } from '../types/permission';
import type { NomiMenuItem } from '../constants/layout';
import { useMenuStore } from './menu';

function flattenPaths(nodes: readonly MenuNode[], into: Set<string>): void {
  for (const node of nodes) {
    if (node.path && !node.path.startsWith('#')) into.add(node.path);
    if (node.children?.length) flattenPaths(node.children, into);
  }
}

export const usePermissionStore = defineStore('permission', () => {
  const loaded = ref(false);
  const loading = ref(false);
  const isSuper = ref(false);
  const adminInfo = ref<AdminInfo | null>(null);
  const menus = ref<MenuNode[]>([]);
  const authNode = ref<Record<string, string[]>>({});
  const authNames = ref<string[]>([]);

  /** 有权访问的页面路径：菜单 + 有按钮节点的页面。 */
  const allowedPaths = computed<ReadonlySet<string>>(() => {
    const set = new Set<string>();
    flattenPaths(menus.value, set);
    for (const path of Object.keys(authNode.value)) set.add(path);
    return set;
  });

  const homePath = computed(() => {
    const first = allowedPaths.value.values().next();
    return first.done ? '/admin' : first.value;
  });

  function apply(payload: InitPayload): void {
    adminInfo.value = payload.adminInfo;
    isSuper.value = Boolean(payload.adminInfo.super);
    menus.value = payload.menus ?? [];
    authNode.value = payload.authNode ?? {};
    authNames.value = payload.authNames ?? [];
    loaded.value = true;

    // 菜单是权限的下游：store 里只放「这个人能看见的那棵树」。
    useMenuStore().setMenuList(payload.menus as unknown as NomiMenuItem[]);
  }

  /**
   * 拉取初始化数据。返回 false 表示「没有有效登录态」，调用方负责跳登录页。
   * 并发调用合并成一次请求：布局挂载与路由守卫可能同时触发。
   *
   * force=true 用于权限刚变更的场景（如改了自己的角色授权）：跳过 loaded 短路
   * 重新拉一次，让菜单 / 按钮 / authNames 立刻跟上服务端的最新授权。
   */
  let inflight: Promise<boolean> | null = null;

  async function bootstrap(force = false): Promise<boolean> {
    if (loaded.value && !force) return true;
    if (inflight) return inflight;

    loading.value = true;
    inflight = apiFetch<InitPayload>('/api/admin/init')
      .then((payload) => {
        apply(payload);
        return true;
      })
      .catch(() => false)
      .finally(() => {
        loading.value = false;
        inflight = null;
      });

    return inflight;
  }

  /** 强制刷新权限上下文。保留 loaded=true，避免刷新期间路由守卫重复触发。 */
  function refresh(): Promise<boolean> {
    return bootstrap(true);
  }

  /** 当前页面是否允许某个动作，如 auth('/admin/system/permissions', 'add')。 */
  function auth(path: string, action: string): boolean {
    if (isSuper.value) return true;
    return (authNode.value[path] ?? []).includes(action);
  }

  /** 是否拥有某个完整节点名。 */
  function can(node: string): boolean {
    if (isSuper.value) return true;
    const target = node.toLowerCase();
    return authNames.value.some((name) => name.toLowerCase() === target);
  }

  function reset(): void {
    loaded.value = false;
    loading.value = false;
    isSuper.value = false;
    adminInfo.value = null;
    menus.value = [];
    authNode.value = {};
    authNames.value = [];
    // 菜单是权限的下游：清空权限也要清空菜单，否则换账号 / token 过期时
    // 侧栏会残留上一人的树（menu store 基线是全量静态菜单，不清更危险）。
    useMenuStore().setMenuList([]);
  }

  return {
    loaded,
    loading,
    isSuper,
    adminInfo,
    menus,
    authNode,
    authNames,
    allowedPaths,
    homePath,
    apply,
    bootstrap,
    refresh,
    auth,
    can,
    reset,
  };
});
