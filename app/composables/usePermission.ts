/**
 * 页面里判断权限的唯一入口。
 *
 *   const { auth, can, isSuper } = usePermission()
 *   auth('add')                     // 当前页面是否有 add 动作（按钮显隐）
 *   auth('del', '/admin/system/rules') // 指定页面
 *   can('system/role/add')          // 完整节点名
 *
 * 与文档 8.8 的 `auth()` 语义一致：它只影响「显示」，不影响「能不能调接口」。
 */
import { computed } from 'vue';
import { normalizeMenuPath } from '../utils/path';
import { usePermissionStore } from '../stores/permission';

export function usePermission() {
  const permission = usePermissionStore();
  const route = useRoute();

  const currentPath = computed(() => normalizeMenuPath(route.path));
  const actions = computed(() => permission.authNode[currentPath.value] ?? []);

  function auth(action: string, path?: string): boolean {
    return permission.auth(path ? normalizeMenuPath(path) : currentPath.value, action);
  }

  function can(node: string): boolean {
    return permission.can(node);
  }

  return {
    permission,
    actions,
    isSuper: computed(() => permission.isSuper),
    adminInfo: computed(() => permission.adminInfo),
    auth,
    can,
  };
}
