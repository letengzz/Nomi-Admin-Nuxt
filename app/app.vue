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
import { computed } from 'vue';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import en from 'element-plus/es/locale/lang/en';

const { locale } = useI18n();

// i18n 是语言状态的唯一来源，Element Plus 只是跟随它，不另存一份语言设置。
const elLocale = computed(() => (locale.value === 'en' ? en : zhCn));
</script>

<template>
  <ElConfigProvider :locale="elLocale" :z-index="3000">
    <NuxtRouteAnnouncer />
    <NuxtPage />
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
  --el-fill-color: #1f2937;
  --el-mask-color: rgb(0 0 0 / 70%);
}
</style>
