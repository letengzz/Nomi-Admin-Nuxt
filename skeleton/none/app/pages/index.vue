<script setup lang="ts">
import { APP_TITLE } from '~/config/env'

/**
 * 首页只做一件事：把用户送到「第一个可见菜单项」。
 * 目标来自 useMenu().firstPath —— 菜单是单一来源，这里不再拼一份默认路径。
 */
const { firstPath } = useMenu()

await navigateTo(firstPath.value, { replace: true })
</script>

<template>
  <section class="card boot">
    <h2 class="boot__title">
      正在进入 {{ APP_TITLE }}…
    </h2>
  </section>
</template>

<style scoped>
.boot { max-width: 320px; margin: 48px auto; }
.boot__title { margin: 0; font-size: 15px; font-weight: 500; color: var(--fg-muted); }

.card {
  padding: var(--sp-6);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
}
</style>
