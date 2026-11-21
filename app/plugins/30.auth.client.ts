/**
 * 权限插件：注册 `v-auth` 指令。
 *
 *   <el-button v-auth="'add'">新增</el-button>
 *
 * 指令只做隐藏，**不参与任何安全判断**。没有权限的按钮本可以完全不渲染
 * （服务端连名字都不下发），但指令写法更省事，适合零散按钮。
 *
 * 用 display:none 而不是移除元素：移除之后再怎么更新权限都回不来了，
 * 而 display 可以在 updated 里随权限变化恢复（同一会话内切账号不会发生，
 * 但开发期热更新会）。
 */
import { usePermissionStore } from '../stores/permission';
import { useUserStore } from '../stores/user';
import { normalizeMenuPath } from '../utils/path';

export default defineNuxtPlugin((nuxtApp) => {
  function apply(el: HTMLElement, action: unknown): void {
    if (typeof action !== 'string' || !action) return;
    const user = useUserStore();
    if (!user.isLogin) {
      el.style.display = 'none';
      return;
    }
    const permission = usePermissionStore();
    const path = normalizeMenuPath(nuxtApp.$router.currentRoute.value.path);
    el.style.display = permission.auth(path, action) ? '' : 'none';
  }

  nuxtApp.vueApp.directive('auth', {
    mounted(el: HTMLElement, binding) {
      apply(el, binding.value);
    },
    updated(el: HTMLElement, binding) {
      apply(el, binding.value);
    },
  });
});
