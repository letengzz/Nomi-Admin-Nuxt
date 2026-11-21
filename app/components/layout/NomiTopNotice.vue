<script setup lang="ts">
/**
 * 顶部公告条 —— 置顶公告的滚动展示，挂在内容区顶部（原静态节日文案的位置）。
 *
 * 数据来源：notification store 的 topNotices（已发布 + isTop，服务端排过序），
 * 与铃铛共用一份 store；后台常驻轮询负责让新公告及时进来。
 * 交互：
 *   · 单条文字过长时在容器内往返跑马灯（marqueeOffset 算位移，hover 暂停）；
 *   · 多条公告按 CAROUSEL_MS 定时切换，两侧箭头/圆点可手动切换，hover 暂停；
 *   · 关闭按钮把 state 交给父级的 festivalClosed，与原来的静态条一致。
 * 置顶集合变化（新增/删除/取消置顶）时下标越界自动回绕，不会卡在空白。
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { ElTag } from 'element-plus';
import NomiIcon from './NomiIcon.vue';
import { useNotificationStore } from '../../stores/notification';
import { marqueeOffset, nextCarouselIndex } from '../../utils/notice-marquee';

const { t } = useI18n();
const notification = useNotificationStore();

const emit = defineEmits<{ close: [] }>();

/** 多条公告的切换间隔：8s，够读一条短标题。 */
const CAROUSEL_MS = 8000;
const paused = ref(false);
const activeIndex = ref(0);
const notices = computed(() => notification.topNotices);
const total = computed(() => notices.value.length);
const current = computed(() => notices.value[activeIndex.value] ?? null);

const textRef = ref<HTMLElement>();
const viewportRef = ref<HTMLElement>();
const offset = ref(0);

/** 测量当前这条是否溢出，溢出才算位移；切换/数据变化/窗口变化都重测。 */
async function measure(): Promise<void> {
  await nextTick();
  const text = textRef.value;
  const viewport = viewportRef.value;
  if (!text || !viewport) {
    offset.value = 0;
    return;
  }
  offset.value = marqueeOffset(text.scrollWidth, viewport.clientWidth);
}

let timer: ReturnType<typeof setInterval> | undefined;
function start(): void {
  if (timer) return;
  timer = setInterval(() => {
    if (paused.value || total.value <= 1) return;
    activeIndex.value = nextCarouselIndex(activeIndex.value, total.value);
    void measure();
  }, CAROUSEL_MS);
}
function stop(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = undefined;
}

function move(delta: number): void {
  if (total.value <= 1) return;
  activeIndex.value = (activeIndex.value + delta + total.value) % total.value;
  void measure();
}

/** 数据集合变化时修正越界下标并重测。 */
watch(
  () => notices.value.map((item) => item.id).join(','),
  () => {
    if (activeIndex.value >= total.value) activeIndex.value = 0;
    void measure();
  },
);

onMounted(() => {
  void measure();
  start();
  window.addEventListener('resize', onResize);
});
onUnmounted(() => {
  stop();
  window.removeEventListener('resize', onResize);
});

function onResize(): void {
  void measure();
}
</script>

<template>
  <div
    v-if="current"
    class="nomi-top-notice"
    role="status"
    @mouseenter="paused = true"
    @mouseleave="paused = false"
  >
    <NomiIcon name="bell" :size="16" />
    <ElTag size="small" type="danger" effect="plain" class="top-notice-tag">
      {{ t('auth.notice.top') }}
    </ElTag>
    <div ref="viewportRef" class="top-notice-text-viewport">
      <span
        ref="textRef"
        class="top-notice-text"
        :class="{ 'is-scrolling': offset !== 0 && !paused }"
        :style="offset ? { '--marquee-offset': `${offset}px` } : undefined"
        :title="current.title"
      >{{ current.title }}</span>
    </div>
    <div v-if="total > 1" class="top-notice-nav">
      <button type="button" :aria-label="t('layout.topNotice.prev')" @click="move(-1)">
        <NomiIcon name="arrow-left" :size="13" />
      </button>
      <span class="top-notice-count">{{ activeIndex + 1 }}/{{ total }}</span>
      <button type="button" :aria-label="t('layout.topNotice.next')" @click="move(1)">
        <NomiIcon name="arrow-right" :size="13" />
      </button>
    </div>
    <button type="button" class="top-notice-close" :aria-label="t('layout.worktab.close')" @click="emit('close')">
      <NomiIcon name="close" :size="14" />
    </button>
  </div>
</template>

<style scoped>
.nomi-top-notice {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
  padding: 9px 14px;
  color: var(--el-color-primary);
  background: color-mix(in srgb, var(--el-color-primary) 9%, transparent);
  border: 1px solid color-mix(in srgb, var(--el-color-primary) 20%, transparent);
  border-radius: var(--nomi-radius, 12px);
  font-size: 13px;
}

.top-notice-tag {
  flex-shrink: 0;
}

.top-notice-text-viewport {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
}

.top-notice-text {
  display: inline-block;
  white-space: nowrap;
  will-change: transform;
}

.top-notice-text.is-scrolling {
  animation: nomi-top-marquee 10s ease-in-out infinite alternate;
}

.top-notice-nav,
.top-notice-close {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 4px;
}

.top-notice-nav button,
.top-notice-close {
  display: inline-flex;
  padding: 2px;
  color: inherit;
  background: transparent;
  border: 0;
  cursor: pointer;
}

.top-notice-nav button:disabled {
  cursor: default;
  opacity: 0.5;
}

.top-notice-count {
  min-width: 30px;
  color: var(--fg-muted);
  font-size: 12px;
  text-align: center;
}

@keyframes nomi-top-marquee {
  from { transform: translateX(0); }
  to { transform: translateX(var(--marquee-offset, 0)); }
}

@media (prefers-reduced-motion: reduce) {
  .top-notice-text.is-scrolling {
    animation: none;
  }
}
</style>
