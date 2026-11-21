<script setup lang="ts">
/**
 * 版权页脚：系统配置 site 区块的「显示版权声明」开关控制显隐。
 *
 * 后台底部与登录页共用同一份判断，避免两处各写一遍开关逻辑导致不一致。
 * 开关关掉、或版权声明与备案号都为空时整个页脚不渲染，不留一条空白。
 */
import { computed } from 'vue';
import { useSiteStore } from '../../stores/site';

withDefaults(defineProps<{ variant?: 'admin' | 'auth' }>(), { variant: 'admin' });

const site = useSiteStore();

const visible = computed(() => site.copyrightEnabled && Boolean(site.copyright || site.icp));
</script>

<template>
  <footer v-if="visible" class="nomi-site-footer" :class="`nomi-site-footer--${variant}`">
    <span v-if="site.copyright" class="nomi-site-footer__text">{{ site.copyright }}</span>
    <span v-if="site.icp" class="nomi-site-footer__text">{{ site.icp }}</span>
  </footer>
</template>

<style scoped lang="scss">
.nomi-site-footer {
  display: flex;
  gap: 6px 16px;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  color: var(--fg-muted, #64748b);
  font-size: 12px;
  line-height: 1.6;
  text-align: center;
}

.nomi-site-footer__text {
  white-space: nowrap;
}

// 后台：作为主滚动区的最后一块，跟随内容流，不遮挡页面。
.nomi-site-footer--admin {
  flex: none;
  padding: 10px 20px 16px;
}

// 授权页：贴在右栏底部居中，不干扰表单的绝对居中布局。
.nomi-site-footer--auth {
  position: absolute;
  z-index: 2;
  right: 0;
  bottom: 16px;
  left: 0;
  padding: 0 20px;
  pointer-events: none;
}
</style>
