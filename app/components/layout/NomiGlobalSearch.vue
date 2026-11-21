<script setup lang="ts">
/**
 * 全局搜索 —— 对应文档第 5.2 / 12 章的 art-global-search。
 * 顶栏的搜索框只是触发器（emit 事件），真正的对话框挂在全局层。
 *
 * 数据来自 menu store 而不是 constants：接真实后端后换的是 store 里的菜单，
 * 这里不需要改。搜索历史存在 user store（docs/状态管理.md 3.1 searchHistory），
 * 换设备不同步、换账号不继承 —— 它属于「这台机器上这个人的浏览痕迹」。
 */
import { computed, nextTick, ref, watch } from 'vue';
import { ElDialog, ElInput } from 'element-plus';
import { useWindowSize } from '@vueuse/core';
import NomiIcon from './NomiIcon.vue';
import type { FlatMenuItem } from '../../constants/layout';
import { isMobileWidth } from '../../composables/useLayout';
import { useMenuStore } from '../../stores/menu';
import { useUserStore } from '../../stores/user';
import { useNomiBus } from '../../utils/bus';

const { t } = useI18n();
/** 菜单名是词条键时按当前语言显示，否则原样输出。 */
const menuTitle = useMenuTitle();
const menu = useMenuStore();
const user = useUserStore();
const visible = ref(false);
const keyword = ref('');
const activeIndex = ref(0);
const inputRef = ref<InstanceType<typeof ElInput> | null>(null);
const { width } = useWindowSize();
// 固定 520px 在手机上会横向溢出，改成随视口收缩。
const dialogWidth = computed(() => (isMobileWidth(width.value) ? 'calc(100vw - 24px)' : '520px'));

useNomiBus('openSearch', () => {
  visible.value = true;
});

const isSearching = computed(() => keyword.value.trim().length > 0);

/** 历史里可能有已被下线的菜单：findMenu 返回 undefined 的直接丢掉。 */
const recent = computed<FlatMenuItem[]>(() =>
  user.searchHistory
    .map((path) => menu.findMenu(path))
    .filter((item): item is FlatMenuItem => Boolean(item)),
);

const results = computed<FlatMenuItem[]>(() => {
  const query = keyword.value.trim().toLowerCase();
  if (!query) {
    // 没输入时先给「最近搜索」，没有历史再退回前 8 个菜单 —— 比给一片空白有用。
    return recent.value.length > 0 ? recent.value : menu.flatMenu.slice(0, 8);
  }
  return menu.flatMenu.filter(
    (item) => menuTitle(item.title).toLowerCase().includes(query) || item.path.toLowerCase().includes(query),
  );
});

watch(visible, async (open) => {
  if (!open) return;
  keyword.value = '';
  activeIndex.value = 0;
  await nextTick();
  inputRef.value?.focus();
});

watch(results, () => {
  activeIndex.value = 0;
});

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    activeIndex.value = Math.min(activeIndex.value + 1, results.value.length - 1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    activeIndex.value = Math.max(activeIndex.value - 1, 0);
  } else if (event.key === 'Enter') {
    const target = results.value[activeIndex.value];
    if (target) void pick(target.path);
  }
}

async function pick(path: string): Promise<void> {
  visible.value = false;
  user.addSearchHistory(path);
  await navigateTo(path);
}
</script>

<template>
  <ElDialog v-model="visible" :width="dialogWidth" :show-close="false" align-center class="nomi-search-dialog">
    <div class="nomi-search-input" @keydown="onKeydown">
      <NomiIcon name="search" :size="19" />
      <ElInput
        ref="inputRef"
        v-model="keyword"
        :placeholder="t('layout.search.placeholder')"
        clearable
      />
      <kbd>ESC</kbd>
    </div>
    <div class="nomi-search-results">
      <div class="nomi-search-hint">
        <span>{{ !isSearching && recent.length > 0 ? t('layout.search.recent') : t('layout.search.hint') }}</span>
        <button
          v-if="!isSearching && recent.length > 0"
          type="button"
          class="nomi-search-clear"
          @click="user.clearSearchHistory()"
        >
          {{ t('layout.search.clear') }}
        </button>
      </div>
      <button
        v-for="(item, index) in results"
        :key="item.path"
        type="button"
        class="nomi-search-result"
        :class="{ 'is-active': index === activeIndex }"
        @mouseenter="activeIndex = index"
        @click="pick(item.path)"
      >
        <span class="nomi-search-result-icon"><NomiIcon :name="item.icon" :size="16" /></span>
        <span class="nomi-search-result-title">{{ menuTitle(item.title) }}</span>
        <span class="nomi-search-result-path">{{ item.path }}</span>
        <NomiIcon name="arrow-right" :size="15" />
      </button>
      <p v-if="results.length === 0" class="nomi-search-empty">{{ t('layout.search.empty') }}</p>
    </div>
  </ElDialog>
</template>

<style scoped>
.nomi-search-input {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 12px;
  color: var(--fg-muted);
  border-bottom: 1px solid var(--nomi-border);
}

.nomi-search-input :deep(.el-input__wrapper) {
  padding: 0;
  background: transparent;
  box-shadow: none;
}

.nomi-search-input kbd {
  padding: 2px 6px;
  color: var(--fg-muted);
  background: var(--bg-subtle);
  border: 1px solid var(--nomi-border);
  border-radius: 5px;
  font-family: var(--font-mono);
  font-size: 11px;
}

.nomi-search-results {
  max-height: 340px;
  overflow-y: auto;
  padding: 8px;
}

.nomi-search-hint {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 4px 8px 8px;
  color: var(--fg-muted);
  font-size: 12px;
}

.nomi-search-clear {
  padding: 0;
  color: var(--fg-muted);
  background: transparent;
  border: 0;
  font-size: 12px;
  cursor: pointer;
}

.nomi-search-clear:hover {
  color: var(--el-color-primary);
}

.nomi-search-result {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  color: var(--fg);
  background: transparent;
  border: 0;
  border-radius: 8px;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.nomi-search-result.is-active {
  color: var(--el-color-primary);
  background: color-mix(in srgb, var(--el-color-primary) 10%, transparent);
}

.nomi-search-result-icon {
  display: inline-flex;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  background: var(--bg-subtle);
  border-radius: 7px;
}

.nomi-search-result-title {
  flex: 1;
}

.nomi-search-result-path {
  color: var(--fg-muted);
  font-family: var(--font-mono);
  font-size: 11px;
}

.nomi-search-empty {
  padding: 24px 0;
  color: var(--fg-muted);
  font-size: 13px;
  text-align: center;
}

@media (max-width: 640px) {
  .nomi-search-results {
    max-height: 46dvh; /* 给软键盘留出空间 */
  }

  /* 路径是辅助信息，窄屏优先保证菜单名与点击区域。 */
  .nomi-search-result-path,
  .nomi-search-input kbd {
    display: none;
  }

  .nomi-search-result {
    padding: 11px 8px;
  }
}
</style>
