/**
 * 把「系统配置 → SEO 配置」里的规范域名喂给 @nuxtjs/seo 的 site-config 栈。
 *
 * 为什么需要这一步：seo-utils 的 canonical / og:url 都从 `site.url` 生成，
 * 而 `site.url` 默认只来自 nuxt.config 或 NUXT_SITE_URL（编译/部署期常量）。
 * 后台在系统配置里改了规范域名，页面上那条 canonical 不会跟着变 ——
 * 对爬虫来说，等于配置项形同虚设。
 *
 * 注入时机用 `site-config:init`：它在 seo-utils 的 applyDefaults 之前跑完，
 * 所以本请求内生成的 canonical 就已经是新域名，不需要客户端二次纠正。
 *
 * 失败一律吞掉：SEO 配置读不到时，canonical 退回 nuxt.config 的值即可，
 * 不该因此让整页 500。
 */
import { resolveSiteUrl } from '#shared/utils/seo';
import { loadSystemConfig } from '../utils/system-config';

/** 与 `environment` 区块的取值保持一致；认不出的当开发环境（与服务端读到的一致）。 */
const ENV_URL_KEY: Record<string, 'devUrl' | 'testUrl' | 'prodUrl'> = {
  development: 'devUrl',
  testing: 'testUrl',
  production: 'prodUrl',
};

export default defineNitroPlugin((nitroApp) => {
  // 演示构建没有数据库：canonical 直接沿用 nuxt.config 的 site.url
  // （CI 里由 NUXT_SITE_URL 注入），不做这次必然失败的查询。
  if (process.env.NUXT_PUBLIC_DEMO === '1') return;

  nitroApp.hooks.hook('site-config:init', async (ctx) => {
    try {
      const { seo, environment } = await loadSystemConfig();
      const envUrl = environment[ENV_URL_KEY[environment.current] ?? 'devUrl'] ?? '';
      const url = resolveSiteUrl(seo.canonicalBase, envUrl);
      if (!url) return;
      // 优先级取 1：高于 nitro:init 推入的「实际请求 origin」(-4) 与 runtime 级(0)。
      // 单租户站点里，管理员显式填的规范域名就该压过请求头里的 host
      // （反代 / 内网 IP 直连时尤其明显），但不必高到去覆盖多租户。
      ctx.siteConfig.push({ _context: 'nomi:system-config', _priority: 1, url });
    } catch {
      // 读配置失败就沿用 nuxt.config 的 site.url。
    }
  });
});
