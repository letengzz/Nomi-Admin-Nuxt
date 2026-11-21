<script setup lang="ts">
/**
 * 维护模式提示页。
 *
 * 只有被系统配置挡下来的普通用户会看到；超管仍能进后台把开关关掉。
 * 不引用后台布局：维护时侧栏和顶栏本来就不该出现。
 */
import { computed } from 'vue';
import { ElButton } from 'element-plus';

defineOptions({ name: 'NomiMaintenancePage' });

const { t } = useI18n();
useHead({ title: computed(() => t('maintenance.pageTitle')) });

function backToLogin(): void {
  void navigateTo('/login');
}
</script>

<template>
  <div class="maintenance-page">
    <div class="maintenance-card">
      <div class="maintenance-mark" aria-hidden="true">✦</div>
      <h1>{{ t('maintenance.title') }}</h1>
      <p class="maintenance-desc">{{ t('maintenance.description') }}</p>
      <p class="maintenance-hint">{{ t('maintenance.adminHint') }}</p>
      <ElButton type="primary" @click="backToLogin">{{ t('maintenance.back') }}</ElButton>
    </div>
  </div>
</template>

<style scoped>
.maintenance-page {
  display: flex;
  min-height: 100vh;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--bg-subtle, #f8fafc);
}

.maintenance-card {
  width: min(460px, 100%);
  padding: 40px 32px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--bg, #fff);
  box-shadow: var(--nomi-shadow, 0 6px 22px rgb(15 23 42 / 8%));
  text-align: center;
}

.maintenance-mark {
  display: flex;
  width: 56px;
  height: 56px;
  align-items: center;
  justify-content: center;
  margin: 0 auto 18px;
  border-radius: 16px;
  background: color-mix(in srgb, var(--el-color-primary) 12%, transparent);
  color: var(--el-color-primary);
  font-size: 26px;
}

.maintenance-card h1 {
  margin: 0 0 10px;
  font-size: 21px;
  font-weight: 600;
}

.maintenance-desc {
  margin: 0;
  color: var(--fg-muted);
  font-size: 14px;
  line-height: 1.7;
}

.maintenance-hint {
  margin: 14px 0 24px;
  color: var(--fg-muted);
  font-size: 12px;
}
</style>
