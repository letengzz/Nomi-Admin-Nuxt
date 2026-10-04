<script setup lang="ts">
import { APP_TITLE } from '~/config/env'

const { user, logout } = useAuth()
const { visible, current, breadcrumb } = useMenu()
const notify = useNotify()
const router = useRouter()

const collapsed = useCookie<boolean>('admin:nav-collapsed', { default: () => false })

// 纯 CSS 档自带一个极简 toast：入队、渲染、8 秒后移除
interface Toast { id: number, text: string, level: string }
const toasts = ref<Toast[]>([])
let toastSeq = 0

watch(() => notify.queue.value, () => {
  for (const m of notify.take()) {
    const id = ++toastSeq
    toasts.value.push({
      id,
      level: m.level,
      text: m.description ? `${m.title}（${m.description}）` : m.title,
    })
    setTimeout(() => {
      toasts.value = toasts.value.filter(t => t.id !== id)
    }, 8000)
  }
}, { flush: 'post', immediate: true })

async function onLogout() {
  await logout()
  await router.push('/login')
}
</script>

<template>
  <div class="admin">
    <aside class="admin__aside" :class="{ 'admin__aside--rail': collapsed }">
      <div class="admin__brand">
        {{ collapsed ? 'A' : APP_TITLE }}
      </div>

      <nav class="nav">
        <ul class="nav__list">
          <li v-for="item in visible" :key="item.path" class="nav__group">
            <span v-if="item.children?.length" class="nav__title">
              <i v-if="item.icon" class="nav__dot" aria-hidden="true" />
              <span v-if="!collapsed">{{ item.title }}</span>
            </span>

            <ul v-if="item.children?.length" class="nav__list">
              <li v-for="child in item.children" :key="child.path">
                <NuxtLink
                  class="nav__link"
                  :class="{ 'nav__link--active': current?.path === child.path }"
                  :to="child.path"
                >
                  <i v-if="child.icon" class="nav__dot" aria-hidden="true" />
                  <span v-if="!collapsed">{{ child.title }}</span>
                </NuxtLink>
              </li>
            </ul>

            <NuxtLink
              v-else
              class="nav__link"
              :class="{ 'nav__link--active': current?.path === item.path }"
              :to="item.path"
            >
              <i v-if="item.icon" class="nav__dot" aria-hidden="true" />
              <span v-if="!collapsed">{{ item.title }}</span>
            </NuxtLink>
          </li>
        </ul>
      </nav>
    </aside>

    <div class="admin__body">
      <header class="admin__header">
        <button class="admin__fold" type="button" @click="collapsed = !collapsed">
          {{ collapsed ? '»' : '«' }}
        </button>

        <ol class="crumbs">
          <li v-for="c in breadcrumb" :key="c.path">{{ c.title }}</li>
        </ol>

        <details class="user">
          <summary class="user__trigger">
            <span class="user__avatar">{{ user?.displayName?.slice(0, 1) }}</span>
            <span>{{ user?.displayName }}</span>
          </summary>
          <div class="user__panel">
            <button type="button" @click="onLogout">
              退出登录
            </button>
          </div>
        </details>
      </header>

      <main class="admin__main">
        <slot />
      </main>
    </div>

    <div class="toasts" role="status" aria-live="polite">
      <div
        v-for="t in toasts"
        :key="t.id"
        class="toast"
        :class="`toast--${t.level}`"
      >
        {{ t.text }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.admin { display: flex; min-height: 100vh; background: var(--bg-subtle); }

.admin__aside {
  width: 220px; flex: none;
  background: var(--bg);
  border-right: 1px solid var(--border);
  transition: width .18s ease;
}
.admin__aside--rail { width: 64px; }
.admin__brand {
  height: 56px; display: grid; place-items: center;
  font-weight: 600; letter-spacing: .04em;
}

.nav { padding: var(--sp-2); }
.nav__list { list-style: none; margin: 0; padding: 0; }
.nav__group + .nav__group { margin-top: var(--sp-1); }
.nav__title {
  display: flex; align-items: center; gap: var(--sp-2);
  padding: var(--sp-2) 10px; font-size: 13px; color: var(--fg-muted);
}
.nav__link {
  display: flex; align-items: center; gap: var(--sp-2);
  padding: var(--sp-2) 10px; border-radius: 6px;
  color: var(--fg); text-decoration: none; font-size: 14px;
}
.nav__link:hover { background: var(--bg-subtle); }
.nav__link--active { background: var(--brand-50); color: var(--brand-700); font-weight: 600; }
.nav__dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: currentcolor; opacity: .45;
}

.admin__body { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.admin__header {
  display: flex; align-items: center; gap: var(--sp-4);
  height: 56px; padding: 0 var(--sp-4);
  background: var(--bg); border-bottom: 1px solid var(--border);
}
.admin__fold {
  border: 1px solid var(--border);
  background: var(--bg); border-radius: 6px;
  width: 32px; height: 32px; cursor: pointer; color: var(--fg);
}
.crumbs {
  flex: 1; display: flex; gap: var(--sp-2);
  list-style: none; margin: 0; padding: 0;
  font-size: 13px; color: var(--fg-muted);
}
.crumbs li + li::before { content: "/ "; opacity: .5; }

.user { position: relative; }
.user__trigger {
  display: flex; align-items: center; gap: var(--sp-2);
  cursor: pointer; list-style: none; font-size: 14px;
}
.user__avatar {
  width: 28px; height: 28px; border-radius: 50%;
  display: grid; place-items: center;
  background: var(--brand-50); color: var(--brand-700); font-size: 13px;
}
.user__panel {
  position: absolute; right: 0; top: 120%;
  background: var(--bg); border: 1px solid var(--border);
  border-radius: var(--radius); padding: var(--sp-1); min-width: 120px;
  box-shadow: 0 8px 24px rgb(0 0 0 / 8%);
}
.user__panel button {
  width: 100%; text-align: left;
  border: 0; background: none; padding: var(--sp-2) 10px;
  border-radius: 6px; cursor: pointer; font-size: 14px; color: var(--fg);
}
.user__panel button:hover { background: var(--bg-subtle); }

.admin__main { flex: 1; padding: var(--sp-6); }

.toasts {
  position: fixed; top: var(--sp-4); right: var(--sp-4);
  display: grid; gap: var(--sp-2); z-index: 50;
}
.toast {
  padding: 10px 14px; border-radius: var(--radius); font-size: 14px;
  background: var(--bg); border: 1px solid var(--border);
  box-shadow: 0 8px 24px rgb(0 0 0 / 8%);
}
.toast--error { border-color: var(--danger); color: var(--danger); background: var(--danger-bg); }
.toast--success { border-color: var(--brand-500); color: var(--brand-700); }
.toast--warning { border-color: var(--warn); color: var(--warn); background: var(--warn-bg); }
</style>
