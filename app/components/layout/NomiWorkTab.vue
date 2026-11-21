<script setup lang="ts">
/**
 * 工作标签栏 —— 对应文档第 15 章 ArtWorkTab（584 行）。
 *
 * 保留四条核心契约：点击切换、关闭后自动激活相邻、固定标签不可关、右键菜单
 * 五种关闭操作；滚动改用原生 overflow-x + scrollIntoView（原实现用 transform
 * 手写位移，250ms 就清掉 0.5s 的 transition，观感是「快进后突然停」）。
 * 关闭标签同时把组件 name 写进 keepAliveExclude，与 <KeepAlive> 同步。
 */
import { computed, nextTick, onUnmounted, ref, watch } from 'vue';
import NomiIcon from './NomiIcon.vue';
import { useLayoutStore } from '../../stores/layout';
import { useWorktabStore, type WorkTabItem } from '../../stores/worktab';
import { normalizeMenuPath } from '../../utils/path';

interface MenuItem {
  key: string;
  label: string;
  icon: string;
  disabled: boolean;
  divided?: boolean;
}

const { t } = useI18n();
/** 菜单名是词条键时按当前语言显示，否则原样输出。 */
const menuTitle = useMenuTitle();
const route = useRoute();
const layout = useLayoutStore();
const worktab = useWorktabStore();
const scroller = ref<HTMLElement | null>(null);

const list = computed(() => worktab.opened);
/** 标签 path 存的是不带语言前缀的菜单路径，比对前归一化：切语言后高亮才不会集体消失。 */
const activeTab = computed(() => normalizeMenuPath(route.path));
/** 导航时把当前语言前缀加回去，避免英文状态下点标签又跳回中文路由。 */
const localePath = useLocalePath();
const clickedPath = ref('');
const menuVisible = ref(false);
const menuPosition = ref({ left: 0, top: 0 });

function labelOf(tab: WorkTabItem): string {
  return tab.customTitle ?? menuTitle(tab.title);
}

async function clickTab(tab: WorkTabItem): Promise<void> {
  if (tab.path === activeTab.value) return;
  await navigateTo({ path: localePath(tab.path), query: tab.query ?? {} });
}

function closeWorktab(type: string, path: string): void {
  let next: string | undefined;
  switch (type) {
    case 'current':
      next = worktab.removeTab(path, activeTab.value);
      break;
    case 'left':
      next = worktab.removeSide('left', path, activeTab.value);
      break;
    case 'right':
      next = worktab.removeSide('right', path, activeTab.value);
      break;
    case 'other':
      next = worktab.removeOthers(path, activeTab.value);
      break;
    case 'all':
      next = worktab.removeAll(activeTab.value);
      break;
    default:
      break;
  }
  if (next && next !== activeTab.value) void navigateTo(localePath(next));
}

function showMenu(event: Event, path: string): void {
  event.preventDefault();
  const mouse = event as MouseEvent;
  clickedPath.value = path;
  const menuWidth = 158;
  menuPosition.value = {
    left: Math.min(mouse.clientX, window.innerWidth - menuWidth - 8),
    top: Math.min(mouse.clientY, window.innerHeight - 230),
  };
  menuVisible.value = true;
}

const menuItems = computed<MenuItem[]>(() => {
  const index = list.value.findIndex((tab) => tab.path === clickedPath.value);
  const clicked = list.value[index];
  const isCurrent = clickedPath.value === activeTab.value;
  const fixedCount = list.value.filter((tab) => tab.fixedTab).length;
  return [
    { key: 'refresh', label: t('layout.worktab.refresh'), icon: 'refresh', disabled: !isCurrent },
    {
      key: 'fixed',
      label: clicked?.fixedTab ? t('layout.worktab.unfix') : t('layout.worktab.fix'),
      icon: 'pin',
      disabled: !clicked,
      divided: true,
    },
    { key: 'left', label: t('layout.worktab.closeLeft'), icon: 'arrow-left', disabled: index <= fixedCount },
    { key: 'right', label: t('layout.worktab.closeRight'), icon: 'arrow-right', disabled: index < 0 || index >= list.value.length - 1 },
    { key: 'other', label: t('layout.worktab.closeOther'), icon: 'copy', disabled: list.value.length - fixedCount <= 1 },
    { key: 'all', label: t('layout.worktab.closeAll'), icon: 'close', disabled: list.value.length - fixedCount <= 0 },
  ];
});

function selectMenu(item: MenuItem): void {
  if (item.disabled) return;
  menuVisible.value = false;
  if (item.key === 'refresh') {
    layout.reload();
    return;
  }
  if (item.key === 'fixed') {
    worktab.toggleFixedTab(clickedPath.value);
    return;
  }
  closeWorktab(item.key, clickedPath.value);
}

function onDocumentClick(): void {
  menuVisible.value = false;
}

watch(menuVisible, (visible) => {
  if (visible) document.addEventListener('click', onDocumentClick, { once: true });
  else document.removeEventListener('click', onDocumentClick);
});

watch(
  () => route.path,
  () => {
    void nextTick(() => {
      scroller.value?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  },
);

onUnmounted(() => document.removeEventListener('click', onDocumentClick));
</script>

<template>
  <div v-if="layout.state.showWorkTab" class="nomi-worktab" :class="layout.state.tabStyle">
    <div ref="scroller" class="nomi-worktab-scroll">
      <div class="nomi-worktab-list">
        <div
          v-for="tab in list"
          :key="tab.path"
          class="nomi-worktab-item"
          :class="{ 'is-active': tab.path === activeTab }"
          @click="clickTab(tab)"
          @contextmenu="showMenu($event, tab.path)"
        >
          <NomiIcon :name="tab.icon" :size="14" />
          <span class="nomi-worktab-label">{{ labelOf(tab) }}</span>
          <button
            v-if="!tab.fixedTab && list.length > 1"
            type="button"
            class="nomi-worktab-close"
            :aria-label="t('layout.worktab.close')"
            @click.stop="closeWorktab('current', tab.path)"
          >
            <NomiIcon name="close" :size="12" />
          </button>
        </div>
      </div>
    </div>

    <button
      type="button"
      class="nomi-worktab-more"
      :aria-label="t('layout.worktab.more')"
      @click.stop="showMenu($event, activeTab)"
    >
      <NomiIcon name="chevron-down" :size="16" />
    </button>

    <Teleport to="body">
      <div
        v-if="menuVisible"
        class="nomi-context-menu"
        :style="{ left: `${menuPosition.left}px`, top: `${menuPosition.top}px` }"
        @click.stop
      >
        <template v-for="item in menuItems" :key="item.key">
          <div v-if="item.divided" class="nomi-context-divider" />
          <button
            type="button"
            class="nomi-context-item"
            :class="{ 'is-disabled': item.disabled }"
            :disabled="item.disabled"
            @click="selectMenu(item)"
          >
            <NomiIcon :name="item.icon" :size="15" />
            <span>{{ item.label }}</span>
          </button>
        </template>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.nomi-worktab {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 16px 10px;
  user-select: none;
}

.nomi-worktab-scroll {
  min-width: 0;
  flex: 1;
  overflow-x: auto;
  scrollbar-width: none;
}

.nomi-worktab-scroll::-webkit-scrollbar {
  display: none;
}

.nomi-worktab-list {
  display: flex;
  width: max-content;
  align-items: center;
  gap: 6px;
}

.nomi-worktab-item {
  display: inline-flex;
  height: 30px;
  flex-shrink: 0;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  color: var(--fg-muted);
  background: var(--bg-subtle);
  border: 1px solid var(--nomi-border);
  border-radius: calc(var(--nomi-radius, 0.75rem) / 2 + 2px);
  font-size: 12px;
  white-space: nowrap;
  cursor: pointer;
  transition: color 0.18s var(--ease), background-color 0.18s var(--ease);
}

.nomi-worktab-item:hover {
  color: var(--el-color-primary);
}

.nomi-worktab-item.is-active {
  color: var(--el-color-primary);
  background: color-mix(in srgb, var(--el-color-primary) 12%, transparent);
  border-color: color-mix(in srgb, var(--el-color-primary) 30%, transparent);
  font-weight: 600;
}

.nomi-worktab-close {
  display: inline-flex;
  width: 16px;
  height: 16px;
  align-items: center;
  justify-content: center;
  padding: 0;
  color: inherit;
  background: transparent;
  border: 0;
  border-radius: 50%;
  cursor: pointer;
}

.nomi-worktab-close:hover {
  background: color-mix(in srgb, var(--el-color-primary) 20%, transparent);
}

.nomi-worktab-more {
  display: inline-flex;
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  padding: 0;
  color: var(--fg-muted);
  background: var(--bg-subtle);
  border: 1px solid var(--nomi-border);
  border-radius: calc(var(--nomi-radius, 0.75rem) / 2 + 2px);
  cursor: pointer;
}

.nomi-worktab.tab-card .nomi-worktab-item,
.nomi-worktab.tab-card .nomi-worktab-more {
  border-radius: 4px;
  box-shadow: 0 1px 2px rgb(15 23 42 / 5%);
}

.nomi-worktab.tab-google {
  padding-bottom: 0;
}

.nomi-worktab.tab-google .nomi-worktab-item {
  border: 0;
  border-bottom: 2px solid transparent;
  border-radius: 8px 8px 0 0;
  background: transparent;
}

.nomi-worktab.tab-google .nomi-worktab-item.is-active {
  border-bottom-color: var(--el-color-primary);
  border-radius: 8px 8px 0 0;
}

.nomi-context-menu {
  position: fixed;
  z-index: 2000;
  width: 158px;
  padding: 5px;
  background: var(--bg);
  border: 1px solid var(--nomi-border);
  border-radius: 10px;
  box-shadow: 0 8px 28px rgb(15 23 42 / 14%);
}

.nomi-context-item {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 8px;
  padding: 7px 9px;
  color: var(--fg);
  background: transparent;
  border: 0;
  border-radius: 6px;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.nomi-context-item:hover:not(.is-disabled) {
  color: var(--el-color-primary);
  background: color-mix(in srgb, var(--el-color-primary) 9%, transparent);
}

.nomi-context-item.is-disabled {
  color: var(--fg-muted);
  cursor: not-allowed;
  opacity: 0.45;
}

.nomi-context-divider {
  height: 1px;
  margin: 4px 6px;
  background: var(--nomi-border);
}

@media (max-width: 800px) {
  .nomi-worktab {
    gap: 6px;
    padding: 0 10px 8px;
  }

  .nomi-worktab-scroll {
    overscroll-behavior-x: contain;
    -webkit-overflow-scrolling: touch;
  }

  .nomi-worktab-item {
    height: 34px;
    padding: 0 12px;
  }

  /* 关闭按钮原本只有 16px，触屏上几乎点不中。 */
  .nomi-worktab-close {
    width: 22px;
    height: 22px;
  }

  .nomi-worktab-more {
    width: 34px;
    height: 34px;
  }

  .nomi-context-item {
    padding: 10px;
  }
}
</style>
