<script setup lang="ts">
/**
 * 面包屑 —— 对应文档第 12.1 节 ArtBreadcrumb。
 * 只在有侧栏的两种布局（left / dual-menu）显示，顶部菜单已经表达路径时就冗余了。
 * 数据来自 useLayoutComputed 的菜单扁平表，不解析 URL 字符串。
 */
import NomiIcon from './NomiIcon.vue';
import { useLayoutComputed } from '../../composables/useLayout';

const { t } = useI18n();
/** 菜单名是词条键时按当前语言显示，否则原样输出。 */
const menuTitle = useMenuTitle();
const { breadcrumbs, homePath } = useLayoutComputed();
</script>

<template>
  <nav class="nomi-breadcrumb" :aria-label="t('layout.breadcrumb.label')">
    <NuxtLink :to="homePath" class="nomi-breadcrumb-home">
      <NomiIcon name="home" :size="15" />
    </NuxtLink>
    <template v-for="(crumb, index) in breadcrumbs" :key="`${crumb.title}-${index}`">
      <NomiIcon name="chevron-right" :size="13" class="nomi-breadcrumb-sep" />
      <span class="nomi-breadcrumb-text" :class="{ 'is-current': index === breadcrumbs.length - 1 }">
        {{ menuTitle(crumb.title) }}
      </span>
    </template>
  </nav>
</template>

<style scoped>
.nomi-breadcrumb {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
  overflow: hidden;
  color: var(--fg-muted);
  font-size: 13px;
  white-space: nowrap;
}

.nomi-breadcrumb-home {
  display: inline-flex;
  align-items: center;
  color: var(--fg-muted);
  text-decoration: none;
}

.nomi-breadcrumb-home:hover {
  color: var(--el-color-primary);
}

.nomi-breadcrumb-sep {
  flex-shrink: 0;
  opacity: 0.5;
}

.nomi-breadcrumb-text {
  overflow: hidden;
  text-overflow: ellipsis;
}

.nomi-breadcrumb-text.is-current {
  color: var(--fg);
  font-weight: 550;
}

@media (max-width: 768px) {
  .nomi-breadcrumb {
    display: none;
  }
}
</style>
