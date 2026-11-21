<script setup lang="ts">
/**
 * 左侧品牌区：纯视觉组件，无表单、无请求。
 * 插画直接用内联 SVG + CSS 变量（替代文档里的 fetch SVG / v-html 换色方案），
 * 因此换主色、切明暗时插画自动跟随，且不存在 v-html 的注入面。
 */
import NomiLogo from '../layout/NomiLogo.vue';
import { useSiteStore } from '../../stores/site';

const { t } = useI18n();
const site = useSiteStore();
</script>

<template>
  <aside class="brand">
    <div class="brand-logo">
      <!-- ArtLogo → NomiLogo：三张授权页与后台顶栏共用同一枚品牌标记。 -->
      <NomiLogo :size="46" />
      <span class="brand-logo-text">{{ site.name }}</span>
    </div>

    <div class="brand-art">
      <svg viewBox="0 0 400 300" role="img" :aria-label="t('login.leftView.title')">
        <ellipse cx="200" cy="268" rx="140" ry="12" fill="var(--el-color-primary-light-8, #e8efff)" opacity="0.55" />
        <rect
          x="42"
          y="42"
          width="316"
          height="206"
          rx="16"
          fill="var(--bg, #fff)"
          stroke="var(--el-color-primary-light-7, #d8e4ff)"
          stroke-width="2"
        />
        <path d="M58 42h284a16 16 0 0 1 16 16v22H42V58a16 16 0 0 1 16-16z" fill="var(--el-color-primary, #5d87ff)" />
        <circle cx="64" cy="61" r="4" fill="#fff" opacity="0.85" />
        <circle cx="80" cy="61" r="4" fill="#fff" opacity="0.6" />
        <circle cx="96" cy="61" r="4" fill="#fff" opacity="0.4" />
        <rect x="58" y="96" width="62" height="136" rx="8" fill="var(--el-color-primary-light-9, #f0f5ff)" />
        <rect x="68" y="106" width="42" height="10" rx="5" fill="var(--el-color-primary-light-5, #aebfff)" />
        <rect x="68" y="126" width="30" height="8" rx="4" fill="var(--el-color-primary-light-7, #d8e4ff)" />
        <rect x="68" y="144" width="38" height="8" rx="4" fill="var(--el-color-primary-light-7, #d8e4ff)" />
        <rect x="68" y="162" width="26" height="8" rx="4" fill="var(--el-color-primary-light-7, #d8e4ff)" />
        <rect x="134" y="96" width="92" height="58" rx="10" fill="var(--el-color-primary-light-8, #e8efff)" />
        <rect x="238" y="96" width="104" height="58" rx="10" fill="var(--el-color-primary-light-9, #f0f5ff)" />
        <circle cx="158" cy="117" r="9" fill="var(--el-color-primary-light-3, #b5c8ff)" />
        <rect x="174" y="110" width="38" height="7" rx="3.5" fill="var(--el-color-primary-light-5, #aebfff)" />
        <rect x="174" y="124" width="26" height="6" rx="3" fill="var(--el-color-primary-light-6, #c8d5ff)" />
        <rect x="146" y="134" width="68" height="6" rx="3" fill="var(--el-color-primary-light-6, #c8d5ff)" />
        <rect x="252" y="110" width="76" height="7" rx="3.5" fill="var(--el-color-primary-light-5, #aebfff)" />
        <rect x="252" y="126" width="52" height="6" rx="3" fill="var(--el-color-primary-light-6, #c8d5ff)" />
        <rect x="134" y="168" width="208" height="64" rx="10" fill="var(--bg, #fff)" stroke="var(--el-color-primary-light-8, #e8efff)" stroke-width="2" />
        <path
          d="M146 216l28-18 26 12 30-28 26 14 34-34 48 18"
          fill="none"
          stroke="var(--el-color-primary, #5d87ff)"
          stroke-width="3.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <circle cx="290" cy="158" r="6" fill="var(--el-color-primary-light-3, #b5c8ff)" />
        <circle cx="324" cy="214" r="24" fill="var(--el-color-primary-light-5, #aebfff)" opacity="0.55" />
        <circle cx="62" cy="256" r="10" fill="var(--el-color-primary-light-6, #c8d5ff)" />
      </svg>
    </div>

    <div class="brand-copy">
      <h2>{{ t('login.leftView.title') }}</h2>
      <p>{{ t('login.leftView.subTitle') }}</p>
    </div>

    <!-- 纯 CSS 装饰，颜色全部走主色变量，随换肤 / 明暗自动变化 -->
    <div class="geo circle-outline fade-in-up" style="animation-delay: 0.2s" />
    <div class="geo square-rotated fade-in-left" style="animation-delay: 0.3s" />
    <div class="geo circle-small fade-in-up" style="animation-delay: 0.5s" />
    <div class="geo square-top-right fade-in-right" style="animation-delay: 0.4s" />
    <div class="geo bg-bubble scale-in" style="animation-delay: 0s" />
    <div class="geo dot dot-top-left bounce-in" style="animation-delay: 0.2s" />
    <div class="geo dot dot-top-right bounce-in" style="animation-delay: 0.35s" />
    <div class="geo dot dot-center-right bounce-in" style="animation-delay: 0.5s" />
    <div class="squares-group">
      <i class="geo square-blue fade-in-left" style="animation-delay: 0.2s" />
      <i class="geo square-pink fade-in-left" style="animation-delay: 0.4s" />
      <i class="geo square-purple fade-in-left" style="animation-delay: 0.6s" />
      <i class="geo square-line line-grow" style="animation-delay: 1.2s" />
    </div>
  </aside>
</template>

<style scoped>
.brand {
  position: relative;
  flex: none;
  width: 65vw;
  height: 100vh;
  overflow: hidden;
  background: color-mix(in srgb, var(--el-color-primary-light-9, #f0f5ff) 92%, var(--bg, #fff));
}

.brand-logo {
  position: absolute;
  z-index: 100;
  top: 46px;
  left: 60px;
  display: flex;
  gap: 12px;
  align-items: center;
}

.brand-logo-text {
  font-size: 20px;
  font-weight: 600;
  color: var(--fg, #0f172a);
  letter-spacing: 0.02em;
}

.brand-art {
  position: absolute;
  z-index: 10;
  top: 44%;
  left: 50%;
  width: 40%;
  min-width: 300px;
  transform: translate(-50%, -50%);
  animation: artslideinleft 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) both;
}

.brand-art svg {
  width: 100%;
  height: auto;
}

.brand-copy {
  position: absolute;
  right: 0;
  bottom: 80px;
  left: 0;
  text-align: center;
  animation: slideinleft 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.15s both;
}

.brand-copy h2 {
  margin: 0 0 10px;
  font-size: 24px;
  font-weight: 400;
  color: var(--fg, #0f172a);
}

.brand-copy p {
  margin: 0;
  font-size: 14px;
  color: var(--fg-muted, #64748b);
}

.geo {
  position: absolute;
  display: block;
  padding: 0;
  border: 0;
  pointer-events: none;
}

.circle-outline {
  top: 26%;
  left: 12%;
  width: 42px;
  height: 42px;
  border: 2px solid var(--el-color-primary-light-5, #aebfff);
  border-radius: 50%;
}

.square-rotated {
  right: 14%;
  bottom: 22%;
  width: 60px;
  height: 60px;
  background: color-mix(in srgb, var(--el-color-primary, #5d87ff) 18%, transparent);
  border-radius: 10px;
  transform: rotate(24deg);
}

.circle-small {
  top: 32%;
  right: 10%;
  width: 18px;
  height: 18px;
  background: var(--el-color-primary-light-3, #b5c8ff);
  border-radius: 50%;
}

/* 原来在右下角（right 26% / bottom 12%），正好压在居中的主标语上，
 * 挪到右上角（原主题球的位置，主题球已移除，明暗切换统一走右上工具条）。 */
.square-top-right {
  top: 15%;
  right: 5%;
  width: 50px;
  height: 50px;
  background: color-mix(in srgb, var(--el-color-primary-light-5, #aebfff) 45%, transparent);
  border-radius: 12px;
  transform: rotate(-18deg);
}

.bg-bubble {
  top: -140px;
  right: -120px;
  width: 360px;
  height: 360px;
  background: color-mix(in srgb, var(--el-color-primary-light-7, #d8e4ff) 45%, transparent);
  border-radius: 50%;
}

.dot {
  width: 14px;
  height: 14px;
  background: var(--el-color-primary-light-5, #aebfff);
  border-radius: 50%;
}

.dot-top-left {
  top: 18%;
  left: 26%;
}

.dot-top-right {
  top: 20%;
  right: 24%;
}

.dot-center-right {
  top: 58%;
  right: 8%;
  background: var(--el-color-primary-light-7, #d8e4ff);
}

.squares-group {
  position: absolute;
  bottom: 15%;
  left: 8%;
  width: 140px;
  height: 120px;
}

.squares-group > i {
  display: block;
  border-radius: 8px;
}

.square-blue {
  position: absolute;
  z-index: 2;
  top: 10px;
  left: 12px;
  width: 50px;
  height: 50px;
  background: color-mix(in srgb, var(--el-color-primary, #5d87ff) 45%, transparent);
}

.square-pink {
  position: absolute;
  z-index: 1;
  top: 42px;
  left: 40px;
  width: 70px;
  height: 70px;
  background: color-mix(in srgb, #ff80c8 38%, transparent);
}

.square-purple {
  position: absolute;
  z-index: 3;
  top: 58px;
  left: 4px;
  width: 32px;
  height: 32px;
  background: color-mix(in srgb, #b48df3 60%, transparent);
}

.square-line {
  position: absolute;
  bottom: 6px;
  left: 0;
  width: 0;
  height: 2px;
  background: var(--el-color-primary-light-5, #aebfff);
}

/* 暗色：直接写 `html.dark .brand`（scoped 会自动给 .brand 补 [data-v]）。
 * ⚠️ 不要写成 `:global(html.dark) .brand` —— :global() 只能包住整个选择器，
 * 写一半会被编译成 `html.dark { ... }`，把暗色背景/尺寸直接糊到 <html> 上，
 * 曾经导致切夜间模式后整个页面塌缩成 48×48 的黑块。 */
html.dark .brand {
  background: color-mix(in srgb, var(--el-color-primary, #5d87ff) 14%, var(--bg-subtle, #111827));
}

.fade-in-up {
  animation: fadeinup 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94) both;
}

.fade-in-left {
  animation: fadeinleft 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94) both;
}

.fade-in-right {
  animation: fadeinright 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94) both;
}

.scale-in {
  animation: scalein 1.2s cubic-bezier(0.25, 0.46, 0.45, 0.94) both;
}

.bounce-in {
  animation: bouncein 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) both;
}

.line-grow {
  animation: linegrow 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94) both;
}

@keyframes artslideinleft {
  from {
    opacity: 0;
    transform: translate(calc(-50% - 30px), -50%);
  }

  to {
    opacity: 1;
    transform: translate(-50%, -50%);
  }
}

@keyframes slideinleft {
  from {
    opacity: 0;
    transform: translateX(-30px);
  }

  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@keyframes fadeinup {
  from {
    opacity: 0;
    transform: translateY(30px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes fadeinleft {
  from {
    opacity: 0;
    transform: translateX(-30px);
  }

  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@keyframes fadeinright {
  from {
    opacity: 0;
    transform: translateX(30px) rotate(-18deg);
  }

  to {
    opacity: 1;
    transform: translateX(0) rotate(-18deg);
  }
}

@keyframes scalein {
  from {
    opacity: 0;
    transform: scale(0.6);
  }

  to {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes bouncein {
  from {
    opacity: 0;
    transform: scale(0.3);
  }

  70% {
    transform: scale(1.15);
  }

  to {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes linegrow {
  from {
    width: 0;
  }

  to {
    width: 120px;
  }
}

@media (max-width: 1600px) {
  .brand {
    width: 60vw;
  }

  .brand-copy {
    bottom: 40px;
  }
}

@media (max-width: 1180px) {
  .brand {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .brand * {
    animation: none;
  }
}
</style>
