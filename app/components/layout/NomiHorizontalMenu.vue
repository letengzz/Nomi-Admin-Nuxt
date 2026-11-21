<script setup lang="ts">
/**
 * 顶部水平菜单（top 布局）—— 对应文档第 9 章 ArtHorizontalMenu + HorizontalSubmenu。
 * 一级直接跳，带子项的用 ElDropdown 在 hover 时展开二级；子项统一由 go() 导航。
 */
import { computed } from 'vue';
import { ElDropdown, ElDropdownItem, ElDropdownMenu } from 'element-plus';
import NomiIcon from './NomiIcon.vue';
import type { NomiMenuItem } from '../../constants/layout';
import { normalizeMenuPath } from '../../utils/path';

defineProps<{ list: readonly NomiMenuItem[] }>();

const { t } = useI18n();
/** 菜单名是词条键时按当前语言显示，否则原样输出。 */
const menuTitle = useMenuTitle();
const route = useRoute();
/** 同侧栏：/en 前缀不参与菜单路径比对，否则切语言后整排菜单都不高亮。 */
const menuPath = computed(() => normalizeMenuPath(route.path));

async function go(path: string): Promise<void> {
  if (path.startsWith('#')) return;
  await navigateTo(path);
}

function isActive(menu: NomiMenuItem): boolean {
  if (menu.path === menuPath.value) return true;
  return Boolean(menu.children?.some((child) => child.path === menuPath.value));
}
</script>

<template>
  <nav class="nomi-horizontal-menu" :aria-label="t('layout.header.menu')">
    <template v-for="menu in list" :key="menu.path">
      <ElDropdown v-if="menu.children?.length" trigger="hover" placement="bottom-start">
        <button type="button" class="nomi-horizontal-item" :class="{ 'is-active': isActive(menu) }">
          <NomiIcon :name="menu.icon" :size="17" />
          <span>{{ menuTitle(menu.title) }}</span>
          <NomiIcon name="chevron-down" :size="14" class="nomi-horizontal-caret" />
        </button>
        <template #dropdown>
          <ElDropdownMenu>
            <ElDropdownItem
              v-for="child in menu.children"
              :key="child.path"
              :class="{ 'is-current': menuPath === child.path }"
              @click="go(child.path)"
            >
              <NomiIcon :name="child.icon" :size="15" />
              <span>{{ menuTitle(child.title) }}</span>
            </ElDropdownItem>
          </ElDropdownMenu>
        </template>
      </ElDropdown>

      <button
        v-else
        type="button"
        class="nomi-horizontal-item"
        :class="{ 'is-active': isActive(menu) }"
        @click="go(menu.path)"
      >
        <NomiIcon :name="menu.icon" :size="17" />
        <span>{{ menuTitle(menu.title) }}</span>
      </button>
    </template>
  </nav>
</template>

<style scoped>
.nomi-horizontal-menu {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 2px;
  overflow-x: auto;
  scrollbar-width: none;
}

.nomi-horizontal-menu::-webkit-scrollbar {
  display: none;
}

.nomi-horizontal-item {
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

.nomi-horizontal-item:hover,
.nomi-horizontal-item.is-active {
  color: var(--el-color-primary);
  background: color-mix(in srgb, var(--el-color-primary) 10%, transparent);
}

.nomi-horizontal-caret {
  opacity: 0.6;
}

:global(.el-dropdown-menu__item) {
  display: flex;
  align-items: center;
  gap: 8px;
}

:global(.el-dropdown-menu__item.is-current) {
  color: var(--el-color-primary);
}
</style>
