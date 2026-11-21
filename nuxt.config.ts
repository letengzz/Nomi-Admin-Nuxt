// https://nuxt.com/docs/api/configuration/nuxt-config
//
// 这个文件里有八个 marker 区间（原 scripts/init.mjs 的 SECTIONS 常量与之对应）：
//   TEMPLATE:IMPORTS         顶层 import
//   TEMPLATE:MODULES         模块数组
//   TEMPLATE:MODULE_OPTIONS  各模块自己的配置段（i18n、site 等）
//   TEMPLATE:VITE            vite 构建配置
//   TEMPLATE:CSS             全局样式入口（顺序固定，见 README）
//   TEMPLATE:RUNTIME         运行期配置
//   TEMPLATE:RENDER          渲染模式（ssr / nitro.preset / routeRules）
//   TEMPLATE:TYPESCRIPT      TypeScript 严格度
//
// 现状：初始化引擎（scripts/init.mjs）已从仓库移除，marker 保留下来仅作分区说明，
// 不再有任何程序会重写这些区间。新配置仍然建议写在文件末尾的「手写区」，
// 让「哪些是模板基线、哪些是本项目自己的决定」一眼可分。

import { readFileSync } from 'node:fs';
import { THEME_BOOTSTRAP_SCRIPT } from './shared/utils/theme-bootstrap';

// >>> TEMPLATE:IMPORTS
// <<< TEMPLATE:IMPORTS

/** 版本号只认 package.json —— 两处写死版本号迟早对不上。 */
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as {
  version: string;
};

export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  devtools: { enabled: true },

  // >>> TEMPLATE:MODULES
  modules: ['@element-plus/nuxt', '@unocss/nuxt', '@pinia/nuxt', '@vueuse/nuxt', '@nuxtjs/i18n', '@nuxt/icon', '@nuxt/image', '@nuxtjs/seo', '@nuxt/eslint'],
  // <<< TEMPLATE:MODULES

  // >>> TEMPLATE:MODULE_OPTIONS
  i18n: {
    // prefix_except_default：默认语言不带前缀，其余语言带 /en 这样的前缀。
    // 换成 'prefix' 会让中文也变成 /zh/，对国内项目通常不是想要的。
    defaultLocale: 'zh',
    strategy: 'prefix_except_default',
    locales: [
      { code: 'zh', language: 'zh-CN', file: 'zh.json' },
      { code: 'en', language: 'en-US', file: 'en.json' },
    ],
  },

  site: {
    // @nuxtjs/seo 需要一个**绝对** URL 才能生成 sitemap 与 canonical。
    // GitHub Pages 构建由 workflow 注入 NUXT_SITE_URL；本地不设置时仍是占位值。
    url: process.env.NUXT_SITE_URL || 'https://example.com',
    name: 'Nomi Admin',
  },
  // <<< TEMPLATE:MODULE_OPTIONS

  // >>> TEMPLATE:VITE
  vite: {
    // 编译期常量：业务代码里直接用 __APP_VERSION__，不经过 runtimeConfig。
    // 静态常量才能被 tree-shaking / 常量折叠利用；运行时再读一次配置就晚了。
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    },
    css: {
      preprocessorOptions: {
        scss: {
          // 设计令牌全局注入：组件里直接写 $brand-600 / $sp-4，不必逐个 @use。
          // 注入的是零输出的 _vars.scss，不会让每个组件多出一份 :root。
          additionalData: '@use "~/assets/styles/vars" as *;\n',
        },
      },
    },
    build: {
      // 中后台的 vendor chunk（Element Plus + Vue 全家桶）本来就大，
      // 默认 500KB 的警告线只会制造噪音，真正要看的是有没有异常膨胀。
      chunkSizeWarningLimit: 2000,
    },
  },
  // <<< TEMPLATE:VITE

  // >>> TEMPLATE:CSS
  // layout.scss 排在最后：它是布局层的全局选择器，需要能压过组件库的默认样式。
  css: ['virtual:uno.css', '~/assets/styles/tokens.scss', '~/assets/styles/base.css', 'element-plus/dist/index.css', '~/assets/styles/layout.scss', '~/assets/styles/auth.scss'],
  // <<< TEMPLATE:CSS

  // >>> TEMPLATE:RUNTIME
  runtimeConfig: {
    public: {
      appName: 'Nomi Admin',
    },
  },
  // <<< TEMPLATE:RUNTIME

  // >>> TEMPLATE:RENDER
  ssr: true,
  routeRules: {
    // 混合渲染：公开页面预渲染成静态，后台走 SPA。按你的实际路由调整。
    //
    // 根路径没有介绍页了（app/pages/index.vue 已删除），直接进后台主界面。
    // SSR 下这段重定向由 Nitro 在服务端完成，浏览器不会先拿到 404 再跳。
    // /en 那条是给 prefix_except_default 的英文路由用的，保证带前缀时同样落地。
    '/': { redirect: '/admin' },
    '/en': { redirect: '/en/admin' },
    // 设计文档里的 /auth/register 是 hash 路由模板的路径；Nuxt 用文件路由 /register，
    // 保留一条重定向让旧书签与文档验收路径也能到达。
    '/auth/register': { redirect: '/register' },
    // 同理：文档里的 /#/auth/forget-password。
    '/auth/forget-password': { redirect: '/forget-password' },
    // 后台主布局依赖视口宽度与 localStorage 偏好，整体走 SPA 更省心。
    // i18n 的 /en 前缀是另一套 URL，必须一并声明：否则 /en/admin 会走 SSR，
    // 服务端按「桌面顶栏」输出、客户端水合时按手机宽度换成「紧凑顶栏」，
    // 直接报 hydration mismatch（移动端适配暴露出来的既有缺口）。
    '/admin': { ssr: false },
    '/admin/**': { ssr: false },
    '/en/admin': { ssr: false },
    '/en/admin/**': { ssr: false },
  },
  // <<< TEMPLATE:RENDER

  // >>> TEMPLATE:TYPESCRIPT
  typescript: {
    strict: true,
    tsConfig: {
      compilerOptions: {
        noUncheckedIndexedAccess: true,
        noImplicitOverride: true,
      },
    },
  },
  // <<< TEMPLATE:TYPESCRIPT

  // ---------------------------------------------------------------------------
  // 手写区：引擎永不改动。你自己的 routeRules、模块选项、vite 配置写在这里。
  // ---------------------------------------------------------------------------

  // 监听所有网卡：手机真机、局域网同事都能直接打开，不用每次加 --host。
  devServer: { host: '0.0.0.0' },

  // SPA 启动占位页（相对 srcDir，即 app/spa-loading-template.html）。
  //
  // /admin/** 是 ssr:false：服务端只吐一个空壳 HTML，脚本下载 + 水合 + 路由守卫
  // 里那次权限接口期间，浏览器里就是一张纯白页。给一张带转圈的品牌占位页，
  // 把「白屏」变成「正在加载」。内容是纯静态 HTML，换文案/配色直接改那个文件。
  spaLoadingTemplate: 'spa-loading-template.html',

  // 构建期预压缩：等价于传统 Vite 项目里的 vite-plugin-compression，
  // 但由 Nitro 直接产出 .gz / .br。Nginx 打开 gzip_static 后直接吐静态压缩文件，
  // 省掉每个请求的实时压缩。只作用于 public/ 与预渲染产物，不碰 server 代码。
  nitro: {
    compressPublicAssets: { gzip: true, brotli: true },
  },

  app: {
    // GitHub Pages 项目页挂在 /<repo>/ 子路径下，构建时必须注入 baseURL，
    // 否则 HTML 里的 /_nuxt/ 资源路径会指向域名根目录而全部 404。
    baseURL: process.env.NUXT_APP_BASE_URL || '/',
    head: {
      // 不写 htmlAttrs.lang：由 @nuxtjs/i18n 按当前 locale 自动写入，
      // 写死会把英文页面也标成 zh-CN。
      // viewport 走 Nuxt 的专用配置项（不是在 meta 里重复声明，避免 SEO 警告）：
      // viewport-fit=cover 让 iOS 的 env(safe-area-inset-*) 生效，抽屉与页脚
      // 才不会被 Home Indicator 压住。
      viewport: 'width=device-width, initial-scale=1, viewport-fit=cover',
      title: 'Nomi Admin',
      meta: [{ name: 'description', content: '基于 Nuxt 4 的企业级中后台模板' }],
      script: [
        // 首帧主题：必须在 <head> 里同步执行，早于任何样式表生效与组件水合。
        // 逻辑与 app/utils/theme.ts 同源，一致性由 test/theme-bootstrap.spec.ts 保证。
        {
          key: 'theme-bootstrap',
          tagPosition: 'head',
          innerHTML: THEME_BOOTSTRAP_SCRIPT,
        },
      ],
    },
  },

  // 生产构建的 JS 压缩沿用 Vite 8 的默认压缩器（oxc）。
  //
  // 关于「生产环境去掉 console」：Vite 8 只提供 build.minify 的开关，不带
  // drop_console 选项（rolldown 的 MinifyOptions 里有 compress.dropConsole，
  // 但 Vite 不会转交，写在 rollupOptions.output.minify 上会被静默忽略）。
  // 想要这一步需要二选一，两者都不是模板该替使用者做的决定：
  //   ① 装 terser，设 build.minify: 'terser' + terserOptions.compress.drop_console；
  //   ② 装 vite 作为直接依赖，在 renderChunk 里调用 minifySync 自己压一遍。
  // 详见 docs/入口文件与构建配置.md「未照搬的项」。
  //
  // 当前的做法是把调试输出限制在开发期：业务日志统一走 app/plugins 里的
  // 错误处理与 bootstrap 插件，并用 import.meta.dev 包裹，生产构建时连分支一起消失。

  // 接真实后端时，把跨域请求收拢到一处（Nuxt 里不需要 vite 的 server.proxy 给
  // 前端兜底，服务端渲染的请求也能走同一条规则）。示例：
  //
  // routeRules: {
  //   '/api-proxy/**': { proxy: `${process.env.API_ORIGIN}/**` },
  // },
});

