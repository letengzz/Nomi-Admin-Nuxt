<script setup lang="ts">
/**
 * 快速入口 —— 对应文档第 12.3 节 ArtFastEnter。
 * 触发器由默认插槽提供（顶栏传 NomiIconButton），面板内容在这里，
 * 这样宽度门限由 useHeaderBar 决定，组件只管渲染。
 */
import { computed } from 'vue';
import { ElPopover } from 'element-plus';
import NomiIcon from './NomiIcon.vue';
import { useMenuStore } from '../../stores/menu';

const { t } = useI18n();
/** 菜单名是词条键时按当前语言显示，否则原样输出。 */
const menuTitle = useMenuTitle();
const menu = useMenuStore();

// 读 store 而不是常量：接真实后端后快捷入口自动跟着菜单走。
// 详情页需要一个具体 ID 才有意义，不适合作为「入口」，所以排除掉。
const entries = computed(() =>
  menu.flatMenu.filter((item) => item.path !== '/admin/orders/detail').slice(0, 8),
);

async function go(path: string): Promise<void> {
  await navigateTo(path);
}
</script>

<template>
  <ElPopover placement="bottom-start" :width="260" trigger="click" popper-class="nomi-fast-popper">
    <template #reference>
      <span class="nomi-fast-ref"><slot /></span>
    </template>
    <div class="nomi-fast">
      <p class="nomi-fast-title">{{ t('layout.fastEnter.title') }}</p>
      <div class="nomi-fast-grid">
        <button
          v-for="item in entries"
          :key="item.path"
          type="button"
          class="nomi-fast-item"
          @click="go(item.path)"
        >
          <span class="nomi-fast-icon"><NomiIcon :name="item.icon" :size="18" /></span>
          <span class="nomi-fast-label">{{ menuTitle(item.title) }}</span>
        </button>
      </div>
    </div>
  </ElPopover>
</template>

<style scoped>
.nomi-fast-ref {
  display: inline-flex;
  align-items: center;
}

.nomi-fast-title {
  margin: 0 0 12px;
  color: var(--fg);
  font-size: 13px;
  font-weight: 600;
}

.nomi-fast-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px;
}

.nomi-fast-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  color: var(--fg);
  background: transparent;
  border: 0;
  border-radius: var(--nomi-radius-sm, 8px);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.nomi-fast-item:hover {
  background: var(--bg-subtle);
}

.nomi-fast-icon {
  display: inline-flex;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  color: var(--el-color-primary);
  background: color-mix(in srgb, var(--el-color-primary) 10%, transparent);
  border-radius: 8px;
}

.nomi-fast-label {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
</style>
