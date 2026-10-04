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

    <el-row :gutter="16">
      <el-col v-for="s in stats" :key="s.label" :span="8">
        <el-card shadow="never">
          <div class="stat__label">
            {{ s.label }}
          </div>
          <div class="stat__value">
            {{ s.value }}
          </div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<style scoped>
.page__title { margin: 0 0 4px; font-size: 18px; }
.page__desc { margin: 0 0 16px; font-size: 13px; color: #6b7280; }
.stat__label { font-size: 13px; color: #6b7280; }
.stat__value { margin-top: 6px; font-size: 22px; font-weight: 600; }
</style>
