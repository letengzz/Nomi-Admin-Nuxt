<script setup lang="ts">
import { computed } from 'vue';
import NomiIcon from '../../../components/layout/NomiIcon.vue';

// activePath 让侧栏高亮「订单列表」而不是详情页本身（文档第 6.2 节 L96）。
definePageMeta({ layout: 'admin', keepalive: false, activePath: '/admin/orders' });
defineOptions({ name: 'NomiAdminOrderDetail' });

const { t } = useI18n();
useHead({ title: computed(() => t('layout.menu.orderDetail')) });

const timeline = [
  { key: 'created', icon: 'plus', time: '2026-11-10 09:12', done: true },
  { key: 'paid', icon: 'wallet', time: '2026-11-10 09:18', done: true },
  { key: 'shipped', icon: 'orders', time: '2026-11-11 14:30', done: true },
  { key: 'delivering', icon: 'trending', time: '—', done: false },
] as const;

const goods = [
  { name: 'layout.orders.goods.a', qty: 2, price: '¥1,240' },
  { name: 'layout.orders.goods.b', qty: 1, price: '¥800' },
] as const;
</script>

<template>
  <div>
    <div class="nomi-page-toolbar nomi-page-toolbar--end">
      <NuxtLink to="/admin/orders" class="nomi-btn"><NomiIcon name="arrow-left" :size="15" />{{ t('layout.orders.back') }}</NuxtLink>
      <button type="button" class="nomi-btn nomi-btn--primary"><NomiIcon name="external" :size="15" />{{ t('layout.orders.export') }}</button>
    </div>

    <div class="nomi-grid nomi-grid--main">
      <section class="page-content">
        <div class="nomi-panel-head"><h2>{{ t('layout.orders.detail.goods') }}</h2></div>
        <table class="nomi-table">
          <thead>
            <tr>
              <th>{{ t('layout.orders.detail.item') }}</th>
              <th>{{ t('layout.orders.detail.qty') }}</th>
              <th>{{ t('layout.dashboard.table.amount') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="good in goods" :key="good.name">
              <td>{{ t(good.name) }}</td>
              <td>× {{ good.qty }}</td>
              <td>{{ good.price }}</td>
            </tr>
            <tr>
              <td colspan="2" style="text-align: right"><strong>{{ t('layout.orders.detail.total') }}</strong></td>
              <td><strong>¥3,280</strong></td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="page-content">
        <div class="nomi-panel-head"><h2>{{ t('layout.orders.detail.timeline') }}</h2></div>
        <div class="detail-timeline">
          <div v-for="(step, index) in timeline" :key="step.key" class="detail-step" :class="{ 'is-done': step.done }">
            <span class="detail-step-icon"><NomiIcon :name="step.icon" :size="15" /></span>
            <div>
              <strong>{{ t(`layout.orders.timeline.${step.key}`) }}</strong>
              <time>{{ step.time }}</time>
            </div>
            <i v-if="index < timeline.length - 1" class="detail-line" />
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.detail-timeline {
  display: flex;
  flex-direction: column;
}

.detail-step {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding-bottom: 22px;
}

.detail-step:last-child {
  padding-bottom: 0;
}

.detail-step-icon {
  display: inline-flex;
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  color: var(--fg-muted);
  background: var(--bg-subtle);
  border-radius: 50%;
}

.detail-step.is-done .detail-step-icon {
  color: #fff;
  background: var(--el-color-primary);
}

.detail-step strong {
  display: block;
  font-size: 13px;
  font-weight: 550;
}

.detail-step time {
  color: var(--fg-muted);
  font-size: 11px;
}

.detail-line {
  position: absolute;
  top: 32px;
  bottom: 2px;
  left: 14px;
  width: 1px;
  background: var(--nomi-border);
}
</style>
