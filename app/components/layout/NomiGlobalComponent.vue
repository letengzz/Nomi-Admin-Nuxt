<script setup lang="ts">
/**
 * 全局层 —— 对应文档第 5 章 ArtGlobalComponent（14 行）。
 *
 * 两个硬理由（第 1.9 节）：
 *  ① #app-main 有 overflow:auto，会创建裁剪上下文；浮层必须挂在没有 overflow
 *     的 #app-global，才能保证 position:fixed 相对视口。
 *  ② 浮层独立于路由生命周期，靠事件总线通信；业务页面切换不影响开关状态。
 *
 * defineAsyncComponent 让这 4 个组件不进首屏 bundle，首次点击才有一次加载间隙。
 */
import { computed, defineAsyncComponent, type Component } from 'vue';
import { HEADER_BAR_CONFIG } from '../../constants/layout';

interface GlobalComponentConfig {
  key: string;
  name: string;
  component: Component;
  enabled: boolean;
}

const globalComponentsConfig: GlobalComponentConfig[] = [
  {
    key: 'settings-panel',
    name: '设置面板',
    component: defineAsyncComponent(() => import('./NomiSettingsPanel.vue')),
    enabled: HEADER_BAR_CONFIG.settings.enabled,
  },
  {
    key: 'global-search',
    name: '全局搜索',
    component: defineAsyncComponent(() => import('./NomiGlobalSearch.vue')),
    enabled: HEADER_BAR_CONFIG.globalSearch.enabled,
  },
  {
    key: 'notification',
    name: '通知抽屉',
    component: defineAsyncComponent(() => import('./NomiNotification.vue')),
    enabled: HEADER_BAR_CONFIG.notification.enabled || HEADER_BAR_CONFIG.chat.enabled,
  },
  {
    key: 'watermark',
    name: '水印',
    component: defineAsyncComponent(() => import('./NomiWatermark.vue')),
    enabled: true,
  },
];

const enabledComponents = computed(() => globalComponentsConfig.filter((item) => item.enabled !== false));
</script>

<template>
  <component
    :is="config.component"
    v-for="config in enabledComponents"
    :key="config.key"
    :data-nomi-global="config.key"
  />
</template>
