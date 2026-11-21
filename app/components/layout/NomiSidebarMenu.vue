<script setup lang="ts">
/**
 * 侧栏 —— 对应文档第 6 章 ArtSidebarMenu（369 行）。
 *
 * 一个组件承担三种渲染：left 的完整树、top-left / dual-menu 的二级切片、
 * dual-menu 额外的一级图标列。top 模式下整块不渲染，但外壳 <aside> 仍在，
 * 宽度塌成 0，不会触发 flex 重排抖动（第 2.3 节）。
 *
 * 第 20.2 节的修复已落实：遮罩显隐由 watch(menuOpen) 单点驱动，
 * toggleMenuVisibility 只改 store，不在事件处理里双写状态。
 */
import { computed } from 'vue';
import { ElMenu, ElScrollbar, ElTooltip } from 'element-plus';
import { useWindowSize } from '@vueuse/core';
import NomiIcon from './NomiIcon.vue';
import NomiIconButton from './NomiIconButton.vue';
import NomiLogo from './NomiLogo.vue';
import NomiSidebarSubmenu from './NomiSidebarSubmenu.vue';
import {
  getMobileDrawerWidth,
  useLayoutComputed,
  useMobileDrawer,
} from '../../composables/useLayout';
import { useLayoutStore } from '../../stores/layout';
import { useSiteStore } from '../../stores/site';

const emit = defineEmits<{ navigate: [] }>();

const { t } = useI18n();
/** 菜单名是词条键时按当前语言显示，否则原样输出。 */
const menuTitle = useMenuTitle();
const layout = useLayoutStore();
const site = useSiteStore();
const {
  showLeftMenu,
  isDualMenu,
  isLeftMenu,
  sidebarMenuList,
  sidebarWidth,
  activeMenuPath,
  activeTopMenu,
  firstChildPath,
  firstLevelMenus,
  homePath,
} = useLayoutComputed();
const { width } = useWindowSize();
const { isMobile: isMobileScreen, isOpen: isDrawerOpen } = useMobileDrawer();

const theme = computed(() => layout.getMenuTheme);
const isDualMenuCollapsed = computed(() => isDualMenu.value && !layout.state.menuOpen);
const showText = computed(() => layout.state.dualMenuShowText);

// 抽屉宽度与视口联动：小屏留出一截内容区，便于点击遮罩直接收起。
const drawerWidth = computed(() => getMobileDrawerWidth(width.value));
const sidebarOuterWidth = computed(() =>
  isMobileScreen.value ? drawerWidth.value : isDualMenu.value ? undefined : sidebarWidth.value,
);

const scrollbarStyle = computed(() => ({
  height: `calc(100% - ${isDualMenu.value ? 60 : 62}px)`,
}));

function toggleMenu(): void {
  layout.toggleMenu();
}

function toggleDualText(): void {
  layout.patch({ dualMenuShowText: !layout.state.dualMenuShowText });
}

async function go(path: string): Promise<void> {
  if (path.startsWith('#')) return;
  await navigateTo(path);
  if (isMobileScreen.value) layout.setMenuOpen(false);
  emit('navigate');
}

function handleSelect(index: string): void {
  void go(index);
}

async function jumpToFirst(menu: (typeof firstLevelMenus)[number]): Promise<void> {
  await go(firstChildPath(menu));
}
</script>

<template>
  <div
    v-if="showLeftMenu || isDualMenu"
    class="nomi-sidebar"
    :class="{
      'no-border': sidebarMenuList.length === 0,
      'is-dual': isDualMenu,
      'is-drawer': isMobileScreen,
      'is-drawer-open': isDrawerOpen,
    }"
    :style="{ width: sidebarOuterWidth }"
  >
    <!-- 双栏模式的第一列：一级图标条 -->
    <div
      v-if="isDualMenu"
      class="nomi-dual-left"
      :style="{ width: showText ? '80px' : '64px', background: theme.background }"
    >
      <button type="button" class="nomi-dual-logo" :aria-label="site.name" @click="go(homePath)">
        <NomiLogo :size="32" />
      </button>

      <ElScrollbar class="nomi-dual-scroll">
        <ul>
          <li v-for="menu in firstLevelMenus" :key="menu.path">
            <ElTooltip :content="menuTitle(menu.title)" placement="right" :offset="12" :disabled="showText">
              <button
                type="button"
                class="nomi-dual-item"
                :class="{ 'is-active': activeTopMenu?.path === menu.path }"
                :style="{ height: showText ? '60px' : '46px' }"
                @click="jumpToFirst(menu)"
              >
                <NomiIcon :name="menu.icon" :size="20" />
                <span v-if="showText">{{ menuTitle(menu.title) }}</span>
              </button>
            </ElTooltip>
          </li>
        </ul>
      </ElScrollbar>

      <NomiIconButton
        class="nomi-dual-switch"
        icon="switch"
        :label="t('layout.sidebar.switchMode')"
        @click="toggleDualText"
      />
    </div>

    <!-- 侧栏主体：left / top-left / dual-menu 共用 -->
    <div
      v-show="sidebarMenuList.length > 0"
      class="nomi-sidebar-main"
      :class="`nomi-theme-${theme.theme}`"
      :style="{
        width: isDualMenuCollapsed ? '64px' : isDualMenu ? sidebarWidth : undefined,
        background: theme.background,
        '--nomi-menu-hover': theme.hoverBackground,
      }"
    >
      <div class="nomi-sidebar-header" :style="{ color: theme.systemNameColor }" @click="go(homePath)">
        <NomiLogo v-if="!isDualMenu" :size="32" />
        <span
          class="nomi-sidebar-title"
          :style="{ opacity: layout.state.menuOpen || isMobileScreen ? 1 : 0 }"
        >
          {{ site.name }}
        </span>
        <NomiIconButton
          v-if="isMobileScreen"
          class="nomi-sidebar-close"
          icon="close"
          :label="t('layout.sidebar.close')"
          @click.stop="layout.setMenuOpen(false)"
        />
      </div>

      <ElScrollbar :style="scrollbarStyle" class="nomi-sidebar-scroll">
        <ElMenu
          :default-active="activeMenuPath"
          :collapse="!layout.state.menuOpen && !isMobileScreen"
          :unique-opened="layout.state.uniqueOpened"
          :text-color="theme.textColor"
          :background-color="theme.background"
          :active-text-color="theme.activeTextColor"
          :popper-class="`nomi-menu-popper nomi-menu-popper--${theme.theme}`"
          popper-effect="light"
          @select="handleSelect"
        >
          <NomiSidebarSubmenu :list="sidebarMenuList" />
        </ElMenu>
        <div v-if="sidebarMenuList.length === 0" class="nomi-sidebar-empty">
          {{ t('layout.sidebar.empty') }}
        </div>
      </ElScrollbar>

      <button
        v-if="isDualMenu"
        type="button"
        class="nomi-dual-collapse"
        :aria-label="t('layout.sidebar.toggle')"
        @click="toggleMenu"
      >
        <NomiIcon :name="layout.state.menuOpen ? 'chevron-left' : 'chevron-right'" :size="16" />
      </button>
    </div>

    <!-- 侧栏没有二级菜单时给个可点击的品牌入口（top-left 常见） -->
    <div v-if="sidebarMenuList.length === 0 && !isLeftMenu" class="nomi-sidebar-placeholder">
      <NomiLogo :size="30" />
      <p>{{ t('layout.sidebar.pickTop') }}</p>
    </div>

    <!-- 遮罩在 admin.vue 里渲染：抽屉带 transform，会裁掉内部 fixed 遮罩。 -->
  </div>
</template>

<style scoped>
.nomi-sidebar {
  position: relative;
  display: flex;
  height: 100vh;
  flex-shrink: 0;
  overflow: hidden;
  background: var(--nomi-sidebar-bg);
  border-right: 1px solid var(--nomi-border);
  transition: width 0.24s var(--ease);
}

.nomi-sidebar.no-border {
  border-right-color: transparent;
}

.nomi-dual-left {
  display: flex;
  height: 100%;
  flex-direction: column;
  flex-shrink: 0;
  align-items: center;
  border-right: 1px solid var(--nomi-border);
}

.nomi-dual-logo {
  display: flex;
  height: 60px;
  align-items: center;
  justify-content: center;
  padding: 0;
  background: transparent;
  border: 0;
  cursor: pointer;
}

.nomi-dual-scroll {
  width: 100%;
  height: calc(100% - 110px);
}

.nomi-dual-scroll ul {
  margin: 0;
  padding: 0;
  list-style: none;
}

.nomi-dual-item {
  display: flex;
  width: 100%;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 0 4px;
  color: var(--fg-muted);
  background: transparent;
  border: 0;
  cursor: pointer;
  transition: color 0.18s var(--ease), background-color 0.18s var(--ease);
}

.nomi-dual-item span {
  max-width: 100%;
  overflow: hidden;
  font-size: 11px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.nomi-dual-item:hover,
.nomi-dual-item.is-active {
  color: var(--el-color-primary);
  background: color-mix(in srgb, var(--el-color-primary) 10%, transparent);
}

.nomi-dual-switch {
  margin-bottom: 14px;
}

.nomi-sidebar-main {
  position: relative;
  display: flex;
  height: 100%;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  transition: width 0.24s var(--ease);
}

.nomi-sidebar-header {
  display: flex;
  height: 60px;
  flex-shrink: 0;
  align-items: center;
  gap: 10px;
  overflow: hidden;
  padding: 0 16px;
  cursor: pointer;
  user-select: none;
}

.nomi-sidebar-title {
  flex: 1;
  overflow: hidden;
  font-size: 16px;
  font-weight: 650;
  white-space: nowrap;
  transition: opacity 0.2s var(--ease);
}

.nomi-sidebar-close {
  margin-right: -6px;
}

.nomi-sidebar-scroll {
  flex: 1;
  min-height: 0;
}

.nomi-sidebar-scroll :deep(.el-menu) {
  border-right: 0;
  /* 菜单左右各留 2px，别让菜单项贴死侧栏边缘；折叠态也不因此溢出 */
  box-sizing: border-box;
  padding: 0 2px;
}

.nomi-sidebar-scroll :deep(.el-menu-item),
.nomi-sidebar-scroll :deep(.el-sub-menu__title) {
  height: 44px;
  line-height: 44px;
  border-radius: 8px;
}

/* 选中项：只靠主色淡底 + 加粗标出「当前这一项」，不加左侧指示条，
   父级分组也不跟着涂色 —— 父子两条高亮并排会显得脏。 */
.nomi-sidebar-scroll :deep(.el-menu-item.is-active) {
  font-weight: 600;
  background: color-mix(in srgb, var(--el-color-primary) 12%, transparent);
}

/* 暗色侧栏：#191a23 上的 12% 主色几乎看不出来，浓度提到 30%。 */
.nomi-theme-dark .nomi-sidebar-scroll :deep(.el-menu-item.is-active) {
  background: color-mix(in srgb, var(--el-color-primary) 30%, transparent);
}

/* 折叠态只剩图标、子项不可见，改用父级的分组图标标出「我在哪个分组」，
   否则收起侧栏时整列没有任何高亮。 */
.nomi-sidebar-scroll :deep(.el-menu--collapse .el-sub-menu.is-active > .el-sub-menu__title) {
  color: var(--el-menu-active-color);
  background: color-mix(in srgb, var(--el-color-primary) 14%, transparent);
}

.nomi-theme-dark .nomi-sidebar-scroll :deep(.el-menu--collapse .el-sub-menu.is-active > .el-sub-menu__title) {
  background: color-mix(in srgb, var(--el-color-primary) 28%, transparent);
}

.nomi-sidebar-empty,
.nomi-sidebar-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 40px 16px;
  color: var(--fg-muted);
  font-size: 13px;
  text-align: center;
}

.nomi-sidebar-placeholder {
  flex: 1;
  justify-content: center;
}

.nomi-dual-collapse {
  position: absolute;
  top: 50%;
  right: -1px;
  display: flex;
  width: 18px;
  height: 44px;
  align-items: center;
  justify-content: center;
  padding: 0;
  color: var(--fg-muted);
  background: var(--bg-subtle);
  border: 1px solid var(--nomi-border);
  border-right: 0;
  border-radius: 10px 0 0 10px;
  cursor: pointer;
  opacity: 0;
  transform: translateY(-50%);
  transition: opacity 0.2s var(--ease);
}

.nomi-sidebar-main:hover .nomi-dual-collapse {
  opacity: 1;
}

@media (max-width: 800px) {
  /* 抽屉本体不再受桌面态 64px 折叠宽度影响，高度用 dvh 规避地址栏收缩。 */
  .nomi-sidebar {
    height: 100dvh;
    border-right: 0;
    border-radius: 0 16px 16px 0;
    box-shadow: 0 12px 40px rgb(15 23 42 / 18%);
    transition: none; /* 位移动画由外层 #app-sidebar 统一负责 */
  }

  .nomi-sidebar-scroll :deep(.el-menu-item),
  .nomi-sidebar-scroll :deep(.el-sub-menu__title) {
    height: 48px; /* 触摸目标 ≥44px */
    line-height: 48px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .nomi-sidebar {
    transition: none !important;
  }
}
</style>
