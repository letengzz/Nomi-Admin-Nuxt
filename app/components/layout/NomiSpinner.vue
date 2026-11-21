<script setup lang="ts">
/**
 * 品牌加载指示器：双环反向旋转 + 渐变弧 + 呼吸光点。
 *
 * 用 SVG 而不是一张 GIF/图标，是为了在明暗主题下都能靠 CSS 变量取色，
 * 且缩小到 16px 也不糊。`useId()` 保证同页多个实例的渐变 defs 不撞 id。
 *
 * 取色**只用 `--el-color-primary` 及其派生色**（light-3 / dark-2），一个写死的
 * 色号都没有：用户换主题色、切暗色，这里自动跟着变。早先弧尾混了一个紫色
 * `#8b5cf6`，蓝色主题下会转出一段紫 —— 和系统风格对不上的来源就是它。
 *
 * SPA 启动占位页（app/spa-loading-template.html）是这套几何的静态复刻：
 * 同一个 viewBox、同样的 stroke-dasharray 与缓动时长。改这里的比例/节奏时，
 * 那个文件要一起改，否则「白屏转圈」和「页面转圈」会像两个产品。
 */
import { useId } from 'vue';

withDefaults(
  defineProps<{
    /** 边长（px） */
    size?: number;
    /** 下方文案，留空则不渲染 */
    label?: string;
  }>(),
  { size: 64, label: '' },
);

const gradientId = `nomi-spinner-gradient-${useId()}`;
</script>

<template>
  <div class="nomi-spinner" role="status" :aria-label="label || 'loading'">
    <svg
      class="nomi-spinner__svg"
      :width="size"
      :height="size"
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient :id="gradientId" x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="var(--el-color-primary)" stop-opacity="0.08" />
          <stop offset="45%" stop-color="var(--el-color-primary)" />
          <stop
            offset="100%"
            stop-color="var(--el-color-primary-light-3, var(--el-color-primary))"
          />
        </linearGradient>
      </defs>
      <!-- 静态轨道：给旋转弧一个可感知的完整圆 -->
      <circle
        cx="32"
        cy="32"
        r="26"
        stroke="var(--el-color-primary)"
        stroke-opacity="0.12"
        stroke-width="3"
      />
      <circle
        class="nomi-spinner__outer"
        cx="32"
        cy="32"
        r="26"
        :stroke="`url(#${gradientId})`"
        stroke-width="4"
        stroke-linecap="round"
        stroke-dasharray="104 60"
      />
      <circle
        class="nomi-spinner__inner"
        cx="32"
        cy="32"
        r="16"
        stroke="var(--el-color-primary)"
        stroke-opacity="0.45"
        stroke-width="2.5"
        stroke-linecap="round"
        stroke-dasharray="34 68"
      />
      <circle class="nomi-spinner__core" cx="32" cy="32" r="3.5" fill="var(--el-color-primary)" />
    </svg>
    <span v-if="label" class="nomi-spinner__label">{{ label }}</span>
  </div>
</template>

<style scoped>
.nomi-spinner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}

.nomi-spinner__svg {
  overflow: visible;
  filter: drop-shadow(0 2px 8px color-mix(in srgb, var(--el-color-primary) 22%, transparent));
}

.nomi-spinner__outer,
.nomi-spinner__inner,
.nomi-spinner__core {
  transform-origin: 32px 32px;
}

.nomi-spinner__outer {
  animation: nomi-spinner-spin 1.05s cubic-bezier(0.5, 0.1, 0.5, 0.9) infinite;
}

.nomi-spinner__inner {
  animation: nomi-spinner-spin-reverse 1.5s linear infinite;
}

.nomi-spinner__core {
  animation: nomi-spinner-pulse 1.4s ease-in-out infinite;
}

.nomi-spinner__label {
  color: var(--fg-muted, var(--el-text-color-secondary));
  font-size: 13px;
  letter-spacing: 0.04em;
}

@keyframes nomi-spinner-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes nomi-spinner-spin-reverse {
  to {
    transform: rotate(-360deg);
  }
}

@keyframes nomi-spinner-pulse {
  0%,
  100% {
    opacity: 0.35;
    transform: scale(0.75);
  }

  50% {
    opacity: 1;
    transform: scale(1.15);
  }
}

@media (prefers-reduced-motion: reduce) {
  .nomi-spinner__outer,
  .nomi-spinner__inner,
  .nomi-spinner__core {
    animation-duration: 3s;
  }
}
</style>
