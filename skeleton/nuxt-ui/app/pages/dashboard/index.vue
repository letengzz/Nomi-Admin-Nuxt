<script setup lang="ts">
import { APP_TITLE } from '~/config/env'

const { user } = useAuth()

const stats = [
  { label: '今日访问', value: '1,284' },
  { label: '待处理工单', value: '7' },
  { label: '在线用户', value: '32' },
]
</script>

<template>
  <div>
    <h2 class="text-lg font-semibold">
      {{ APP_TITLE }} · 仪表盘
    </h2>
    <p class="mt-1 mb-4 text-sm text-muted">
      当前登录：{{ user?.displayName }}（{{ user?.roles.join(' / ') }}）
    </p>

    <div class="grid gap-4 sm:grid-cols-3">
      <UCard v-for="s in stats" :key="s.label">
        <div class="text-sm text-muted">
          {{ s.label }}
        </div>
        <div class="mt-1.5 text-2xl font-semibold">
          {{ s.value }}
        </div>
      </UCard>
    </div>
  </div>
</template>
