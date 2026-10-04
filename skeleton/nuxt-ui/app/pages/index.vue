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
  <UCard class="mx-auto mt-12 max-w-80">
    <p class="text-sm text-muted">
      正在进入 {{ APP_TITLE }}…
    </p>
  </UCard>
</template>
