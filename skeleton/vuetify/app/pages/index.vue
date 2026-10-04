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
  <v-card max-width="320" class="mx-auto mt-12" variant="outlined">
    <v-card-text class="text-body-2 text-medium-emphasis">
      正在进入 {{ APP_TITLE }}…
    </v-card-text>
  </v-card>
</template>
