<script setup lang="ts">
import { message } from 'ant-design-vue'
import {
  DashboardOutlined, MenuFoldOutlined, MenuUnfoldOutlined,
  SettingOutlined, UserOutlined,
} from '@ant-design/icons-vue'
import { APP_TITLE } from '~/config/env'

const { user, logout } = useAuth()
const { visible, current, breadcrumb } = useMenu()
const notify = useNotify()
const router = useRouter()

const collapsed = useCookie<boolean>('admin:nav-collapsed', { default: () => false })

const ICONS = {
  dashboard: DashboardOutlined,
  settings: SettingOutlined,
  user: UserOutlined,
  account: UserOutlined,
} as const

function icon(name?: string) {
  return name ? ICONS[name as keyof typeof ICONS] : undefined
}

// a-menu 的选中态与展开态都要受控，否则折叠侧边栏时子菜单状态会漂
const selectedKeys = computed(() => (current.value ? [current.value.path] : []))
const openKeys = ref<string[]>([])

watch(() => notify.queue.value, () => {
  for (const m of notify.take()) {
    // antd 的 message 是函数式 API，五种级别各自一个方法
    const text = m.description ? `${m.title}（${m.description}）` : m.title
    if (m.level === 'error') message.error(text)
    else if (m.level === 'warning') message.warning(text)
    else if (m.level === 'success') message.success(text)
    else message.info(text)
  }
}, { flush: 'post', immediate: true })

async function onLogout() {
  await logout()
  message.success('已退出登录')
  await router.push('/login')
}

function onMenuClick({ key }: { key: string | number }) {
  router.push(String(key))
}
</script>

<template>
  <a-layout class="admin">
    <a-layout-sider
      v-model:collapsed="collapsed"
      :width="220"
      :trigger="null"
      collapsible
      theme="dark"
    >
      <div class="admin__brand">
        {{ collapsed ? 'A' : APP_TITLE }}
      </div>

      <a-menu
        v-model:open-keys="openKeys"
        :selected-keys="selectedKeys"
        mode="inline"
        theme="dark"
        @click="onMenuClick"
      >
        <template v-for="item in visible" :key="item.path">
          <a-sub-menu v-if="item.children?.length" :key="item.path">
            <template #title>
              <component :is="icon(item.icon)" v-if="item.icon" />
              <span>{{ item.title }}</span>
            </template>
            <a-menu-item v-for="child in item.children" :key="child.path">
              <component :is="icon(child.icon)" v-if="child.icon" />
              <span>{{ child.title }}</span>
            </a-menu-item>
          </a-sub-menu>

          <a-menu-item v-else :key="item.path">
            <component :is="icon(item.icon)" v-if="item.icon" />
            <span>{{ item.title }}</span>
          </a-menu-item>
        </template>
      </a-menu>
    </a-layout-sider>

    <a-layout>
      <a-layout-header class="admin__header">
        <component
          :is="collapsed ? MenuUnfoldOutlined : MenuFoldOutlined"
          class="admin__fold"
          @click="collapsed = !collapsed"
        />

        <a-breadcrumb class="admin__crumb">
          <a-breadcrumb-item v-for="c in breadcrumb" :key="c.path">
            {{ c.title }}
          </a-breadcrumb-item>
        </a-breadcrumb>

        <a-dropdown placement="bottomRight">
          <span class="admin__user-trigger">
            <a-avatar :size="28">{{ user?.displayName?.slice(0, 1) }}</a-avatar>
            <span>{{ user?.displayName }}</span>
          </span>
          <template #overlay>
            <a-menu @click="onLogout">
              <a-menu-item key="logout">
                退出登录
              </a-menu-item>
            </a-menu>
          </template>
        </a-dropdown>
      </a-layout-header>

      <a-layout-content class="admin__main">
        <slot />
      </a-layout-content>
    </a-layout>
  </a-layout>
</template>

<style scoped>
.admin { min-height: 100vh; }
.admin__brand {
  height: 56px; display: grid; place-items: center;
  color: #fff; font-weight: 600; letter-spacing: .04em;
}
.admin__header {
  display: flex; align-items: center; gap: 16px;
  padding-inline: 20px; background: #fff;
  border-bottom: 1px solid rgb(0 0 0 / 6%);
}
.admin__fold { font-size: 18px; cursor: pointer; }
.admin__crumb { flex: 1; }
.admin__user-trigger {
  display: inline-flex; align-items: center; gap: 8px; cursor: pointer;
}
.admin__main {
  margin: 16px; padding: 20px;
  background: #fff; border-radius: 8px;
  min-height: 280px;
}
</style>
