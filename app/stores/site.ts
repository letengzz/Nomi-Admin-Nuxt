/**
 * 站点品牌与环境 / SEO：系统配置里的 site、environment、seo 三个区块，
 * 全站只有这一份。三块由同一个公开接口 `/api/site` 一次取回，避免首屏
 * 为一个环境角标再发一次请求。
 *
 * 以前品牌名读语言管理的 app.title，改个名字要去翻译表里翻；现在系统配置是
 * 唯一来源，侧栏、顶栏、授权页、水印、浏览器标签统一读这里的 name。
 *
 * 加载放在客户端 onNuxtReady（见 plugins/04.site.client.ts），和 i18n 运行时代
 * 理同样的时机：避免 SSR 出来的 HTML 与客户端首帧不一致。所以 state 初值必须
 * 和服务端 DEFAULT_CONFIG 对齐。
 */
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import {
  DEFAULT_SITE_INFO,
  envUrlOf,
  fetchSiteInfo,
  normalizeEnv,
  type SiteInfo,
} from '../services/site';

/** 环境角标的文案键：三档各自一条，渲染时再走 i18n。 */
const ENV_LABEL_KEY: Record<string, string> = {
  development: 'layout.environment.development',
  testing: 'layout.environment.testing',
  production: 'layout.environment.production',
};

export const useSiteStore = defineStore('site', () => {
  const info = ref<SiteInfo>(structuredClone(DEFAULT_SITE_INFO));
  const loaded = ref(false);

  const name = computed(() => info.value.name.trim() || DEFAULT_SITE_INFO.name);
  const logo = computed(() => info.value.logo);
  const favicon = computed(() => info.value.favicon);
  const copyrightEnabled = computed(() => info.value.copyrightEnabled);
  const copyright = computed(() => info.value.copyright.trim());
  const icp = computed(() => info.value.icp.trim());

  /** 收敛后的环境标识：认不出的值当开发环境，不让角标突然消失。 */
  const env = computed(() => normalizeEnv(info.value.environment.current));
  const envLabelKey = computed(() => ENV_LABEL_KEY[env.value] ?? ENV_LABEL_KEY.development!);
  const showEnvBadge = computed(() => info.value.environment.showBadge);
  /** 当前环境的访问地址：canonical 的兜底来源。 */
  const envUrl = computed(() => envUrlOf(info.value.environment, env.value));
  const seo = computed(() => info.value.seo);

  let pending: Promise<void> | null = null;

  /** 保存配置后也要调用：并发触发时共用同一次请求，不重复打接口。 */
  async function load(): Promise<void> {
    if (pending) return pending;
    pending = fetchSiteInfo()
      .then((value) => {
        info.value = value;
        loaded.value = true;
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  }

  function apply(value: SiteInfo): void {
    info.value = { ...value };
    loaded.value = true;
  }

  return {
    info,
    loaded,
    name,
    logo,
    favicon,
    copyrightEnabled,
    copyright,
    icp,
    env,
    envLabelKey,
    showEnvBadge,
    envUrl,
    seo,
    load,
    apply,
  };
});
