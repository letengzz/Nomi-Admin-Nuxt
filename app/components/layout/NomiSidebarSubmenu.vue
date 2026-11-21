<script setup lang="ts">
/**
 * 递归侧栏子菜单 —— 对应文档第 7 章 SidebarSubmenu.vue。
 *
 * 约定：ElMenu 的 index 就是路由 path，导航统一由父级 ElMenu 的 @select 处理；
 * 这里只负责把菜单树翻译成 ElSubMenu / ElMenuItem，不持有任何状态。
 * 目录项的 index 以 `#` 开头，父级会过滤掉它（目录不可点击）。
 */
import { ElMenuItem, ElSubMenu } from 'element-plus';
import NomiIcon from './NomiIcon.vue';
import type { NomiMenuItem } from '../../constants/layout';

defineProps<{
  list: readonly NomiMenuItem[];
}>();

/** 菜单名是词条键时按当前语言显示，否则原样输出。 */
const menuTitle = useMenuTitle();
</script>

<template>
  <template v-for="item in list" :key="item.path">
    <ElSubMenu v-if="item.children?.length" :index="item.path">
      <template #title>
        <NomiIcon :name="item.icon" :size="18" class="nomi-menu-icon" />
        <span>{{ menuTitle(item.title) }}</span>
      </template>
      <NomiSidebarSubmenu :list="item.children" />
    </ElSubMenu>

    <ElMenuItem v-else :index="item.path">
      <NomiIcon :name="item.icon" :size="18" class="nomi-menu-icon" />
      <template #title>
        <span>{{ menuTitle(item.title) }}</span>
        <span v-if="item.showBadge" class="nomi-menu-badge" />
      </template>
    </ElMenuItem>
  </template>
</template>

<style scoped>
.nomi-menu-icon {
  flex-shrink: 0;
  margin-right: 10px;
  vertical-align: -4px;
}

.nomi-menu-badge {
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-left: 8px;
  vertical-align: middle;
  background: var(--el-color-primary);
  border-radius: 50%;
}
</style>
