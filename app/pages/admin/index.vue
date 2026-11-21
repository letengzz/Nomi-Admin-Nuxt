<script setup lang="ts">
/**
 * 后台主页面 / 仪表盘。
 *
 * 这一页只负责业务内容，外围壳全部由 layouts/admin.vue 提供 —— 对应文档
 * 第 1.2 节「三层壳」里的第三个 RouterView 渲染的真正业务页面。
 */
import { computed } from 'vue';
import NomiIcon from '../../components/layout/NomiIcon.vue';

definePageMeta({ layout: 'admin', keepalive: true });
defineOptions({ name: 'NomiAdminDashboard' });

const { t, locale } = useI18n();
useHead({ title: computed(() => t('layout.menu.dashboard')) });

// 表格外观偏好来自 table store（docs/状态管理.md 第 6 章）。
const { tableClass } = useTableStyle();

function openReport(): void {
  void navigateTo('/admin/analytics');
}

const today = computed(() =>
  new Intl.DateTimeFormat(locale.value === 'en' ? 'en-US' : 'zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date()),
);

const stats = [
  { key: 'revenue', icon: 'wallet', value: '¥128,430', trend: '+12.5%', up: true },
  { key: 'users', icon: 'users', value: '8,942', trend: '+8.2%', up: true },
  { key: 'orders', icon: 'orders', value: '1,284', trend: '-2.1%', up: false },
  { key: 'conversion', icon: 'trending', value: '68.4%', trend: '+4.3%', up: true },
] as const;

const sources = [
  { key: 'direct', value: 42 },
  { key: 'search', value: 28 },
  { key: 'social', value: 19 },
  { key: 'referral', value: 11 },
] as const;

const orders = [
  { id: '#NO-24018', customer: 'layout.dashboard.demo.a', amount: '¥3,280', status: 'paid' },
  { id: '#NO-24017', customer: 'layout.dashboard.demo.b', amount: '¥1,860', status: 'shipped' },
  { id: '#NO-24016', customer: 'layout.dashboard.demo.c', amount: '¥920', status: 'pending' },
  { id: '#NO-24015', customer: 'layout.dashboard.demo.d', amount: '¥5,640', status: 'paid' },
  { id: '#NO-24014', customer: 'layout.dashboard.demo.e', amount: '¥760', status: 'pending' },
] as const;

const todos = [
  { icon: 'orders', key: 'todo1', tag: 'urgent' },
  { icon: 'users', key: 'todo2', tag: 'normal' },
  { icon: 'shield', key: 'todo3', tag: 'normal' },
  { icon: 'sparkles', key: 'todo4', tag: 'done' },
] as const;
</script>

<template>
  <div class="nomi-dashboard">
    <div class="nomi-page-head">
      <div>
        <h1>{{ t('layout.dashboard.title') }}</h1>
        <p>{{ t('layout.dashboard.subtitle') }} · {{ today }}</p>
      </div>
      <div class="nomi-page-actions">
        <button type="button" class="nomi-btn" @click="openReport">
          <NomiIcon name="chart" :size="16" />
          {{ t('layout.dashboard.report') }}
        </button>
        <NuxtLink to="/admin/orders" class="nomi-btn nomi-btn--primary">
          <NomiIcon name="plus" :size="16" />
          {{ t('layout.dashboard.newOrder') }}
        </NuxtLink>
      </div>
    </div>

    <div class="nomi-grid nomi-grid--4">
      <div v-for="stat in stats" :key="stat.key" class="page-content nomi-stat">
        <div class="nomi-stat-top">
          <span class="nomi-stat-label">{{ t(`layout.dashboard.stats.${stat.key}`) }}</span>
          <span class="nomi-stat-icon"><NomiIcon :name="stat.icon" :size="19" /></span>
        </div>
        <strong class="nomi-stat-value">{{ stat.value }}</strong>
        <div class="nomi-stat-foot">
          <span :class="stat.up ? 'nomi-trend--up' : 'nomi-trend--down'">{{ stat.trend }}</span>
          <span>{{ t('layout.dashboard.vsLastWeek') }}</span>
        </div>
      </div>
    </div>

    <div class="nomi-grid nomi-grid--main nomi-dashboard-gap">
      <section class="page-content">
        <div class="nomi-panel-head">
          <h2>{{ t('layout.dashboard.traffic.title') }}</h2>
          <span>{{ t('layout.dashboard.traffic.range') }}</span>
        </div>
        <svg class="nomi-chart" viewBox="0 0 640 220" preserveAspectRatio="none" role="img" :aria-label="t('layout.dashboard.traffic.title')">
          <defs>
            <linearGradient id="nomi-area-gradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="var(--el-color-primary)" stop-opacity="0.26" />
              <stop offset="100%" stop-color="var(--el-color-primary)" stop-opacity="0" />
            </linearGradient>
          </defs>
          <g stroke="var(--nomi-border)" stroke-width="1">
            <line v-for="y in [40, 85, 130, 175]" :key="y" x1="0" :y1="y" x2="640" :y2="y" />
          </g>
          <path
            d="M0 168 C40 150 70 158 105 128 S175 92 215 112 S285 150 325 118 S395 60 435 82 S505 120 545 84 S605 46 640 58 L640 220 L0 220 Z"
            fill="url(#nomi-area-gradient)"
          />
          <path
            d="M0 168 C40 150 70 158 105 128 S175 92 215 112 S285 150 325 118 S395 60 435 82 S505 120 545 84 S605 46 640 58"
            fill="none"
            stroke="var(--el-color-primary)"
            stroke-width="2.5"
            stroke-linecap="round"
          />
          <circle cx="435" cy="82" r="4.5" fill="var(--el-color-primary)" stroke="var(--bg)" stroke-width="2" />
        </svg>
        <div class="nomi-chart-axis">
          <span v-for="day in 7" :key="day">{{ t(`layout.dashboard.traffic.day${day}`) }}</span>
        </div>
      </section>

      <section class="page-content">
        <div class="nomi-panel-head">
          <h2>{{ t('layout.dashboard.source.title') }}</h2>
          <span>{{ t('layout.dashboard.traffic.range') }}</span>
        </div>
        <div class="nomi-list">
          <div v-for="source in sources" :key="source.key" class="nomi-source">
            <div class="nomi-source-head">
              <span>{{ t(`layout.dashboard.source.${source.key}`) }}</span>
              <strong>{{ source.value }}%</strong>
            </div>
            <div class="nomi-bar"><i :style="{ width: `${source.value}%` }" /></div>
          </div>
        </div>
      </section>
    </div>

    <div class="nomi-grid nomi-grid--main nomi-dashboard-gap">
      <section class="page-content">
        <div class="nomi-panel-head">
          <h2>{{ t('layout.dashboard.recentOrders') }}</h2>
          <NuxtLink to="/admin/orders" class="nomi-link">{{ t('layout.dashboard.viewAll') }}</NuxtLink>
        </div>
        <div class="nomi-table-wrap">
          <table class="nomi-table" :class="tableClass">
            <thead>
              <tr>
                <th>{{ t('layout.dashboard.table.order') }}</th>
                <th>{{ t('layout.dashboard.table.customer') }}</th>
                <th>{{ t('layout.dashboard.table.amount') }}</th>
                <th>{{ t('layout.dashboard.table.status') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="order in orders" :key="order.id">
                <td><code>{{ order.id }}</code></td>
                <td>{{ t(order.customer) }}</td>
                <td>{{ order.amount }}</td>
                <td>
                  <span class="nomi-tag" :class="`nomi-tag--${order.status === 'pending' ? 'warn' : order.status === 'paid' ? 'success' : 'primary'}`">
                    {{ t(`layout.dashboard.status.${order.status}`) }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="page-content">
        <div class="nomi-panel-head">
          <h2>{{ t('layout.dashboard.todo') }}</h2>
          <span>{{ todos.length }}</span>
        </div>
        <div class="nomi-list">
          <div v-for="todo in todos" :key="todo.key" class="nomi-list-item nomi-todo">
            <span class="nomi-todo-icon"><NomiIcon :name="todo.icon" :size="16" /></span>
            <span>{{ t(`layout.dashboard.${todo.key}`) }}</span>
            <span class="nomi-tag" :class="`nomi-tag--${todo.tag === 'urgent' ? 'warn' : todo.tag === 'done' ? 'success' : 'primary'}`">
              {{ t(`layout.dashboard.tag.${todo.tag}`) }}
            </span>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.nomi-dashboard-gap {
  margin-top: 16px;
}

.nomi-chart {
  display: block;
  width: 100%;
  height: 200px;
}

.nomi-chart-axis {
  display: flex;
  justify-content: space-between;
  margin-top: 8px;
  color: var(--fg-muted);
  font-size: 11px;
}

.nomi-source {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.nomi-source-head {
  display: flex;
  justify-content: space-between;
  color: var(--fg-muted);
  font-size: 13px;
}

.nomi-source-head strong {
  color: var(--fg);
}

.nomi-link {
  color: var(--el-color-primary);
  font-size: 12px;
  text-decoration: none;
}

.nomi-table-wrap {
  overflow-x: auto;
}

.nomi-todo-icon {
  display: inline-flex;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  color: var(--el-color-primary);
  background: var(--nomi-hover);
  border-radius: 8px;
}

.nomi-todo {
  padding-bottom: 12px;
  border-bottom: 1px solid var(--nomi-border);
}

.nomi-todo:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}
</style>
