<script setup lang="ts">
/**
 * 顶栏 —— 对应文档第 11 章 ArtHeaderBar（485 行）。
 *
 * 60px 主行 + 第二行工作标签栏，整块由布局容器的 #app-header sticky 吸顶。
 * 每个按钮的显隐都来自 useHeaderBar() 的三级开关（硬开关 && 软开关 && 宽度），
 * 组件本身不直接读配置文件。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { ElDropdown, ElDropdownItem, ElDropdownMenu, ElPopover } from 'element-plus';
import { useFullscreen, useWindowSize } from '@vueuse/core';
import NomiBreadcrumb from './NomiBreadcrumb.vue';
import NomiFastEnter from './NomiFastEnter.vue';
import NomiHorizontalMenu from './NomiHorizontalMenu.vue';
import NomiIcon from './NomiIcon.vue';
import NomiIconButton from './NomiIconButton.vue';
import NomiLogo from './NomiLogo.vue';
import NomiMixedMenu from './NomiMixedMenu.vue';
import NomiUserMenu from './NomiUserMenu.vue';
import NomiWorkTab from './NomiWorkTab.vue';
import { useHeaderBar } from '../../composables/useHeaderBar';
import { useLayoutComputed } from '../../composables/useLayout';
import { useLayoutStore } from '../../stores/layout';
import { useMenuStore } from '../../stores/menu';
import { useNotificationStore } from '../../stores/notification';
import { useSettingStore } from '../../stores/setting';
import { useSiteStore } from '../../stores/site';
import { emitNomiBus } from '../../utils/bus';
import { isDemoMode } from '../../utils/api';
import { normalizeMenuPath } from '../../utils/path';

const { t, locale } = useI18n();
/** 菜单名写了词条键就按当前语言显示（例：`layout.menu.users`）。 */
const menuTitle = useMenuTitle();
/** 语言清单来自「语言管理」里启用的语言，与右上角切换器共用同一份数据。 */
const { locales: languageOptions, switchLocale } = useRuntimeI18n();
const route = useRoute();
const layout = useLayoutStore();
const menu = useMenuStore();
const notification = useNotificationStore();
const setting = useSettingStore();
const site = useSiteStore();
const { width } = useWindowSize();
const { isLeftMenu, isDualMenu, isTopMenu, isTopLeftMenu, homePath, firstLevelMenus } =
  useLayoutComputed();
const {
  isMobileHeader,
  shouldShowMenuButton,
  shouldShowRefreshButton,
  shouldShowFastEnter,
  shouldShowBreadcrumb,
  shouldShowGlobalSearch,
  shouldShowFullscreen,
  shouldShowNotification,
  shouldShowChat,
  shouldShowLanguage,
  shouldShowSettings,
  shouldShowThemeToggle,
} = useHeaderBar();
const { isFullscreen, toggle: toggleFullscreen } = useFullscreen();

// 主题偏好在 localStorage 里，SSR 拿不到：水合后再切图标，避免 hydration mismatch。
const hydrated = ref(false);
const isDark = computed(() => hydrated.value && setting.isDark);
// 窄屏「更多」按钮：窄屏没有独立的明暗按钮，明暗切换的圆形揭示以它为中心。
const moreTrigger = ref<HTMLButtonElement>();
// 引导气泡是给宽屏指针用户看的：手机上它既挡内容又没有悬停语境，收进「更多」。
const showGuide = computed(
  () => hydrated.value && !isMobileHeader.value && layout.state.showSettingGuide && shouldShowSettings.value,
);
// 仅用于「展开态」视觉；不参与语言切换判断，changeLanguage 逻辑保持不变。
const languageOpen = ref(false);

/** 紧凑顶栏用当前页名代替面包屑，路径解析仍走统一的菜单扁平表。 */
const mobilePageTitle = computed(() => {
  const item = menu.findMenu(normalizeMenuPath(route.path));
  return item ? menuTitle(item.title) : t('layout.menu.dashboard');
});

/** 环境角标的悬停提示：补一句当前环境地址，排查「我到底连的哪套」时最有用。 */
const envBadgeTitle = computed(() => {
  const base = t(site.envLabelKey);
  return site.envUrl ? `${base} · ${site.envUrl}` : base;
});

/**
 * 演示站不显示环境角标。
 *
 * 角标是给运维看的「这套连的是哪个库」，静态演示站既没有后端也没有环境之分，
 * 挂个「开发环境」只会让点进来的人以为站点配置错了。其他部署仍按系统配置显示。
 */
const isDemo = isDemoMode();
const showEnvBadge = computed(() => site.showEnvBadge && !isDemo);

interface MoreAction {
  key: string;
  icon: string;
  label: string;
  divided?: boolean;
}

/** 窄屏收起的主行功能全部搬到这里，不丢失任何已有能力。 */
const moreActions = computed<MoreAction[]>(() => {
  const actions: (MoreAction & { show: boolean })[] = [
    { key: 'refresh', icon: 'refresh', label: t('layout.header.refresh'), show: shouldShowRefreshButton.value },
    {
      key: 'notification',
      icon: 'bell',
      label: t('layout.header.notification'),
      show: shouldShowNotification.value || shouldShowChat.value,
    },
    {
      key: 'fullscreen',
      icon: isFullscreen.value ? 'fullscreen-exit' : 'fullscreen',
      label: t('layout.header.fullscreen'),
      show: shouldShowFullscreen.value,
    },
    {
      key: 'theme',
      icon: isDark.value ? 'sun' : 'moon',
      label: t('layout.header.theme'),
      show: shouldShowThemeToggle.value,
    },
    {
      key: 'settings',
      icon: 'settings',
      label: t('layout.header.settings'),
      show: shouldShowSettings.value,
      divided: true,
    },
  ];
  return actions.filter((action) => action.show);
});

function handleMoreCommand(command: string): void {
  switch (command) {
    case 'refresh':
      refresh();
      break;
    case 'notification':
      openNotification();
      break;
    case 'fullscreen':
      void toggleFullscreen();
      break;
    case 'theme':
      // 窄屏没有独立的明暗按钮，动画的圆心就用「更多」这颗按钮。
      setting.toggleDark(moreTrigger.value);
      break;
    case 'settings':
      openSetting();
      break;
    default:
      break;
  }
}

function goHome(): void {
  void navigateTo(homePath);
}

function visibleMenu(): void {
  layout.toggleMenu();
}

function refresh(): void {
  layout.reload();
}

function openSetting(): void {
  emitNomiBus('openSetting');
  if (layout.state.showSettingGuide) layout.hideSettingGuide();
}

function openSearch(): void {
  emitNomiBus('openSearch');
}

function openNotification(): void {
  emitNomiBus('openNotification');
}

async function changeLanguage(lang: string): Promise<void> {
  // 切语言、写用户偏好、按需改 URL 前缀，全部收在 useRuntimeI18n 里，
  // 避免这里和语言管理页各存一套「当前语言」。
  await switchLocale(lang);
}

function onKeydown(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    if (shouldShowGlobalSearch.value) openSearch();
  }
}

onMounted(() => {
  hydrated.value = true;
  document.addEventListener('keydown', onKeydown);
});

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <header class="nomi-header" :class="{ 'is-boxed': layout.state.tabStyle !== 'tab-default' }">
    <div class="nomi-header-main">
      <div class="nomi-header-left">
        <!-- top 布局没有侧栏，品牌入口必须补在顶栏 -->
        <button v-if="isTopMenu && !isMobileHeader" type="button" class="nomi-header-brand" @click="goHome">
          <NomiLogo :size="30" />
          <span v-if="width >= 1400">{{ site.name }}</span>
        </button>

        <!-- 窄屏必须有汉堡入口；软开关关掉时也不能让抽屉变得无法打开。 -->
        <NomiIconButton
          v-if="isMobileHeader || (isLeftMenu && shouldShowMenuButton)"
          icon="menu"
          :label="t('layout.header.toggleMenu')"
          class="nomi-header-menu-btn"
          @click="visibleMenu"
        />

        <span v-if="isMobileHeader" class="nomi-mobile-title">{{ mobilePageTitle }}</span>

        <NomiIconButton
          v-if="shouldShowRefreshButton && !isMobileHeader"
          icon="refresh"
          :label="t('layout.header.refresh')"
          spin-on-hover
          class="nomi-header-refresh"
          @click="refresh"
        />

        <NomiFastEnter v-if="shouldShowFastEnter && !isMobileHeader">
          <NomiIconButton icon="function" :label="t('layout.fastEnter.title')" />
        </NomiFastEnter>

        <NomiBreadcrumb v-if="shouldShowBreadcrumb && (isLeftMenu || isDualMenu) && !isMobileHeader" />
        <NomiHorizontalMenu v-if="isTopMenu && !isMobileHeader" :list="firstLevelMenus" />
        <NomiMixedMenu v-if="isTopLeftMenu && !isMobileHeader" :list="firstLevelMenus" />
      </div>

      <div class="nomi-header-right">
        <!--
          环境角标：来自「系统配置 → 环境配置」。
          放最左侧而不是品牌旁：top 布局没有品牌位、移动端又是紧凑顶栏，
          放右边这组图标前面，四种布局下位置都稳定，也最靠近用户视线落点。
        -->
        <span
          v-if="showEnvBadge"
          class="nomi-env-badge"
          :class="`is-${site.env}`"
          :title="envBadgeTitle"
        >
          {{ t(site.envLabelKey) }}
        </span>

        <button
          v-if="shouldShowGlobalSearch && !isMobileHeader"
          type="button"
          class="nomi-search-trigger"
          @click="openSearch"
        >
          <NomiIcon name="search" :size="16" />
          <span>{{ t('layout.search.title') }}</span>
          <kbd>⌘ K</kbd>
        </button>
        <NomiIconButton
          v-if="shouldShowGlobalSearch && isMobileHeader"
          icon="search"
          :label="t('layout.search.title')"
          @click="openSearch"
        />

        <NomiIconButton
          v-if="shouldShowFullscreen && !isMobileHeader"
          class="nomi-hide-md"
          :icon="isFullscreen ? 'fullscreen-exit' : 'fullscreen'"
          :label="t('layout.header.fullscreen')"
          @click="toggleFullscreen()"
        />

        <ElDropdown
          v-if="shouldShowLanguage && languageOptions.length > 1"
          trigger="click"
          @command="changeLanguage"
          @visible-change="languageOpen = $event"
        >
          <span class="nomi-dropdown-ref">
            <NomiIconButton
              icon="translate"
              :label="t('layout.header.language')"
              :active="languageOpen"
              :tooltip-disabled="languageOpen"
            />
          </span>
          <template #dropdown>
            <ElDropdownMenu>
              <ElDropdownItem
                v-for="lang in languageOptions"
                :key="lang.code"
                :command="lang.code"
                :disabled="locale === lang.code"
              >
                {{ lang.nativeName || lang.name }}
              </ElDropdownItem>
            </ElDropdownMenu>
          </template>
        </ElDropdown>

        <NomiIconButton
          v-if="shouldShowNotification && !isMobileHeader"
          icon="bell"
          :label="t('layout.header.notification')"
          :dot="notification.hasUnread"
          @click="openNotification"
        />
        <NomiIconButton
          v-if="shouldShowChat && !isMobileHeader"
          icon="chat"
          :label="t('layout.header.chat')"
          @click="openNotification"
        />

        <!--
          reference 槽必须是原生 DOM 元素：直接放 NomiIconButton（根是 ElTooltip）
          时 ElPopover 拿不到定位锚点，气泡会掉到页面左上角并遮住侧栏。
        -->
        <ElPopover
          v-if="shouldShowSettings && !isMobileHeader"
          :visible="showGuide"
          placement="bottom-end"
          :width="210"
        >
          <template #reference>
            <span class="nomi-guide-ref">
              <NomiIconButton
                icon="settings"
                :label="t('layout.header.settings')"
                spin-on-hover
                @click="openSetting"
              />
            </span>
          </template>
          <p class="nomi-guide">{{ t('layout.guide.text') }}</p>
        </ElPopover>

        <NomiIconButton
          v-if="shouldShowThemeToggle && !isMobileHeader"
          :icon="isDark ? 'sun' : 'moon'"
          :label="t('layout.header.theme')"
          @click="setting.toggleDark($event.currentTarget)"
        />

        <NomiUserMenu />

        <!-- 窄屏把主行放不下的功能收进「更多」，不牺牲任何已有入口。 -->
        <ElDropdown
          v-if="isMobileHeader"
          trigger="click"
          placement="bottom-end"
          @command="handleMoreCommand"
        >
          <button
            ref="moreTrigger"
            type="button"
            class="nomi-header-more"
            :aria-label="t('layout.header.more')"
          >
            <NomiIcon name="more" :size="19" />
          </button>
          <template #dropdown>
            <ElDropdownMenu class="nomi-more-menu">
              <ElDropdownItem
                v-for="action in moreActions"
                :key="action.key"
                :command="action.key"
                :divided="action.divided"
              >
                <NomiIcon :name="action.icon" :size="15" />
                <span>{{ action.label }}</span>
              </ElDropdownItem>
            </ElDropdownMenu>
          </template>
        </ElDropdown>
      </div>
    </div>

    <NomiWorkTab />
  </header>
</template>

<style scoped>
.nomi-header {
  width: 100%;
  background: var(--bg);
  border-bottom: 1px solid var(--nomi-border);
}

.nomi-header.is-boxed {
  margin-bottom: 12px;
  background: var(--nomi-card);
}

.nomi-header-main {
  display: flex;
  height: 60px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 16px;
  user-select: none;
}

.nomi-header-left {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 4px;
}

.nomi-header-right {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 4px;
}

.nomi-header-brand {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 10px;
  padding: 0 10px 0 0;
  color: var(--fg);
  background: transparent;
  border: 0;
  font-size: 16px;
  font-weight: 650;
  cursor: pointer;
}

.nomi-search-trigger {
  display: inline-flex;
  width: 176px;
  height: 34px;
  align-items: center;
  gap: 8px;
  padding: 0 8px 0 11px;
  color: var(--fg-muted);
  background: var(--bg-subtle);
  border: 1px solid var(--nomi-border);
  border-radius: var(--nomi-radius-sm, 8px);
  font-size: 13px;
  cursor: pointer;
  transition: border-color 0.18s var(--ease);
}

.nomi-search-trigger:hover {
  border-color: var(--el-color-primary);
}

.nomi-search-trigger span {
  flex: 1;
  text-align: left;
}

.nomi-search-trigger kbd {
  padding: 1px 5px;
  color: var(--fg-muted);
  background: var(--bg);
  border: 1px solid var(--nomi-border);
  border-radius: 5px;
  font-family: var(--font-mono);
  font-size: 11px;
}

.nomi-guide-ref,
.nomi-dropdown-ref {
  display: inline-flex;
  align-items: center;
}

/* 环境角标：三档各一色，生产用最醒目的红 —— 它的用途是「别在生产上乱点」。 */
.nomi-env-badge {
  display: inline-flex;
  height: 22px;
  align-items: center;
  padding: 0 8px;
  margin-right: 4px;
  border: 1px solid currentcolor;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  white-space: nowrap;
  cursor: default;
  opacity: 0.9;
}

.nomi-env-badge.is-development {
  color: var(--el-color-info);
  background: color-mix(in srgb, var(--el-color-info) 12%, transparent);
}

.nomi-env-badge.is-testing {
  color: var(--el-color-warning);
  background: color-mix(in srgb, var(--el-color-warning) 14%, transparent);
}

.nomi-env-badge.is-production {
  color: var(--el-color-danger);
  background: color-mix(in srgb, var(--el-color-danger) 12%, transparent);
}

.nomi-guide {
  margin: 0;
  color: var(--fg);
  font-size: 13px;
  line-height: 1.6;
}

/* 紧凑顶栏：当前页名代替面包屑，宽度不够时省略，绝不把右侧按钮挤出去。 */
.nomi-mobile-title {
  min-width: 0;
  overflow: hidden;
  margin-left: 4px;
  font-size: 15px;
  font-weight: 600;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.nomi-header-more {
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
}

.nomi-header-more:hover,
.nomi-header-more:active {
  color: var(--el-color-primary);
  background: color-mix(in srgb, var(--el-color-primary) 10%, transparent);
}

:global(.nomi-more-menu .el-dropdown-menu__item) {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 148px;
  padding: 9px 12px;
}

@media (max-width: 1000px) {
  .nomi-search-trigger,
  .nomi-hide-md {
    display: none !important;
  }

  .nomi-header-main {
    padding: 0 10px;
  }
}

@media (max-width: 800px) {
  .nomi-header-main {
    height: 54px;
    gap: 8px;
    padding: 0 10px;
  }

  .nomi-header-left,
  .nomi-header-right {
    gap: 2px;
  }
}

@media (max-width: 640px) {
  .nomi-header-refresh {
    display: none;
  }

  .nomi-header-main {
    padding: 0 8px;
  }

  .nomi-header.is-boxed {
    margin-bottom: 8px;
  }
}
</style>
