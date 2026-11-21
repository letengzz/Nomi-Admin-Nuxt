<script setup lang="ts">
/**
 * 内容区 —— 对应文档第 13 章 ArtPageContent（136 行），是第二个 RouterView 的位置。
 *
 * Nuxt 没有「在布局里再放一个 RouterView」这回事：页面组件由 NuxtPage 通过
 * layout 的 <slot /> 传进来。因此这里保留文档的四项能力，但换用 Nuxt 的等价物：
 *   · 页面过渡 → 这里用 <Transition :key="route.fullPath"> 包住 slot 容器。
 *     不挂 NuxtPage 的 transition prop：SPA + Suspense 下它经常不触发，
 *     设置面板选了动画却看不到任何效果。名字来自 layout.state.pageTransition。
 *   · KeepAlive → definePageMeta({ keepalive })，交给 NuxtPage 自己处理
 *   · 刷新 → v-if="isRefresh" 重建 slot 子树（nextTick 之后才置回 true）
 *   · 全屏页 → route meta isFullPage，用 fixed 浮层盖住布局而不是移除布局 DOM
 *   · 最小高度 → useLayoutHeight()，保证短页面也铺满背景
 */
import { computed, nextTick, onUnmounted, ref, shallowRef, watch } from 'vue';
import type { CSSProperties } from 'vue';
import NomiPageLoading from './NomiPageLoading.vue';
import NomiTopNotice from './NomiTopNotice.vue';
import { useLayoutHeight } from '../../composables/useLayout';
import { useLayoutStore } from '../../stores/layout';

const route = useRoute();
const layout = useLayoutStore();
const { containerMinHeight } = useLayoutHeight();

const isRefresh = shallowRef(true);
const showTransitionMask = ref(false);
/** 顶部公告关闭状态：与原来的静态条一致，关掉后本次会话不再显示。 */
const topNoticeClosed = ref(false);
let maskTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * 过渡名字与 layout.scss 的 .nomi-{name}-* 类一一对应；key 用完整路径，
 * 同一个页面带不同 query（比如详情页换 id）也能有切换动画。
 * 刷新时 key 不变，只重建内部 slot，不会额外播一次进出场。
 */
const transitionName = computed(() => `nomi-${layout.state.pageTransition}`);
const pageKey = computed(() => route.fullPath);

const isFullPage = computed(() =>
  route.matched.some((record) => record.meta?.isFullPage === true) || route.meta.isFullPage === true,
);

/**
 * 定高页（列表类页面）：内容区高度锁在一屏内，页面本身不产生纵向滚动，
 * 滚动交给表格内部。开启后不再给 .nomi-page-view 兜底 min-height —— 那个
 * min-height 是「短页面也要铺满背景」用的，而定高页要的是确切高度而非下限。
 */
const isFillPage = computed(() =>
  route.matched.some((record) => record.meta?.pageFill === true) || route.meta.pageFill === true,
);

// 顶部公告沿用「顶部公告」显示开关；无置顶公告时组件自身不渲染，不留空白条。
const showTopNotice = computed(() => layout.state.showFestivalText && !topNoticeClosed.value && !isFullPage.value);

const containerStyle = computed<CSSProperties>(() =>
  isFullPage.value
    ? {
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100dvh',
        zIndex: 2500,
        maxWidth: 'none',
        background: 'var(--bg)',
      }
    : { maxWidth: layout.state.containerWidth },
);

const contentStyle = computed<CSSProperties>(() =>
  isFillPage.value ? {} : { minHeight: containerMinHeight.value },
);

// 第 13.2 节 L87 的 setTimeout 没有保存句柄，卸载后会写已销毁的 ref（第 20.5 节修复）。
watch(isFullPage, (value, previous) => {
  if (value === previous) return;
  showTransitionMask.value = true;
  if (maskTimer) clearTimeout(maskTimer);
  maskTimer = setTimeout(() => {
    showTransitionMask.value = false;
  }, 60);
});

function reload(): void {
  isRefresh.value = false;
  void nextTick(() => {
    isRefresh.value = true;
  });
}

watch(() => layout.refresh, reload, { flush: 'post' });
onUnmounted(() => {
  if (maskTimer) clearTimeout(maskTimer);
});
</script>

<template>
  <div class="layout-content" :class="{ 'is-full-page': isFullPage, 'is-fill': isFillPage }" :style="containerStyle">
    <div id="app-content-header">
      <NomiTopNotice v-if="showTopNotice" @close="topNoticeClosed = true" />
    </div>

    <Transition :name="transitionName" mode="out-in">
      <div :key="pageKey" class="nomi-page-view" :style="contentStyle">
        <template v-if="isRefresh">
          <slot />
          <!-- 路由切换时 slot 可能短暂为空，遮罩挂在页面视图里、始终居中 -->
          <NomiPageLoading />
        </template>
      </div>
    </Transition>

    <Teleport to="body">
      <div v-show="showTransitionMask" class="nomi-transition-mask" />
    </Teleport>
  </div>
</template>

<style scoped>
.layout-content {
  box-sizing: border-box;
  width: calc(100% - 40px);
  margin: 0 auto;
  padding: 18px 0 24px;
}

.layout-content.is-full-page {
  width: 100%;
  padding: 0;
  overflow: auto;
}

.nomi-page-view {
  position: relative;
  min-width: 0;
}

.nomi-transition-mask {
  position: fixed;
  z-index: 2600;
  inset: 0;
  background: var(--bg);
  pointer-events: none;
}

@media (max-width: 640px) {
  .layout-content {
    width: calc(100% - 24px);
    padding-top: 12px;
    padding-bottom: calc(24px + var(--nomi-safe-bottom, 0px));
  }
}
</style>
