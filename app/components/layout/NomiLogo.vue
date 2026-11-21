<script setup lang="ts">
/**
 * 品牌标识：全站（后台侧栏、顶栏、三张授权页）共用同一枚标记。
 *
 * 图形和名称都来自系统配置：上传过 LOGO 就显示图片，否则退回内置 N 形；
 * 名称读 site.name，语言管理里的 app.title 已废弃。
 */
const site = useSiteStore();

withDefaults(
  defineProps<{
    size?: number;
    showText?: boolean;
  }>(),
  { size: 34, showText: false },
);
</script>

<template>
  <div class="nomi-logo" :class="{ 'nomi-logo--text': showText }">
    <img
      v-if="site.logo"
      class="nomi-logo__image"
      :src="site.logo"
      :style="{ width: `${size}px`, height: `${size}px` }"
      alt=""
    />
    <svg v-else :width="size" :height="size" viewBox="0 0 46 46" aria-hidden="true">
      <rect x="2" y="2" width="42" height="42" rx="13" fill="var(--el-color-primary, #5d87ff)" />
      <path
        d="M14 32V14l18 18V14"
        fill="none"
        stroke="#fff"
        stroke-width="4"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
    <span v-if="showText" class="nomi-logo__text">{{ site.name }}</span>
  </div>
</template>

<style scoped>
.nomi-logo {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 10px;
}

.nomi-logo__image {
  display: block;
  flex-shrink: 0;
  border-radius: 8px;
  object-fit: contain;
}

.nomi-logo__text {
  overflow: hidden;
  font-size: 17px;
  font-weight: 650;
  letter-spacing: -0.01em;
  white-space: nowrap;
}
</style>
