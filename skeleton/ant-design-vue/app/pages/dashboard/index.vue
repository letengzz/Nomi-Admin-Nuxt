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
    <h2 class="page__title">
      {{ APP_TITLE }} · 仪表盘
    </h2>
    <p class="page__desc">
      当前登录：{{ user?.displayName }}（{{ user?.roles.join(' / ') }}）
    </p>

    <a-row :gutter="16">
      <a-col v-for="s in stats" :key="s.label" :span="8">
        <a-card :bordered="false" class="stat">
          <div class="stat__label">
            {{ s.label }}
          </div>
          <div class="stat__value">
            {{ s.value }}
          </div>
        </a-card>
      </a-col>
    </a-row>
  </div>
</template>

<style scoped>
.page__title { margin: 0 0 4px; font-size: 18px; }
.page__desc { margin: 0 0 16px; font-size: 13px; color: #6b7280; }
.stat { box-shadow: 0 1px 2px rgb(0 0 0 / 6%); }
.stat__label { font-size: 13px; color: #6b7280; }
.stat__value { margin-top: 6px; font-size: 22px; font-weight: 600; }
</style>
