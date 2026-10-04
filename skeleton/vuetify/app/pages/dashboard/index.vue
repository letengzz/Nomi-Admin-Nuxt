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
    <h2 class="text-h6">
      {{ APP_TITLE }} · 仪表盘
    </h2>
    <p class="text-body-2 text-medium-emphasis mt-1 mb-4">
      当前登录：{{ user?.displayName }}（{{ user?.roles.join(' / ') }}）
    </p>

    <v-row>
      <v-col v-for="s in stats" :key="s.label" cols="12" sm="4">
        <v-card variant="outlined">
          <v-card-title class="text-body-2 text-medium-emphasis">
            {{ s.label }}
          </v-card-title>
          <v-card-text class="stat__value">
            {{ s.value }}
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </div>
</template>

<style scoped>
.stat__value { font-size: 22px; font-weight: 600; }
</style>
