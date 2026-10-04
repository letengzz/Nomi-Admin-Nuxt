<script setup lang="ts">
import type { MenuItem } from '~/types/admin'
import { APP_TITLE } from '~/config/env'

const { user, logout } = useAuth()
const { visible, current, breadcrumb } = useMenu()
const notify = useNotify()
const router = useRouter()

// useToast 由 @nuxt/ui 提供，但必须挂在 <UApp> 内部才能工作
const toast = useToast()
const collapsed = useCookie<boolean>('admin:nav-collapsed', { default: () => false })

const ICONS = {
  dashboard: 'i-lucide-layout-dashboard',
  settings: 'i-lucide-settings',
  user: 'i-lucide-user',
  account: 'i-lucide-circle-user-round',
} as const

function icon(name?: string) {
  return name ? ICONS[name as keyof typeof ICONS] : undefined
}

/** UNavigationMenu 的 items 形状：label / icon / to / children */
function toNavItem(item: MenuItem): {
  label: string
  icon?: string
  to?: string
  children?: ReturnType<typeof toNavItem>[]
} {
  return {
    label: item.title,
    icon: icon(item.icon),
    to: item.children?.length ? undefined : item.path,
    children: item.children?.map(toNavItem),
  }
}

const navItems = computed(() => visible.value.map(toNavItem))

/** 折叠态下的 icon-only 列表：只取叶子项 */
const leafItems = computed(() => {
  const out: MenuItem[] = []
  const walk = (list: MenuItem[]) => {
    for (const it of list) {
      if (it.children?.length) walk(it.children)
      else out.push(it)
    }
  }
  walk(visible.value)
  return out
})

const crumbItems = computed(() => breadcrumb.value.map(c => ({ label: c.title })))

async function onLogout() {
  await logout()
  toast.add({ title: '已退出登录', color: 'success' })
  await router.push('/login')
}

const userMenu = computed(() => [[
  {
    label: '退出登录',
    icon: 'i-lucide-log-out',
    onSelect: onLogout,
  },
]])

watch(() => notify.queue.value, () => {
  for (const m of notify.take()) {
    toast.add({
      title: m.title,
      description: m.description,
      color: m.level === 'error' ? 'error' : m.level,
    })
  }
}, { flush: 'post', immediate: true })
</script>

<template>
  <UApp>
    <div class="flex min-h-screen">
      <aside
        class="shrink-0 border-r border-default bg-elevated/40 transition-[width]"
        :class="collapsed ? 'w-16' : 'w-60'"
      >
        <div class="grid h-14 place-items-center font-semibold tracking-wide">
          {{ collapsed ? 'A' : APP_TITLE }}
        </div>

        <nav v-if="collapsed" class="flex flex-col items-center gap-1 px-2">
          <UTooltip
            v-for="item in leafItems"
            :key="item.path"
            :text="item.title"
          >
            <UButton
              :icon="icon(item.icon)"
              :to="item.path"
              :color="current?.path === item.path ? 'primary' : 'neutral'"
              :variant="current?.path === item.path ? 'soft' : 'ghost'"
              square
            />
          </UTooltip>
        </nav>

        <UNavigationMenu
          v-else
          orientation="vertical"
          :items="navItems"
          class="px-2"
        />
      </aside>

      <div class="flex min-w-0 flex-1 flex-col">
        <header class="flex h-14 items-center gap-3 border-b border-default px-4">
          <UButton
            :icon="collapsed ? 'i-lucide-panel-left-open' : 'i-lucide-panel-left-close'"
            color="neutral"
            variant="ghost"
            @click="collapsed = !collapsed"
          />
          <UBreadcrumb :items="crumbItems" class="flex-1" />
          <UDropdownMenu :items="userMenu">
            <UButton color="neutral" variant="ghost">
              <UAvatar :alt="user?.displayName" size="xs" />
              <span>{{ user?.displayName }}</span>
            </UButton>
          </UDropdownMenu>
        </header>

        <main class="min-w-0 flex-1 p-6">
          <slot />
        </main>
      </div>
    </div>
  </UApp>
</template>
