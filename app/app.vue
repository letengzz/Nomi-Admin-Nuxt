<script setup lang="ts">
/**
 * 根组件：Nuxt 里没有 main.ts，应用级的「全局壳」就在这里。
 *
 * 传统 Vue 项目把 ElConfigProvider / RouterView / 全局初始化都堆在 App.vue，
 * Nuxt 已经替掉了其中大部分（路由、插件、样式、head），这里只剩两件真正需要
 * 应用级统一处理的事：
 *
 *   ① Element Plus 的全局配置 —— 组件内部文案（空数据、分页、日期）跟随当前语言，
 *      弹层层级从 3000 起，避免和业务里写死的 z-index 撞车。
 *   ② 明暗主题的 CSS 变量 —— 只声明「确定」的取值，系统偏好那套留在 tokens.scss。
 *
 * 主题的**首帧**应用不在这里，也不在插件里：它是一段写进 <head> 的内联脚本
 * （见 shared/utils/theme-bootstrap.ts）。等到组件挂载才执行就晚了，暗色用户
 * 会先看到一帧白屏。
 */
import { computed, nextTick, watch } from 'vue';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import en from 'element-plus/es/locale/lang/en';
import { buildSeoMeta, resolveTitleTemplate, type SeoMetaTag } from '#shared/utils/seo';
import { DEFAULT_SITE_INFO, fetchSiteInfo } from './services/site';

const { locale } = useI18n();

// i18n 是语言状态的唯一来源，Element Plus 只是跟随它，不另存一份语言设置。
// 「语言管理」里可以新增任意语言，Element Plus 只内置了有限几套语言包：
// 认得出前缀的用它（en-US → en），认不出的按中文兜底，总比整块组件突然变英文好。
const elLocale = computed(() => {
  const code = String(locale.value || 'zh').toLowerCase();
  return code.startsWith('en') ? en : zhCn;
});

/**
 * 浏览器标签页的品牌名取自系统配置 site.name。
 *
 * 不写 `nuxt.config` 的 site.name / head.title 是因为那是编译期常量：
 * 在「系统配置」里改了名字，标签页会一直停在旧名字，直到下次发版。
 * 这里用函数形式的 titleTemplate，配合 store 的 computed，配置更新后自动重算。
 * 同理 favicon 也跟着 site.favicon 走，没上传时仍用 public/favicon.ico。
 */
const site = useSiteStore();

/**
 * 站点配置在**服务端**就要拿到，否则 SEO 标签永远是默认值。
 *
 * 以前靠 plugins/04.site.client.ts 在水合后拉取 —— 那对品牌名、favicon 都够用
 * （反正是客户端替换），但 description / robots / og 这些是给爬虫看的，
 * 爬虫不执行 JS，永远不会走到那一步。
 *
 * 改用 useAsyncData：服务端取一次并写进 payload，客户端复用它，两边数据完全
 * 一致，所以既拿到了正确的 SSR head，也不会 hydration mismatch。
 * 注意 app.vue 里用顶层 await 是允许的，Nuxt 会为根组件包 Suspense。
 */
const { data: siteConfig } = await useAsyncData('nomi:site-config', () => fetchSiteInfo(), {
  default: () => structuredClone(DEFAULT_SITE_INFO),
});
// 只在水合前的首次赋值时写入，之后由 store 自己维护（配合 nomi:site-updated 重拉）。
site.apply(siteConfig.value);

// titleTemplate 必须是 computed 字符串：函数形式只会被 unhead 解析一次，
// 改完系统配置后标签页会一直挂在旧名字上。%s 由各页面自己的 title 填。
// 模板来自「系统配置 → SEO 配置」，留空时回落到「%s | 站点名」（见 resolveTitleTemplate）。
const titleTemplate = computed(() => resolveTitleTemplate(site.seo.titleTemplate, site.name));

/**
 * SEO meta 全部来自系统配置，且随 store 变化自动重算。
 *
 * 只在这里输出「全站兜底」的那几条：页面自己的 useHead 拿到的同名标签会覆盖
 * 这里的值（unhead 按 name/property 去重），所以详情页可以放心再写一次 description。
 */
const seoMeta = computed<SeoMetaTag[]>(() =>
  buildSeoMeta({
    description: site.seo.description,
    keywords: site.seo.keywords,
    ogImage: site.seo.ogImage,
    ogType: site.seo.ogType,
    allowIndexing: site.seo.allowIndexing,
    siteName: site.name,
    siteDescription: site.info.description,
  }),
);

/**
 * canonical 不在这里输出 —— @nuxtjs/seo 的 seo-utils 会用 `site.url` 生成
 * `<link rel="canonical">` 和 `og:url`，再写一条就是两个 canonical，冲突。
 *
 * 「系统配置里的规范域名」由服务端的 server/plugins/seo-site-config.ts 在
 * `site-config:init` 阶段推进 site-config 栈，SSR 出来的 canonical 就已经正确；
 * 客户端不再二次改写，避免与服务端渲染的结果不一致。
 */

/**
 * 图标要完全跟随系统配置，而不是被 @nuxtjs/seo 自动注入的静态 icon 抢走。
 *
 * seo-utils 扫描 public/favicon.ico 后会注入一条无 key 的
 * `<link rel="icon" type="image/vnd.microsoft.icon" sizes="32x32" href="/favicon.ico">`，
 * 它的 dedupeKey 是 `link:icon:/favicon.ico`。这里声明一条**不带 key、href 相同**
 * 的动态 link，dedupeKey 完全一致，unhead 会用我们这条替换掉静态那条；
 * favicon 更新时它跟着变，标签页图标才会真正切换。
 *
 * 保留带 key 的那条是为了兼容只认 `data-hid=favicon` 的场景，两条 href 始终一致。
 */
const iconHref = () => site.favicon || '/favicon.ico';
/**
 * 整块用函数形式：meta 与 titleTemplate 都是算出来的，函数形式每次依赖变化
 * 都会重新求值；把 ref 塞进静态数组则依赖 unhead 的内部解包规则，不稳。
 *
 * rel 必须写 `as const`：unhead 的 Link 类型把 rel 收窄成字面量联合，
 * 从表达式里推出来会被放宽成 string，整块 head 就通不过类型检查。
 */
useHead(() => ({
  titleTemplate: titleTemplate.value,
  meta: seoMeta.value,
  link: [
    { rel: 'icon' as const, href: iconHref() },
    { rel: 'icon' as const, key: 'favicon', href: iconHref() },
  ],
}));

/**
 * 兜底：seo-utils 的客户端插件在水合后会再把那条静态 icon 注回 <head>，
 * 所以除了 useHead 去重，图标变化时也强制把所有 rel=icon 的 href 统一。
 * 延迟到下一帧，确保排在 unhead 重渲染之后；只在客户端跑，不碰 SSR 的 HTML。
 */
if (import.meta.client) {
  watch(
    () => site.favicon,
    async (href) => {
      const next = href || '/favicon.ico';
      await nextTick();
      const sync = () =>
        document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]').forEach((link) => {
          if (link.getAttribute('href') !== next) link.setAttribute('href', next);
        });
      sync();
      requestAnimationFrame(sync);
    },
    { immediate: true, flush: 'post' },
  );
}

// 页面过渡不挂在 NuxtPage 上：NuxtPage 在 SPA + Suspense 下会吞掉 transition，
// 症状正是「设置里选了效果、切页面却什么都没发生」。改由布局里的
// NomiPageContent 用 <Transition :key="route.fullPath"> 显式驱动（第 13.3 节）。
</script>

<template>
  <ElConfigProvider :locale="elLocale" :z-index="3000">
    <NuxtRouteAnnouncer />
    <!--
      自定义 app.vue 必须自己挂 NuxtLayout：内建默认 app.vue 才自带这一层。
      否则 definePageMeta({ layout: 'admin' }) 只是记在 route.meta 上，
      页面会「裸奔」—— 只有业务组件，没有侧栏 / 顶栏 / 全局层。
      没有 layouts/default.vue 时 NuxtLayout 对未指定布局的页面（登录页等）直接透传。
    -->
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </ElConfigProvider>
</template>

<style>
/* ---------------------------------------------------------------------------
 * 手动主题：给用户切换的明暗模式一个确定的取值。
 *
 * tokens.scss 里还有一套 prefers-color-scheme 暗色覆盖，那是「系统偏好」；
 * 这里用 html:not(.dark) 明确亮色、html.dark 明确暗色，选择器优先级更高，
 * 所以「系统暗色 + 用户选亮色」也能正确显示。
 * ------------------------------------------------------------------------- */
html:not(.dark) {
  --bg: #fff;
  --bg-subtle: #f8fafc;
  --bg-inset: #f1f1f4;
  --fg: #0f172a;
  --fg-muted: #64748b;
  --border: #e2e8f0;
  --danger-bg: #fef2f2;
  --warn-bg: #fffbeb;
  --info-bg: #f1f5f9;
}

html.dark {
  --bg: #0b1120;
  --bg-subtle: #111827;
  --bg-inset: #1b2537;
  --fg: #e2e8f0;
  --fg-muted: #94a3b8;
  --border: #1f2937;
  --danger-bg: #2a1315;
  --warn-bg: #2a2110;
  --info-bg: #16202e;

  /* Element Plus 暗色基础变量 */
  --el-bg-color: #111827;
  --el-bg-color-page: #0b1120;
  --el-bg-color-overlay: #1f2937;
  --el-text-color-primary: #e2e8f0;
  --el-text-color-regular: #cbd5e1;
  --el-text-color-secondary: #94a3b8;
  --el-text-color-placeholder: #94a3b8;
  --el-border-color: #334155;
  --el-border-color-light: #263449;
  --el-border-color-lighter: #1f2937;
  --el-border-color-extra-light: #1f2937;
  --el-fill-color-blank: #111827;
  --el-fill-color-light: #1f2937;
  --el-fill-color-lighter: #172033;
  --el-fill-color-dark: #263449;
  --el-fill-color-darker: #334155;
  --el-fill-color: #1f2937;
  --el-mask-color: rgb(0 0 0 / 70%);

  /* 表格斑马纹走 --el-fill-color-lighter，不补这一层暗色下会留着亮色的白行 */
  --el-table-bg-color: #111827;
  --el-table-tr-bg-color: #111827;
  --el-table-header-bg-color: #111827;
  --el-table-row-hover-bg-color: #1f2937;
  --el-table-border-color: #1f2937;
}

/* ---------------------------------------------------------------------------
 * 明暗切换的圆形揭示 —— 裁剪动画由 app/utils/theme-transition.ts 驱动。
 *
 * View Transitions 默认会替新旧两帧做一次交叉淡入，这里必须关掉：淡入会把
 * 裁剪出的硬边糊成一片灰，圆弧的前锋就看不出来了。mix-blend-mode 一并归位，
 * 否则两帧叠加时对比度会发灰。
 * ------------------------------------------------------------------------- */
::view-transition-old(root),
::view-transition-new(root) {
  animation: none;
  mix-blend-mode: normal;
}

/* 切暗色时主角是「旧快照」（亮色那帧）：它要缩回左下角，得压在新快照上面。
   默认层叠次序是新在上，不换序就只看得到暗色瞬间铺满、看不到收缩。 */
html.nomi-reveal-contract::view-transition-old(root) {
  z-index: 2;
}

html.nomi-reveal-contract::view-transition-new(root) {
  z-index: 1;
}
</style>
