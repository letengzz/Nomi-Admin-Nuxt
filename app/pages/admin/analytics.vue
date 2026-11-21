<script setup lang="ts">
import { computed } from 'vue';
import NomiIcon from '../../components/layout/NomiIcon.vue';

definePageMeta({ layout: 'admin', keepalive: true });
defineOptions({ name: 'NomiAdminAnalytics' });

const { t } = useI18n();
useHead({ title: computed(() => t('layout.menu.analytics')) });

// 表格外观偏好来自 table store（docs/状态管理.md 第 6 章）。
const { tableClass } = useTableStyle();

const metrics = [
  { key: 'pv', value: '48,920', icon: 'eye' },
  { key: 'uv', value: '12,486', icon: 'users' },
  { key: 'duration', value: '04:32', icon: 'clock' },
  { key: 'bounce', value: '23.8%', icon: 'trending' },
] as const;

const bars = [46, 62, 55, 78, 68, 92, 84, 70, 96, 88, 74, 100];
const channels = [
  { key: 'organic', value: '18,420', percent: 82 },
  { key: 'direct', value: '9,860', percent: 56 },
  { key: 'social', value: '5,240', percent: 34 },
  { key: 'ads', value: '3,180', percent: 22 },
] as const;
</script>

<template>
  <div>
    <div class="nomi-page-toolbar nomi-page-toolbar--end">
      <button type="button" class="nomi-btn"><NomiIcon name="refresh" :size="15" />{{ t('layout.header.refresh') }}</button>
      <button type="button" class="nomi-btn nomi-btn--primary"><NomiIcon name="external" :size="15" />{{ t('layout.analytics.export') }}</button>
    </div>

    <div class="nomi-grid nomi-grid--4">
      <div v-for="metric in metrics" :key="metric.key" class="page-content nomi-stat">
        <div class="nomi-stat-top">
          <span class="nomi-stat-label">{{ t(`layout.analytics.${metric.key}`) }}</span>
          <span class="nomi-stat-icon"><NomiIcon :name="metric.icon" :size="19" /></span>
        </div>
        <strong class="nomi-stat-value">{{ metric.value }}</strong>
        <div class="nomi-stat-foot"><span class="nomi-trend--up">+6.4%</span><span>{{ t('layout.dashboard.vsLastWeek') }}</span></div>
      </div>
    </div>

    <div class="nomi-grid nomi-grid--main analytics-gap">
      <section class="page-content">
        <div class="nomi-panel-head">
          <h2>{{ t('layout.analytics.trend') }}</h2>
          <span>{{ t('layout.analytics.year') }}</span>
        </div>
        <div class="analytics-bars">
          <div v-for="(height, index) in bars" :key="index" class="analytics-bar-col">
            <i :style="{ height: `${height}%` }" />
            <span>{{ index + 1 }}</span>
          </div>
        </div>
      </section>

      <section class="page-content">
        <div class="nomi-panel-head">
          <h2>{{ t('layout.dashboard.source.title') }}</h2>
        </div>
        <div class="nomi-table-wrap">
          <table class="nomi-table" :class="tableClass">
            <thead>
              <tr>
                <th>{{ t('layout.analytics.channel') }}</th>
                <th>{{ t('layout.analytics.visits') }}</th>
                <th>{{ t('layout.analytics.share') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="channel in channels" :key="channel.key">
                <td>{{ t(`layout.analytics.channels.${channel.key}`) }}</td>
                <td>{{ channel.value }}</td>
                <td>
                  <div class="nomi-bar"><i :style="{ width: `${channel.percent}%` }" /></div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.analytics-gap {
  margin-top: 16px;
}

.analytics-bars {
  display: flex;
  height: 220px;
  align-items: flex-end;
  gap: 8px;
  padding-top: 12px;
  border-bottom: 1px solid var(--nomi-border);
}

.analytics-bar-col {
  display: flex;
  height: 100%;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}

.analytics-bar-col i {
  display: block;
  width: 100%;
  max-width: 26px;
  background: color-mix(in srgb, var(--el-color-primary) 75%, transparent);
  border-radius: 5px 5px 0 0;
  transition: background-color 0.18s var(--ease);
}

.analytics-bar-col:hover i {
  background: var(--el-color-primary);
}

.analytics-bar-col span {
  color: var(--fg-muted);
  font-size: 10px;
}
</style>
