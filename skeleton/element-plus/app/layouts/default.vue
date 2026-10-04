<script setup lang="ts">
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Avatar, DataBoard, Expand, Fold, Setting, User,
} from '@element-plus/icons-vue'
import { APP_TITLE } from '~/config/env'

const { user, logout } = useAuth()
const { visible, current, breadcrumb } = useMenu()
const notify = useNotify()
const router = useRouter()

// 折叠状态存 Cookie：SSR 首屏就带着正确宽度，不会先展开再收起
const collapsed = useCookie<boolean>('admin:nav-collapsed', { default: () => false })

const ICONS = {
  dashboard: DataBoard,
  settings: Setting,
  user: User,
  account: Avatar,
} as const

function icon(name?: string) {
  return name ? ICONS[name as keyof typeof ICONS] : undefined
}

// 提示队列接线：逻辑层只描述消息，这里决定用 ElMessage 弹
watch(() => notify.queue.value, () => {
  for (const m of notify.take()) {
    ElMessage({
      type: m.level === 'error' ? 'error' : m.level,
      message: m.description ? `${m.title}（${m.description}）` : m.title,
    })
  }
}, { flush: 'post', immediate: true })

async function onLogout() {
  try {
    await ElMessageBox.confirm('确定要退出登录吗？', '提示', {
      confirmButtonText: '退出',
      cancelButtonText: '取消',
      type: 'warning',
    })
  }
  catch {
    // ElMessageBox 以 reject 表示「用户点了取消」——这里必须吞掉，
    // 否则每次取消都会冒出一个未处理的 Promise rejection
    return
  }
  await logout()
  await router.push('/login')
}
</script>

<template>
  <el-container class="admin">
    <el-aside :width="collapsed ? '64px' : '220px'" class="admin__aside">
      <div class="admin__brand">
        {{ collapsed ? 'A' : APP_TITLE }}
      </div>

      <el-menu
        :default-active="current?.path"
        :collapse="collapsed"
        :collapse-transition="false"
        router
      >
        <template v-for="item in visible" :key="item.path">
          <el-sub-menu v-if="item.children?.length" :index="item.path">
            <template #title>
              <el-icon v-if="icon(item.icon)">
                <component :is="icon(item.icon)" />
              </el-icon>
              <span>{{ item.title }}</span>
            </template>
            <el-menu-item
              v-for="child in item.children"
              :key="child.path"
              :index="child.path"
            >
              <el-icon v-if="icon(child.icon)">
                <component :is="icon(child.icon)" />
              </el-icon>
              <span>{{ child.title }}</span>
            </el-menu-item>
          </el-sub-menu>

          <el-menu-item v-else :index="item.path">
            <el-icon v-if="icon(item.icon)">
              <component :is="icon(item.icon)" />
            </el-icon>
            <span>{{ item.title }}</span>
          </el-menu-item>
        </template>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header class="admin__header">
        <el-icon class="admin__fold" @click="collapsed = !collapsed">
          <component :is="collapsed ? Expand : Fold" />
        </el-icon>

        <el-breadcrumb separator="/" class="admin__crumb">
          <el-breadcrumb-item v-for="c in breadcrumb" :key="c.path">
            {{ c.title }}
          </el-breadcrumb-item>
        </el-breadcrumb>

        <el-dropdown class="admin__user" @command="onLogout">
          <span class="admin__user-trigger">
            <el-avatar :size="28">{{ user?.displayName?.slice(0, 1) }}</el-avatar>
            <span>{{ user?.displayName }}</span>
          </span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="logout">
                退出登录
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </el-header>

      <el-main class="admin__main">
        <slot />
      </el-main>
    </el-container>
  </el-container>
</template>

<style scoped>
.admin { min-height: 100vh; }
.admin__aside { border-right: 1px solid var(--el-border-color-light); }
.admin__brand {
  height: 56px; display: grid; place-items: center;
  font-weight: 600; letter-spacing: .04em;
}
.admin__header {
  display: flex; align-items: center; gap: 16px;
  border-bottom: 1px solid var(--el-border-color-light);
}
.admin__fold { cursor: pointer; font-size: 18px; }
.admin__crumb { flex: 1; }
.admin__user-trigger {
  display: inline-flex; align-items: center; gap: 8px; cursor: pointer;
}
.admin__main { background: var(--el-fill-color-lighter); }
</style>
