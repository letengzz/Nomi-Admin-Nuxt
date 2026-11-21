<script setup lang="ts">
import { computed, ref } from 'vue';
import NomiIcon from '../../../components/layout/NomiIcon.vue';

definePageMeta({ layout: 'admin', keepalive: true });
defineOptions({ name: 'NomiAdminOrders' });

const { t } = useI18n();
useHead({ title: computed(() => t('layout.menu.orders')) });

// 表格外观偏好来自 table store（docs/状态管理.md 第 6 章）。
const { tableClass } = useTableStyle();

const filters = ['all', 'pending', 'paid', 'shipped', 'done'] as const;
type Filter = (typeof filters)[number];
const active = ref<Filter>('all');

const orders = [
  { id: 'NO-24018', customer: 'layout.dashboard.demo.a', amount: '¥3,280', status: 'paid', date: '2026-11-13' },
  { id: 'NO-24017', customer: 'layout.dashboard.demo.b', amount: '¥1,860', status: 'shipped', date: '2026-11-12' },
  { id: 'NO-24016', customer: 'layout.dashboard.demo.c', amount: '¥920', status: 'pending', date: '2026-11-12' },
  { id: 'NO-24015', customer: 'layout.dashboard.demo.d', amount: '¥5,640', status: 'done', date: '2026-11-11' },
  { id: 'NO-24014', customer: 'layout.dashboard.demo.e', amount: '¥760', status: 'pending', date: '2026-11-10' },
  { id: 'NO-24013', customer: 'layout.dashboard.demo.a', amount: '¥2,140', status: 'done', date: '2026-11-09' },
] as const;

const visibleOrders = computed(() =>
  active.value === 'all' ? orders : orders.filter((order) => order.status === active.value),
);

function openDetail(): void {
  void navigateTo('/admin/orders/detail');
}
</script>

<template>
  <div>
    <section class="page-content">
      <div class="nomi-page-toolbar nomi-page-toolbar--end">
        <button type="button" class="nomi-btn" @click="openDetail">
          <NomiIcon name="file" :size="15" />{{ t('layout.orders.detailEntry') }}
        </button>
        <button type="button" class="nomi-btn nomi-btn--primary"><NomiIcon name="plus" :size="15" />{{ t('layout.dashboard.newOrder') }}</button>
      </div>
      <div class="orders-filters">
        <button
          v-for="filter in filters"
          :key="filter"
          type="button"
          class="orders-filter"
          :class="{ 'is-active': active === filter }"
          @click="active = filter"
        >
          {{ t(`layout.orders.filter.${filter}`) }}
        </button>
      </div>

      <div class="nomi-table-wrap">
        <table class="nomi-table" :class="tableClass">
          <thead>
            <tr>
              <th>{{ t('layout.dashboard.table.order') }}</th>
              <th>{{ t('layout.dashboard.table.customer') }}</th>
              <th>{{ t('layout.dashboard.table.amount') }}</th>
              <th>{{ t('layout.orders.table.date') }}</th>
              <th>{{ t('layout.dashboard.table.status') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="order in visibleOrders" :key="order.id">
              <td><code>{{ order.id }}</code></td>
              <td>{{ t(order.customer) }}</td>
              <td>{{ order.amount }}</td>
              <td>{{ order.date }}</td>
              <td>
                <span class="nomi-tag" :class="`nomi-tag--${order.status === 'done' ? 'success' : order.status === 'pending' ? 'warn' : 'primary'}`">
                  {{ t(`layout.orders.status.${order.status}`) }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="visibleOrders.length === 0" class="nomi-empty">{{ t('layout.search.empty') }}</p>
    </section>
  </div>
</template>

<style scoped>
.orders-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 16px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--nomi-border);
}

.orders-filter {
  padding: 6px 12px;
  color: var(--fg-muted);
  background: var(--bg-subtle);
  border: 1px solid transparent;
  border-radius: 999px;
  font-size: 12px;
  cursor: pointer;
}

.orders-filter:hover,
.orders-filter.is-active {
  color: var(--el-color-primary);
  background: var(--nomi-hover);
  border-color: color-mix(in srgb, var(--el-color-primary) 28%, transparent);
}

.nomi-table-wrap {
  overflow-x: auto;
}
</style>
