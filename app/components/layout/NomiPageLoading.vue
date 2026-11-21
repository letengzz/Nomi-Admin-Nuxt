<script setup lang="ts">
/**
 * 页面级加载遮罩。
 *
 * 路由切换 / 异步页面组件挂载时，内容区会先变成一片空白再出现内容 ——
 * 这段「空白页」如果没有反馈，看起来就像卡死。这里在内容区正中放一枚
 * 旋转指示器，把空白变成明确的「正在加载」。
 *
 * 状态直接取 Nuxt 的 `useLoadingIndicator()`：它订阅 `page:loading:start/end`，
 * 自带 200ms 延迟显示和 500ms 延迟隐藏，快到看不出来的导航不会闪一下。
 */
import NomiSpinner from './NomiSpinner.vue';

const { t } = useI18n();
const { isLoading } = useLoadingIndicator();
</script>

<template>
  <Transition name="nomi-loading-fade">
    <div v-if="isLoading" class="nomi-page-loading" aria-live="polite">
      <NomiSpinner :size="72" :label="t('app.loading')" />
    </div>
  </Transition>
</template>

<style scoped>
.nomi-page-loading {
  position: absolute;
  z-index: 30;
  inset: 0;
  display: grid;
  min-height: 60vh;
  place-items: center;
  background: color-mix(in srgb, var(--bg) 70%, transparent);
  backdrop-filter: blur(2px);
  border-radius: calc(var(--nomi-radius, 12px) / 2 + 2px);
}

.nomi-loading-fade-enter-active,
.nomi-loading-fade-leave-active {
  transition: opacity 0.2s var(--ease, ease);
}

.nomi-loading-fade-enter-from,
.nomi-loading-fade-leave-to {
  opacity: 0;
}
</style>
