/**
 * 把「语言管理」搬进运行时 i18n。
 *
 * 静态 zh/en.json 只做兜底：接口下发的是数据库里启用的语言 + 非空译文，
 * 客户端用「静态快照 + 译文」整体重建消息树。之所以不是简单的
 * `mergeLocaleMessage`，是因为 merge 只能加、不能减：把某条译文清空后，
 * 页面会继续显示上一次的旧文案，回不到内置文案。
 *
 * 五个时机：
 *   · 每次导航前 —— 按用户偏好纠正 i18n 误判的语言，消除中文闪现；
 *   · onNuxtReady —— 水合完成后再合并，避免服务端渲染的 HTML 与客户端首帧不一致；
 *   · nomi:i18n-updated —— 语言管理保存后派发，译文与切换器同时刷新；
 *   · 每次路由导航后 —— 数据库新增的语言（如 `ja`）没有 URL 前缀，
 *     @nuxtjs/i18n 会把地址栏判回默认语言，这里按用户偏好盖回去；
 *   · 只对客户端生效：SPA 后台的语言切换不依赖 URL，服务端渲染仍走路由前缀。
 */
import { resolveNavigationLocale } from '#shared/utils/i18n';
import {
  applyPreferredLocale,
  applyRuntimeMessages,
  runtimeDefaultLocale,
  type RuntimeI18nLike,
} from '../composables/useRuntimeI18n';

/** @nuxtjs/i18n 的 switch 钩子载荷；模块没有导出对应类型，这里只声明用到的字段。 */
interface BeforeLocaleSwitchPayload {
  oldLocale: string;
  newLocale: string;
  initialSetup: boolean;
}

export default defineNuxtPlugin((nuxtApp) => {
  if (!import.meta.client) return;

  const i18n = (nuxtApp as unknown as { $i18n?: RuntimeI18nLike }).$i18n;
  if (!i18n) return;

  /** 重新拉清单与译文，并把用户偏好语言重新应用一遍。 */
  const sync = async (): Promise<void> => {
    await applyRuntimeMessages(i18n);
    const user = useUserStore();
    const outcome = applyPreferredLocale(i18n, user.language);
    // 偏好语言被停用或删除：偏好要跟着改，否则下次启动还会去找一个不存在的语言。
    if (outcome === 'fallback') user.setLanguage(runtimeDefaultLocale(i18n));
  };

  /**
   * 导航前就把语言纠正过来，消除「先中文后英文」的闪现。
   *
   * @nuxtjs/i18n 的全局中间件每次导航都会按目标 URL 的前缀重判语言。后台菜单
   * 跳转用的是不带前缀的路径（`navigateTo('/admin/users')`），英文状态下点菜单
   * 会被判回中文、先渲染一帧中文，再靠下面的 afterEach 改回英文；
   * URL 的前缀也会在这一跳里丢掉。
   *
   * 钩子发生在 i18n 落语言之前：把 newLocale 改成用户偏好后，i18n 自己会把
   * 无前缀路径重定向回带前缀版本，整条链路从第一帧就是正确的语言。
   * 首屏跳过，让别人分享的 /en/... 由 URL 自己决定语言。
   */
  nuxtApp.hook('i18n:beforeLocaleSwitch', ((data: BeforeLocaleSwitchPayload) => {
    data.newLocale = resolveNavigationLocale(
      data.newLocale,
      useUserStore().language,
      data.initialSetup,
    );
  }) as never);

  onNuxtReady(() => void sync());
  window.addEventListener('nomi:i18n-updated', () => void sync());

  nuxtApp.$router.afterEach(() => {
    const user = useUserStore();
    const outcome = applyPreferredLocale(i18n, user.language);
    // 导航后才发现在用的语言被停用了：偏好同步回默认语言，避免下次启动再找一遍。
    if (outcome === 'fallback') user.setLanguage(runtimeDefaultLocale(i18n));
  });
});
