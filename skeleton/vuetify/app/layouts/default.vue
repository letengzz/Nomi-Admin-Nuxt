<script setup lang="ts">
import { APP_TITLE } from '~/config/env'

const { user, logout } = useAuth()
const { visible, current, breadcrumb } = useMenu()
const notify = useNotify()
const router = useRouter()

const rail = useCookie<boolean>('admin:nav-rail', { default: () => false })

// Vuetify 没有「全局函数式提示」API：队列 + v-snackbar 自己搭
const snackbar = reactive({ show: false, text: '', color: 'success' })

watch(() => notify.queue.value, () => {
  const list = notify.take()
  if (!list.length) return
  // 演示版只展示第一条；要完整队列可换成 VSnackbarQueue（Vuetify 3.9+）
  const first = list[0]!
  snackbar.text = first.description ? `${first.title}（${first.description}）` : first.title
  snackbar.color = first.level === 'error' ? 'error' : first.level
  snackbar.show = true
}, { flush: 'post', immediate: true })

const ICONS = {
  dashboard: 'mdi-view-dashboard',
  settings: 'mdi-cog',
  user: 'mdi-account',
  account: 'mdi-account-circle',
} as const

function icon(name?: string) {
  return name ? ICONS[name as keyof typeof ICONS] : undefined
}

async function onLogout() {
  await logout()
  snackbar.text = '已退出登录'
  snackbar.color = 'success'
  snackbar.show = true
  await router.push('/login')
}
</script>

<template>
  <v-app>
    <v-navigation-drawer v-model="rail" :rail="rail" permanent width="220">
      <v-list-item :title="rail ? 'A' : APP_TITLE" nav />
      <v-divider />

      <v-list nav density="comfortable">
        <template v-for="item in visible" :key="item.path">
          <v-list-group v-if="item.children?.length" :value="item.path">
            <template #activator="{ props }">
              <v-list-item
                v-bind="props"
                :prepend-icon="icon(item.icon)"
                :title="item.title"
              />
            </template>
            <v-list-item
              v-for="child in item.children"
              :key="child.path"
              :prepend-icon="icon(child.icon)"
              :title="child.title"
              :to="child.path"
              :active="current?.path === child.path"
            />
          </v-list-group>

          <v-list-item
            v-else
            :prepend-icon="icon(item.icon)"
            :title="item.title"
            :to="item.path"
            :active="current?.path === item.path"
          />
        </template>
      </v-list>
    </v-navigation-drawer>

    <v-app-bar flat density="comfortable">
      <v-app-bar-nav-icon @click="rail = !rail" />

      <v-breadcrumbs
        :items="breadcrumb.map(c => ({ title: c.title, disabled: true }))"
      />

      <v-spacer />

      <v-menu location="bottom end">
        <template #activator="{ props }">
          <v-btn v-bind="props" variant="text">
            <v-avatar size="28" class="mr-2">
              {{ user?.displayName?.slice(0, 1) }}
            </v-avatar>
            {{ user?.displayName }}
          </v-btn>
        </template>
        <v-list>
          <v-list-item title="退出登录" @click="onLogout" />
        </v-list>
      </v-menu>
    </v-app-bar>

    <v-main>
      <v-container fluid>
        <slot />
      </v-container>
    </v-main>

    <v-snackbar
      v-model="snackbar.show"
      :color="snackbar.color"
      location="top"
      timeout="3000"
    >
      {{ snackbar.text }}
    </v-snackbar>
  </v-app>
</template>
