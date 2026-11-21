<script setup lang="ts">
/**
 * 用户菜单 —— 对应文档第 12.4 节 ArtUserMenu。
 * 顶栏里唯一无条件显示的组件（身份入口不该被软开关关掉）。
 */
import { ElDropdown, ElDropdownItem, ElDropdownMenu } from 'element-plus';
import NomiIcon from './NomiIcon.vue';
import { logoutAdmin } from '../../services/permission';
import { usePermissionStore } from '../../stores/permission';
import { useUserStore } from '../../stores/user';

const { t } = useI18n();
const user = useUserStore();

// 有真实身份就显示身份，没有才退回「超级管理员 / 访客」这类占位文案。
const displayName = computed(
  () => user.info.userName || (user.isLogin ? t('layout.user.admin') : t('layout.user.guest')),
);

async function handleCommand(command: string): Promise<void> {
  if (command === 'profile') await navigateTo('/admin/profile');
  if (command === 'settings') await navigateTo('/admin/system/settings');
  if (command === 'logout') {
    // 先让服务端把 token 记录删掉（失败也无所谓：本地清理才是用户可感知的部分），
    // 再清前端权限与身份 —— 顺序反过来会让退出请求失去鉴权头。
    await logoutAdmin(user.refreshToken).catch(() => undefined);
    usePermissionStore().reset();
    // store 只负责清理并告诉我们要去哪，导航留给组件（store 不绑路由）。
    const redirect = user.logOut();
    await navigateTo(redirect);
  }
}
</script>

<template>
  <ElDropdown trigger="click" placement="bottom-end" @command="handleCommand">
    <button type="button" class="nomi-user-trigger">
      <span class="nomi-avatar">N</span>
      <span class="nomi-user-name">{{ displayName }}</span>
      <NomiIcon name="chevron-down" :size="14" />
    </button>
    <template #dropdown>
      <ElDropdownMenu>
        <ElDropdownItem command="profile">
          <NomiIcon name="user" :size="15" />
          <span>{{ t('layout.user.profile') }}</span>
        </ElDropdownItem>
        <ElDropdownItem command="settings">
          <NomiIcon name="settings" :size="15" />
          <span>{{ t('layout.user.settings') }}</span>
        </ElDropdownItem>
        <ElDropdownItem command="logout" divided>
          <NomiIcon name="logout" :size="15" />
          <span>{{ t('layout.user.logout') }}</span>
        </ElDropdownItem>
      </ElDropdownMenu>
    </template>
  </ElDropdown>
</template>

<style scoped>
.nomi-user-trigger {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 3px 6px 3px 3px;
  color: var(--fg);
  background: transparent;
  border: 0;
  border-radius: 999px;
  cursor: pointer;
  transition: background-color 0.18s var(--ease);
}

.nomi-user-trigger:hover {
  background: var(--bg-subtle);
}

.nomi-avatar {
  display: inline-flex;
  width: 30px;
  height: 30px;
  align-items: center;
  justify-content: center;
  color: #fff;
  background: linear-gradient(135deg, var(--el-color-primary), color-mix(in srgb, var(--el-color-primary) 60%, #7c3aed));
  border-radius: 50%;
  font-size: 14px;
  font-weight: 700;
}

.nomi-user-name {
  max-width: 90px;
  overflow: hidden;
  font-size: 13px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

:global(.el-dropdown-menu__item) {
  display: flex;
  align-items: center;
  gap: 8px;
}

@media (max-width: 640px) {
  .nomi-user-name {
    display: none;
  }
}
</style>
