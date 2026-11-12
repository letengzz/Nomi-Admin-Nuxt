<script setup lang="ts">
/**
 * 滑块验证（slide-to-unlock）。
 *
 * 对齐文档第 8 章：v-model:value 上报通过状态、defineExpose({ reset }) 供父组件复位。
 * 改进点：只用一组响应式 offset 驱动进度条与手柄、监听挂在 window 上且随组件卸载清理，
 * 避免原实现「拖出容器就失效 / 监听注册两次 / isOk 状态抖动」的问题。
 *
 * 安全提示：这是纯前端验证，只挡误触，不构成安全边界。生产请改为服务端下发并校验的验证码。
 */
import { computed, ref, watch } from 'vue';
import { useEventListener } from '@vueuse/core';

interface Props {
  value: boolean;
  text?: string;
  successText?: string;
  background?: string;
  progressBarBg?: string;
  completedBg?: string;
  handlerBg?: string;
  height?: number;
}

const props = withDefaults(defineProps<Props>(), {
  text: '按住滑块拖动',
  successText: '验证成功',
  // 轨道底色走令牌（app.vue 里按明暗各给一份），写死浅灰会让暗色下出现一条白条。
  background: 'var(--bg-inset, #F1F1F4)',
  progressBarBg: 'var(--el-color-primary, #5D87FF)',
  completedBg: '#57D187',
  handlerBg: 'var(--bg, #fff)',
  height: 40,
});

const emit = defineEmits<{
  'update:value': [value: boolean];
  passCallback: [];
}>();

const trackRef = ref<HTMLElement | null>(null);
const offset = ref(0);
const passed = ref(false);
const dragging = ref(false);
const rebounding = ref(false);

let startX = 0;
let maxOffset = 0;

// SSR 时 target 为 undefined，VueUse 会跳过注册；客户端水合后接管。
const eventTarget = computed(() => (import.meta.client ? window : undefined));

const trackStyle = computed(() => ({
  height: `${props.height}px`,
  lineHeight: `${props.height}px`,
  background: props.background,
}));

const progressStyle = computed(() => ({
  width: `${offset.value}px`,
  background: passed.value ? props.completedBg : props.progressBarBg,
  transition: rebounding.value ? 'width 0.5s ease' : 'none',
}));

const handlerStyle = computed(() => ({
  left: `${offset.value}px`,
  width: `${props.height}px`,
  height: `${props.height}px`,
  background: props.handlerBg,
  transition: rebounding.value ? 'left 0.5s ease' : 'none',
}));

function clientXOf(event: MouseEvent | TouchEvent): number {
  if ('touches' in event) {
    const touch = event.touches[0] ?? event.changedTouches[0];
    return touch?.clientX ?? 0;
  }
  return event.clientX;
}

function onStart(event: MouseEvent | TouchEvent): void {
  if (passed.value) return;
  const width = trackRef.value?.clientWidth ?? 0;
  maxOffset = Math.max(0, width - props.height);
  startX = clientXOf(event) - offset.value;
  dragging.value = true;
  rebounding.value = false;
}

function onMove(event: Event): void {
  if (!dragging.value) return;
  const next = clientXOf(event as MouseEvent | TouchEvent) - startX;
  offset.value = Math.min(maxOffset, Math.max(0, next));
}

function onEnd(): void {
  if (!dragging.value) return;
  dragging.value = false;
  if (maxOffset > 0 && offset.value >= maxOffset - 2) {
    offset.value = maxOffset;
    passed.value = true;
    emit('update:value', true);
    emit('passCallback');
  } else {
    rebounding.value = true;
    offset.value = 0;
    window.setTimeout(() => {
      rebounding.value = false;
    }, 500);
  }
}

function resetState(): void {
  dragging.value = false;
  rebounding.value = false;
  offset.value = 0;
  passed.value = false;
}

function reset(): void {
  resetState();
  emit('update:value', false);
}

defineExpose({ reset });

watch(
  () => props.value,
  (value) => {
    if (!value && passed.value) resetState();
  },
);

// 挂在 window 上：拖出轨道也不会中断；组件卸载时 VueUse 自动反注册。
useEventListener(eventTarget, 'mousemove', onMove);
useEventListener(eventTarget, 'mouseup', onEnd);
useEventListener(eventTarget, 'touchmove', onMove, { passive: true });
useEventListener(eventTarget, 'touchend', onEnd);
</script>

<template>
  <div
    ref="trackRef"
    class="dv-track"
    :class="{ 'is-passed': passed }"
    :style="trackStyle"
    @touchmove.prevent
  >
    <div class="dv-progress" :style="progressStyle" />
    <div class="dv-text">{{ passed ? props.successText : props.text }}</div>
    <div
      class="dv-handler"
      :style="handlerStyle"
      @mousedown.prevent="onStart"
      @touchstart.prevent="onStart"
    >
      <svg v-if="!passed" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path
          d="M5 12h11M5 12l3-3M5 12l3 3M12 12h7M12 12l3-3M12 12l3 3"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <svg v-else viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path
          d="M5 12.5l4.5 4.5L19 7.5"
          fill="none"
          stroke="#57D187"
          stroke-width="2.4"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </div>
  </div>
</template>

<style scoped>
.dv-track {
  /* 这两个变量必须留在样式表里，不能塞进 :style：
     Vue 水合阶段一旦发现 style 里有自定义属性（--x），会整体跳过该元素 style 的
     比对，服务端渲染出来的旧值就再也不会被客户端纠正 —— 症状是首帧滑块轨道
     一直是 SSR 时的亮灰，切换主题也不动（要等下一次无关的 re-render 才恢复）。 */
  --dv-text-color: var(--fg-muted, #7987a1);
  /* 扫光高光取轨道底色：写死 #fff 时，暗色下白光照在深色轨道上像故障，
     亮色下白光撞上浅灰轨道则直接把文字「吃掉」。 */
  --dv-bg: var(--bg-inset, #f1f1f4);

  position: relative;
  width: 100%;
  overflow: hidden;
  border-radius: 8px;
  user-select: none;
}

.dv-progress {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  border-radius: 8px 0 0 8px;
}

.dv-text {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  pointer-events: none;
  background: linear-gradient(
    90deg,
    var(--dv-text-color) 0%,
    var(--dv-text-color) 35%,
    var(--dv-bg, #f1f1f4) 50%,
    var(--dv-text-color) 65%,
    var(--dv-text-color) 100%
  );
  background-size: 200% 100%;
  background-clip: text;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: slidetounlock 2s cubic-bezier(0, 0.2, 1, 1) infinite;
}

.dv-track.is-passed .dv-text {
  color: #fff;
  background: none;
  -webkit-text-fill-color: #fff;
  animation: none;
}

.dv-handler {
  position: absolute;
  top: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--fg-muted, #7987a1);
  /* 手柄底色与轨道太接近（白/白、深/深），加一圈随明暗变化的描边让它"浮"出来 */
  border: 1px solid color-mix(in srgb, var(--fg, #0f172a) 22%, transparent);
  border-radius: 8px;
  box-shadow: 0 1px 4px rgb(0 0 0 / 15%);
  cursor: grab;
  touch-action: none;
}

.dv-handler:active {
  cursor: grabbing;
}

@keyframes slidetounlock {
  from {
    background-position: 100% 0;
  }

  to {
    background-position: -100% 0;
  }
}
</style>
