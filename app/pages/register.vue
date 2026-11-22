<script setup lang="ts">
/**
 * 注册页：与登录页共用同一套授权页外壳（docs/注册页设计.md 2.1）。
 *
 * 「薄页面 + 厚共用资产」：这里只负责外壳、标题和页面 title，
 * 四个字段与全部校验/提交逻辑都在 NomiRegisterForm 里；
 * 外壳样式统一来自 app/assets/styles/auth.scss，三页不再互相 import。
 */
import { computed, onMounted, ref } from 'vue';
import { ElButton } from 'element-plus';
import NomiAuthBrandPanel from '../components/auth/NomiAuthBrandPanel.vue';
import NomiAuthTopBar from '../components/auth/NomiAuthTopBar.vue';
import NomiRegisterForm from '../components/auth/NomiRegisterForm.vue';
import { fetchLoginConfig } from '../services/system-config';

const { t } = useI18n();
const localePath = useLocalePath();
const ready = ref(false);
const registrationEnabled = ref(false);

// 服务端注册接口也会挡一次；这里提前收起表单，避免填完才提示「未开放」。
onMounted(async () => {
  const config = await fetchLoginConfig();
  registrationEnabled.value = config.registrationEnabled;
  ready.value = true;
});

function toLogin(): void {
  void navigateTo(localePath('/login'));
}

// 文档 22.1：浏览器标签标题随语言切换；computed 保证 locale 变化即刻重算。
useHead({ title: computed(() => t('register.pageTitle')) });
</script>

<template>
  <div class="auth-page">
    <NomiAuthBrandPanel />

    <div class="auth-panel">
      <NomiAuthTopBar />

      <div class="auth-wrap auth-wrap--register">
        <div v-if="!ready" class="auth-form auth-form--state">
          <div class="register-state">{{ t('app.loading') }}</div>
        </div>

        <div v-else-if="!registrationEnabled" class="auth-form auth-form--state">
          <div class="register-state register-state--closed">
            <h2>{{ t('register.closedTitle') }}</h2>
            <p>{{ t('register.closedDescription') }}</p>
            <ElButton type="primary" @click="toLogin">{{ t('register.backToLogin') }}</ElButton>
          </div>
        </div>

        <div v-else class="auth-form auth-form--register">
          <h1 class="auth-title">{{ t('register.title') }}</h1>
          <p class="auth-subtitle">{{ t('register.subTitle') }}</p>

          <NomiRegisterForm />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.register-state {
  width: 100%;
  padding: 32px 8px;
  color: var(--fg-muted);
  font-size: 13px;
  text-align: center;
}

.register-state--closed h2 {
  margin: 0 0 10px;
  color: var(--fg);
  font-size: 19px;
  font-weight: 600;
}

.register-state--closed p {
  margin: 0 0 24px;
  line-height: 1.7;
}
</style>
