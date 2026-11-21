/**
 * 公开的站点展示配置：登录页、水印、浏览器标签、SEO head 都需要它，
 * 但不能把安全策略、邮件密码一起吐出去。
 *
 * 只返回「不调用接口就能看到」的部分：site 的展示字段、environment 的
 * 环境标识与地址、seo 的全部字段。三者合成一次请求，首屏不去打三个接口。
 */
import { definePublicHandler } from '../utils/auth/handler';
import { loadSystemConfig } from '../utils/system-config';

export default definePublicHandler(async () => {
  const { site, environment, seo } = await loadSystemConfig();
  return {
    name: site.name,
    logo: site.logo,
    favicon: site.favicon,
    description: site.description,
    copyrightEnabled: site.copyrightEnabled,
    copyright: site.copyright,
    icp: site.icp,
    environment: {
      current: environment.current,
      showBadge: environment.showBadge,
      devUrl: environment.devUrl,
      testUrl: environment.testUrl,
      prodUrl: environment.prodUrl,
    },
    seo: {
      titleTemplate: seo.titleTemplate,
      description: seo.description,
      keywords: seo.keywords,
      ogImage: seo.ogImage,
      canonicalBase: seo.canonicalBase,
      allowIndexing: seo.allowIndexing,
      ogType: seo.ogType,
    },
  };
});
