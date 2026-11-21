<script setup lang="ts">
/**
 * 混合菜单（top-left 布局）—— 对应文档第 10 章 ArtMixedMenu。
 * 顶部只放一级；点击一级跳到它下面第一个可导航叶子，侧栏随之切成该组的 children
 * （切片逻辑在 useLayoutComputed.sidebarMenuList）。
 */
import { computed, ref } from 'vue';
import NomiIcon from './NomiIcon.vue';
import type { NomiMenuItem } from '../../constants/layout';
import { useLayoutComputed } from '../../composables/useLayout';

defineProps<{ list: readonly NomiMenuItem[] }>();

const { t } = useI18n();
/** 菜单名是词条键时按当前语言显示，否则原样输出。 */
const menuTitle = useMenuTitle();
const { activeTopMenu, firstChildPath } = useLayoutComputed();
const scroller = ref<HTMLElement | null>(null);
const canScroll = computed(() => true);

function scrollBy(delta: number): void {
  scroller.value?.scrollBy({ left: delta, behavior: 'smooth' });
}

async function activate(menu: NomiMenuItem): Promise<void> {
  await navigateTo(firstChildPath(menu));
}
</script>

<template>
  <nav class="nomi-mixed-menu" :aria-label="t('layout.header.menu')">
    <button
      v-if="canScroll"
      type="button"
      class="nomi-mixed-arrow"
      :aria-label="t('layout.header.scrollLeft')"
      @click="scrollBy(-180)"
    >
      <NomiIcon name="chevron-left" :size="16" />
    </button>

    <div ref="scroller" class="nomi-mixed-scroller">
      <button
        v-for="menu in list"
        :key="menu.path"
        type="button"
        class="nomi-mixed-item"
        :class="{ 'is-active': activeTopMenu?.path === menu.path }"
        @click="activate(menu)"
      >
        <NomiIcon :name="menu.icon" :size="17" />
        <span>{{ menuTitle(menu.title) }}</span>
        <span v-if="menu.children?.length" class="nomi-mixed-count">{{ menu.children.length }}</span>
      </button>
    </div>

    <button
      type="button"
      class="nomi-mixed-arrow"
      :aria-label="t('layout.header.scrollRight')"
      @click="scrollBy(180)"
    >
      <NomiIcon name="chevron-right" :size="16" />
    </button>
  </nav>
</template>

<style scoped>
.nomi-mixed-menu {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 2px;
}

.nomi-mixed-scroller {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 2px;
  overflow-x: auto;
  scrollbar-width: none;
}

.nomi-mixed-scroller::-webkit-scrollbar {
  display: none;
}

.nomi-mixed-item {
  display: inline-flex;
  height: 36px;
  flex-shrink: 0;
  align-items: center;
  gap: 7px;
  padding: 0 12px;
  color: var(--fg-muted);
  background: transparent;
  border: 0;
  border-radius: var(--nomi-radius-sm, 8px);
  font-size: 14px;
  white-space: nowrap;
  cursor: pointer;
  transition: color 0.18s var(--ease), background-color 0.18s var(--ease);
}

.nomi-mixed-item:hover,
.nomi-mixed-item.is-active {
  color: var(--el-color-primary);
  background: color-mix(in srgb, var(--el-color-primary) 10%, transparent);
}

.nomi-mixed-count {
  padding: 0 5px;
  color: var(--fg-muted);
  background: var(--bg-inset, var(--bg-subtle));
  border-radius: 6px;
  font-size: 11px;
}

.nomi-mixed-arrow {
  display: inline-flex;
  width: 26px;
  height: 32px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  padding: 0;
  color: var(--fg-muted);
  background: transparent;
  border: 0;
  cursor: pointer;
}

.nomi-mixed-arrow:hover {
  color: var(--el-color-primary);
}

@media (max-width: 1180px) {
  .nomi-mixed-arrow {
    display: none;
  }
}
</style>
