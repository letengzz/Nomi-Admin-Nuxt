<script setup lang="ts">
/**
 * 设置面板 —— 对应文档第 16 章 art-settings-panel（72 行 + 4 个 composable）。
 *
 * 它是所有布局状态的写入口：改一个下拉框，switchMenuLayouts 的连锁规则会
 * 依次改 menuType / menuOpen / menuTheme，四个区域组件随之重新渲染。
 * 挂在全局层（#app-global）而不是顶栏内部，避免被 #app-main 的 overflow 裁切。
 *
 * 第 19 / 20.3 节的修复：订阅用 useNomiBus，effect scope 销毁时自动 off，
 * 热更新后不会出现「一次点击开多个抽屉」。
 */
import { computed, ref } from 'vue';
import { ElDrawer, ElOption, ElSelect, ElSlider, ElSwitch } from 'element-plus';
import { useWindowSize } from '@vueuse/core';
import NomiIcon from './NomiIcon.vue';
import {
  ContainerWidthEnum,
  MENU_THEME_CHOICES,
  MenuThemeEnum,
  MenuTypeEnum,
  PAGE_TRANSITIONS,
  TabStyleEnum,
  type MenuType,
  type PageTransition,
  type TabStyle,
} from '../../constants/layout';
import { isMobileWidth } from '../../composables/useLayout';
import { SOFT_SWITCH_BY_FEATURE, visibleSoftSwitches } from '../../composables/useHeaderBar';
import { useLayoutStore, type LayoutState } from '../../stores/layout';
import { useSettingStore } from '../../stores/setting';
import { THEME_COLORS } from '../../utils/theme';
import { useNomiBus } from '../../utils/bus';

const { t } = useI18n();
const layout = useLayoutStore();
const setting = useSettingStore();
const showDrawer = ref(false);
const { width } = useWindowSize();
// 320px 固定宽度在 360px 手机上会被左右都挤满，改成随视口收缩。
const drawerSize = computed(() => (isMobileWidth(width.value) ? 'min(88vw, 340px)' : '320px'));

useNomiBus('openSetting', () => {
  showDrawer.value = true;
});

const layoutOptions: { value: MenuType; label: string; shape: string }[] = [
  { value: MenuTypeEnum.LEFT, label: 'layout.setting.menuType.left', shape: 'left' },
  { value: MenuTypeEnum.TOP, label: 'layout.setting.menuType.top', shape: 'top' },
  { value: MenuTypeEnum.TOP_LEFT, label: 'layout.setting.menuType.topLeft', shape: 'top-left' },
  { value: MenuTypeEnum.DUAL_MENU, label: 'layout.setting.menuType.dualMenu', shape: 'dual' },
];

const themeModes = [
  { value: 'light', label: 'layout.setting.themeMode.light', icon: 'sun' },
  { value: 'dark', label: 'layout.setting.themeMode.dark', icon: 'moon' },
  { value: 'auto', label: 'layout.setting.themeMode.auto', icon: 'monitor' },
] as const;

const containerOptions = [
  { value: ContainerWidthEnum.FULL, label: 'layout.setting.container.full', icon: 'monitor' },
  { value: ContainerWidthEnum.BOXED, label: 'layout.setting.container.boxed', icon: 'mobile' },
] as const;

const tabStyleOptions = [
  { value: TabStyleEnum.DEFAULT, label: 'layout.setting.tabStyle.default' },
  { value: TabStyleEnum.CARD, label: 'layout.setting.tabStyle.card' },
  { value: TabStyleEnum.GOOGLE, label: 'layout.setting.tabStyle.google' },
] as const;

const softSwitches = computed(() =>
  visibleSoftSwitches()
    .map((feature) => ({ feature, key: SOFT_SWITCH_BY_FEATURE[feature] }))
    .filter((item): item is { feature: typeof item.feature; key: keyof LayoutState } =>
      Boolean(item.key),
    ),
);

function setSoftSwitch(key: keyof LayoutState, value: boolean): void {
  layout.patch({ [key]: value } as Partial<LayoutState>);
}

function softValue(key: keyof LayoutState): boolean {
  return layout.state[key] === true;
}

function setRadius(value: number | number[]): void {
  const radius = Array.isArray(value) ? value[0] ?? 0.75 : value;
  layout.patch({ customRadius: (radius / 100).toFixed(2) });
}

function setMenuWidth(value: number | number[]): void {
  const width = Array.isArray(value) ? value[0] ?? 230 : value;
  layout.patch({ menuOpenWidth: width });
}

/**
 * 下拉值来自 ElSelect，但仍是字符串：只认配置里的白名单，避免任何来源
 * （包括旧存储里的脏值）把 `nomi-${name}` 拼成一个不存在的动画类名。
 */
function setPageTransition(value: unknown): void {
  if (typeof value === 'string' && (PAGE_TRANSITIONS as readonly string[]).includes(value)) {
    layout.setPageTransition(value as PageTransition);
  }
}

function setTabStyle(value: unknown): void {
  if (typeof value === 'string' && Object.values(TabStyleEnum).includes(value as TabStyle)) {
    layout.setTabStyle(value as TabStyle);
  }
}

function reset(anchor?: unknown): void {
  layout.reset();
  setting.setColorMode('auto', anchor);
}
</script>

<template>
  <ElDrawer v-model="showDrawer" :size="drawerSize" :with-header="false" :append-to-body="true">
    <div class="nomi-settings">
      <div class="nomi-settings-head">
        <div>
          <h3>{{ t('layout.setting.title') }}</h3>
          <p>{{ t('layout.setting.subtitle') }}</p>
        </div>
        <button type="button" class="nomi-settings-close" @click="showDrawer = false">
          <NomiIcon name="close" :size="18" />
        </button>
      </div>

      <section class="nomi-setting-section">
        <h4>{{ t('layout.setting.themeMode.title') }}</h4>
        <div class="nomi-theme-modes">
          <button
            v-for="mode in themeModes"
            :key="mode.value"
            type="button"
            class="nomi-theme-mode"
            :class="{ 'is-active': setting.colorMode === mode.value }"
            @click="setting.setColorMode(mode.value, $event.currentTarget)"
          >
            <NomiIcon :name="mode.icon" :size="18" />
            <span>{{ t(mode.label) }}</span>
          </button>
        </div>
      </section>

      <section class="nomi-setting-section">
        <h4>{{ t('layout.setting.color.title') }}</h4>
        <div class="nomi-colors">
          <button
            v-for="color in THEME_COLORS"
            :key="color"
            type="button"
            class="nomi-color-dot"
            :class="{ 'is-active': setting.themeColor === color }"
            :style="{ background: color }"
            :aria-label="color"
            @click="setting.setThemeColor(color)"
          >
            <NomiIcon v-if="setting.themeColor === color" name="check" :size="14" />
          </button>
        </div>
      </section>

      <section class="nomi-setting-section">
        <h4>{{ t('layout.setting.menuType.title') }}</h4>
        <div class="nomi-layout-options">
          <button
            v-for="option in layoutOptions"
            :key="option.value"
            type="button"
            class="nomi-layout-option"
            :class="{ 'is-active': layout.state.menuType === option.value }"
            @click="layout.switchMenuLayouts(option.value)"
          >
            <span class="nomi-layout-thumb" :class="`thumb-${option.shape}`">
              <i class="thumb-side" /><i class="thumb-top" /><i class="thumb-body" />
            </span>
            <span>{{ t(option.label) }}</span>
          </button>
        </div>
      </section>

      <section class="nomi-setting-section">
        <h4>{{ t('layout.setting.menuTheme.title') }}</h4>
        <div class="nomi-inline-options">
          <button
            v-for="preset in MENU_THEME_CHOICES"
            :key="preset.theme"
            type="button"
            class="nomi-inline-option"
            :class="{ 'is-active': layout.state.menuTheme === preset.theme }"
            :disabled="preset.theme === MenuThemeEnum.LIGHT && setting.isDark"
            :title="preset.theme === MenuThemeEnum.LIGHT && setting.isDark ? t('layout.setting.menuTheme.darkHint') : undefined"
            @click="layout.patch({ menuTheme: preset.theme })"
          >
            <!-- 色块只表示「侧栏底色」，按钮本身跟面板其他选项同一套皮肤：
                 之前把背景和文字色整块写成预设色，暗色面板里就出现一块死白/死黑。 -->
            <span
              class="nomi-menu-swatch"
              :style="{ background: preset.background, borderColor: preset.borderColor }"
              aria-hidden="true"
            />
            {{ t(preset.label) }}
          </button>
        </div>
        <p v-if="setting.isDark" class="nomi-setting-hint">
          {{ t('layout.setting.menuTheme.darkHint') }}
        </p>
      </section>

      <section class="nomi-setting-section">
        <h4>{{ t('layout.setting.container.title') }}</h4>
        <div class="nomi-inline-options">
          <button
            v-for="option in containerOptions"
            :key="option.value"
            type="button"
            class="nomi-inline-option"
            :class="{ 'is-active': layout.state.containerWidth === option.value }"
            @click="layout.patch({ containerWidth: option.value })"
          >
            <NomiIcon :name="option.icon" :size="15" />
            {{ t(option.label) }}
          </button>
        </div>
      </section>

      <section class="nomi-setting-section">
        <h4>{{ t('layout.setting.transition.title') }}</h4>
        <ElSelect
          class="nomi-setting-select"
          :model-value="layout.state.pageTransition"
          @update:model-value="setPageTransition"
        >
          <ElOption
            v-for="name in PAGE_TRANSITIONS"
            :key="name"
            :value="name"
            :label="t(`layout.setting.transition.${name}`)"
          />
        </ElSelect>
      </section>

      <section class="nomi-setting-section">
        <h4>{{ t('layout.setting.tabStyle.title') }}</h4>
        <ElSelect
          class="nomi-setting-select"
          :model-value="layout.state.tabStyle"
          @update:model-value="setTabStyle"
        >
          <ElOption
            v-for="option in tabStyleOptions"
            :key="option.value"
            :value="option.value"
            :label="t(option.label)"
          />
        </ElSelect>
      </section>

      <section class="nomi-setting-section">
        <h4>{{ t('layout.setting.radius.title') }}</h4>
        <ElSlider
          :model-value="Number(layout.state.customRadius) * 100"
          :min="0"
          :max="160"
          :step="5"
          @update:model-value="setRadius"
        />
        <h4 class="nomi-setting-sub">{{ t('layout.setting.menuWidth.title') }}</h4>
        <ElSlider
          :model-value="layout.state.menuOpenWidth"
          :min="180"
          :max="320"
          :step="10"
          @update:model-value="setMenuWidth"
        />
      </section>

      <section class="nomi-setting-section">
        <h4>{{ t('layout.setting.switches.title') }}</h4>
        <div v-for="item in softSwitches" :key="item.feature" class="nomi-setting-row">
          <span>{{ t(`layout.setting.switches.${item.feature}`) }}</span>
          <ElSwitch
            :model-value="softValue(item.key)"
            size="small"
            @update:model-value="setSoftSwitch(item.key, Boolean($event))"
          />
        </div>
        <div class="nomi-setting-row">
          <span>{{ t('layout.setting.switches.showWorkTab') }}</span>
          <ElSwitch
            :model-value="layout.state.showWorkTab"
            size="small"
            @update:model-value="layout.patch({ showWorkTab: Boolean($event) })"
          />
        </div>
        <div class="nomi-setting-row">
          <span>{{ t('layout.setting.switches.uniqueOpened') }}</span>
          <ElSwitch
            :model-value="layout.state.uniqueOpened"
            size="small"
            @update:model-value="layout.patch({ uniqueOpened: Boolean($event) })"
          />
        </div>
        <div class="nomi-setting-row">
          <span>{{ t('layout.setting.switches.showWatermark') }}</span>
          <ElSwitch
            :model-value="layout.state.showWatermark"
            size="small"
            @update:model-value="layout.patch({ showWatermark: Boolean($event) })"
          />
        </div>
        <div class="nomi-setting-row">
          <span>{{ t('layout.setting.switches.showFestivalText') }}</span>
          <ElSwitch
            :model-value="layout.state.showFestivalText"
            size="small"
            @update:model-value="layout.patch({ showFestivalText: Boolean($event) })"
          />
        </div>
      </section>

      <button type="button" class="nomi-setting-reset" @click="reset($event.currentTarget)">
        <NomiIcon name="reset" :size="16" />
        {{ t('layout.setting.reset') }}
      </button>
    </div>
  </ElDrawer>
</template>

<style scoped>
.nomi-settings {
  padding: 4px 4px calc(24px + var(--nomi-safe-bottom, 0px));
}

.nomi-settings-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 4px 0 18px;
  border-bottom: 1px solid var(--nomi-border);
}

.nomi-settings-head h3 {
  margin: 0;
  font-size: 17px;
}

.nomi-settings-head p {
  margin: 4px 0 0;
  color: var(--fg-muted);
  font-size: 12px;
}

.nomi-settings-close {
  display: inline-flex;
  padding: 4px;
  color: var(--fg-muted);
  background: transparent;
  border: 0;
  cursor: pointer;
}

.nomi-setting-section {
  padding: 18px 0 0;
}

.nomi-setting-section h4 {
  margin: 0 0 12px;
  font-size: 13px;
  font-weight: 600;
}

.nomi-setting-sub {
  margin-top: 18px !important;
}

.nomi-theme-modes,
.nomi-layout-options,
.nomi-inline-options {
  display: flex;
  gap: 8px;
}

.nomi-theme-modes {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
}

.nomi-theme-mode {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 12px 4px;
  color: var(--fg-muted);
  background: var(--bg-subtle);
  border: 1px solid var(--nomi-border);
  border-radius: 10px;
  font-size: 12px;
  cursor: pointer;
}

.nomi-theme-mode.is-active,
.nomi-layout-option.is-active,
.nomi-inline-option.is-active {
  color: var(--el-color-primary);
  border-color: var(--el-color-primary);
  background: color-mix(in srgb, var(--el-color-primary) 8%, transparent);
}

.nomi-colors {
  display: flex;
  flex-wrap: wrap;
  gap: 9px;
}

.nomi-color-dot {
  display: inline-flex;
  width: 26px;
  height: 26px;
  align-items: center;
  justify-content: center;
  padding: 0;
  color: #fff;
  border: 2px solid transparent;
  border-radius: 50%;
  box-shadow: 0 1px 4px rgb(15 23 42 / 18%);
  cursor: pointer;
}

.nomi-color-dot.is-active {
  border-color: var(--fg);
}

.nomi-layout-options {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}

.nomi-layout-option {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 10px 4px;
  color: var(--fg-muted);
  background: var(--bg-subtle);
  border: 1px solid var(--nomi-border);
  border-radius: 10px;
  font-size: 12px;
  cursor: pointer;
}

.nomi-layout-thumb {
  position: relative;
  display: block;
  width: 58px;
  height: 38px;
  overflow: hidden;
  background: var(--bg);
  border: 1px solid var(--nomi-border);
  border-radius: 4px;
}

.nomi-layout-thumb i {
  position: absolute;
  display: block;
  background: color-mix(in srgb, var(--el-color-primary) 55%, transparent);
}

.thumb-side {
  top: 0;
  bottom: 0;
  left: 0;
  width: 14px;
}

.thumb-top {
  top: 0;
  right: 0;
  left: 0;
  height: 8px;
}

.thumb-body {
  right: 4px;
  bottom: 4px;
  left: 18px;
  height: 24px;
  background: var(--nomi-border) !important;
}

.thumb-top .thumb-side {
  display: none;
}

.thumb-left .thumb-top,
.thumb-dual .thumb-top {
  display: none;
}

.thumb-dual .thumb-side {
  width: 22px;
  box-shadow: 8px 0 0 color-mix(in srgb, var(--el-color-primary) 28%, transparent);
}

.thumb-top-left .thumb-body {
  left: 18px;
}

.nomi-inline-options {
  flex-wrap: wrap;
}

.nomi-inline-option {
  display: inline-flex;
  flex: 1;
  min-width: 84px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 10px;
  color: var(--fg-muted);
  background: var(--bg-subtle);
  border: 1px solid var(--nomi-border);
  border-radius: 8px;
  font-size: 12px;
  cursor: pointer;
}

.nomi-inline-option.is-active {
  font-weight: 600;
}

.nomi-inline-option:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.nomi-setting-hint {
  margin: 8px 0 0;
  color: var(--fg-muted);
  font-size: 11px;
  line-height: 1.5;
}

/* 「菜单风格」的预览色块：只负责显示侧栏底色，尺寸固定，避免和文字基线错位。 */
.nomi-menu-swatch {
  display: inline-block;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  border: 1px solid var(--nomi-border);
  border-radius: 4px;
}

/* 下拉统一用 Element Plus：圆角、focus 描边、暗色变量都和面板里的
   ElSwitch / ElSlider 同源，不再维护一套手写 select 皮肤。 */
.nomi-setting-select {
  width: 100%;
}

.nomi-setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 0;
  color: var(--fg-muted);
  font-size: 13px;
}

.nomi-setting-reset {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 22px;
  padding: 10px;
  color: var(--fg);
  background: var(--bg-subtle);
  border: 1px solid var(--nomi-border);
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
}

.nomi-setting-reset:hover {
  color: var(--el-color-primary);
  border-color: var(--el-color-primary);
}
</style>
