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
  <el-card shadow="never" class="boot">
    <p class="boot__text">
      正在进入 {{ APP_TITLE }}…
    </p>
  </el-card>
</template>

<style scoped>
.boot { max-width: 320px; margin: 48px auto; }
.boot__text { margin: 0; font-size: 14px; color: var(--el-text-color-secondary); }
</style>
