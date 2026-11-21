<script setup lang="ts">
/**
 * 顶栏统一图标按钮 —— 对应文档第 12.2 节 ArtIconButton（23 行）。
 *
 * 只做三件事：图标、tooltip、旋转动效。是否显示由 useHeaderBar() 的
 * 三级开关决定，按钮本身不碰 store。base.css 给 button 写了全局兜底样式，
 * 这里必须显式清掉 border/background，否则会套成带边框的方块。
 *
 * spinOnHover 的图标（刷新 / 设置）：悬浮与点击都转满一圈 360°。
 * 悬浮用 transition，点击用一次性 keyframes —— 两者必须分开，否则连续点
 * 第二次时元素还停在终态，不会再触发 transition。
 */
import { onUnmounted, ref } from 'vue';
import { ElTooltip } from 'element-plus';
import NomiIcon from './NomiIcon.vue';

/**
 * 必须显式声明 click：根元素是 ElTooltip（组件），不声明时父组件的 @click
 * 只是个 fallthrough 属性，会在这条组件链上被丢掉 —— 症状是「按钮看得见、
 * 点下去毫无反应」。声明 emits 后监听器变成组件事件，由内部 button 触发。
 */
const emit = defineEmits<{ click: [event: MouseEvent] }>();

const props = withDefaults(
  defineProps<{
    icon: string;
    label?: string;
    size?: number;
    active?: boolean;
    dot?: boolean;
    spinOnHover?: boolean;
    /** 下拉展开时隐藏 tooltip，避免气泡盖住菜单项挡住点击。 */
    tooltipDisabled?: boolean;
  }>(),
  { label: '', size: 19, active: false, dot: false, spinOnHover: false, tooltipDisabled: false },
);

const spinning = ref(false);
let spinTimer: ReturnType<typeof setTimeout> | undefined;

function handleClick(event: MouseEvent): void {
  if (props.spinOnHover) {
    // 先把 class 摘掉交给 Vue 提交，再在下一轮挂上：连点也能每次重播动画。
    spinning.value = false;
    if (spinTimer) clearTimeout(spinTimer);
    spinTimer = setTimeout(() => {
      spinning.value = true;
    }, 0);
  }
  emit('click', event);
}

function onSpinEnd(): void {
  spinning.value = false;
}

onUnmounted(() => {
  if (spinTimer) clearTimeout(spinTimer);
});
</script>

<template>
  <ElTooltip :content="label" :disabled="!label || tooltipDisabled" placement="bottom" :show-after="400">
    <button
      type="button"
      class="nomi-icon-btn"
      :class="{ 'is-active': active, 'spin-on-hover': spinOnHover, 'is-spinning': spinning }"
      :aria-label="label"
      @click="handleClick"
      @animationend="onSpinEnd"
    >
      <NomiIcon :name="icon" :size="size" />
      <span v-if="dot" class="nomi-icon-btn__dot" />
      <slot />
    </button>
  </ElTooltip>
</template>

<style scoped>
.nomi-icon-btn {
  /* 语言图标的三种状态由这两个变量下发；其他图标不读取，零影响。 */
  --nomi-lang-secondary-opacity: 0.8;
  --nomi-lang-marker-opacity: 0;

  position: relative;
  display: inline-flex;
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  padding: 0;
  color: var(--fg-muted);
  background: transparent;
  border: 0;
  border-radius: var(--nomi-radius-sm, 8px);
  cursor: pointer;
  transition: color 0.18s var(--ease), background-color 0.18s var(--ease), transform 0.18s var(--ease);
}

.nomi-icon-btn:hover,
.nomi-icon-btn.is-active {
  --nomi-lang-secondary-opacity: 1;

  color: var(--el-color-primary);
  background: color-mix(in srgb, var(--el-color-primary) 10%, transparent);
}

/* 下拉展开态：在 hover 之上加一圈内描边并亮起指示点，与 hover 明确区分。
   inset 阴影不占布局空间，34×34 按钮尺寸保持不变。 */
.nomi-icon-btn.is-active {
  --nomi-lang-marker-opacity: 1;

  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--el-color-primary) 30%, transparent);
}

/* 悬浮：转满一整圈回到原位（360° 与 0° 视觉同相，移开时不会倒着转半圈）。 */
.nomi-icon-btn.spin-on-hover:hover :deep(svg) {
  transform: rotate(360deg);
  transition: transform 0.6s var(--ease);
}

/* 点击：一次性 keyframes，animationend 后自动摘掉 class，可连续重播。 */
.nomi-icon-btn.is-spinning :deep(svg) {
  animation: nomi-icon-spin-360 0.6s var(--ease);
}

@keyframes nomi-icon-spin-360 {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .nomi-icon-btn.spin-on-hover :deep(svg),
  .nomi-icon-btn.is-spinning :deep(svg) {
    animation: none;
    transform: none;
    transition: none;
  }
}

.nomi-icon-btn__dot {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 6px;
  height: 6px;
  background: var(--danger, #dc2626);
  border-radius: 50%;
  box-shadow: 0 0 0 2px var(--bg);
}

/* 触屏上把 34px 放大到 38px，配合 -tap-highlight 去掉灰色点击块。 */
@media (max-width: 800px) {
  .nomi-icon-btn {
    width: 38px;
    height: 38px;
    -webkit-tap-highlight-color: transparent;
  }
}
</style>
