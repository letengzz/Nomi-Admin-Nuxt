/**
 * 全局路由守卫。
 *
 * 与传统 vue-router 项目（文档 8.2）的差别：Nuxt 是文件路由，没法「不注册无权页面」，
 * 所以这里补上「有权才允许进入」的等价能力：
 *
 *   1. 没 token → 登录页（带 redirect）
 *   2. 有 token 但权限数据没拉 → 拉一次（失败 = token 失效 → 登录页）
 *   3. 页面在静态菜单表里、但不在我的有权路径里 → 回我的首页
 *
 * 第 3 步**只是体验**：手输 URL 被挡回来，不用看到一个空页面。
 * 真正的边界在服务端 —— 每个接口都会独立验权。
 */
import { FLAT_MENU } from '../constants/layout';
import { fetchLoginConfig, type LoginConfig } from '../services/system-config';
import { usePermissionStore } from '../stores/permission';
import { useUserStore } from '../stores/user';
import { normalizeMenuPath } from '../utils/path';

/** 免登录页面（已归一化，不含语言前缀）。 */
const PUBLIC_PATHS = new Set(['/login', '/register', '/forget-password', '/maintenance']);

export default defineNuxtRouteMiddleware(async (to) => {
  // 后台路由整体 ssr:false；服务端渲染登录页时不需要也不该读 localStorage。
  if (!import.meta.client) return;

  const path = normalizeMenuPath(to.path);
  if (PUBLIC_PATHS.has(path)) return;
  if (!path.startsWith('/admin')) return;

  const user = useUserStore();
  if (!user.isLogin) {
    return navigateTo(`/login?redirect=${encodeURIComponent(to.fullPath)}`);
  }

  const permission = usePermissionStore();
  if (!permission.loaded) {
    const ready = await permission.bootstrap();
    if (!ready) return navigateTo('/login');
  }

  // 初始口令未改：只放行个人中心（改密入口）。
  // 必须放在「未授权页面」判断之前：一个没被授予 `system/profile` 的角色，
  // 会被下面那条规则弹回首页，而首页的接口全是 428 —— 等于永远改不了密码。
  if (permission.adminInfo?.mustChangePassword) {
    const localePath = useLocalePath();
    if (path === '/admin/profile') return;
    return navigateTo(localePath('/admin/profile'));
  }

  // 维护模式：普通用户只看维护页。配置用 useState 缓存一次，避免每次切页都打接口；
  // 服务端 defineAdminHandler 也有一道同样的闸，这里只负责把人送到提示页。
  const access = useState<LoginConfig | null>('nomi-access-config', () => null);
  if (!access.value) access.value = await fetchLoginConfig();
  if (access.value.maintenanceEnabled && !permission.isSuper) return navigateTo('/maintenance');

  // 未授权页面：只有「系统里确实存在这个页面」时才拦，避免误伤了动态详情页。
  const knownPage = FLAT_MENU.some((item) => item.path === path);
  if (!knownPage) return;
  if (permission.allowedPaths.size === 0) return; // 一个节点都没有：交给接口报 401，而不是死循环
  if (permission.allowedPaths.has(path)) return;

  const home = permission.homePath;
  if (home !== path) return navigateTo(home);
});
