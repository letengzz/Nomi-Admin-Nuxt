<script setup lang="ts">
/**
 * 忘记密码页：左品牌 / 右表单双栏，与登录、注册共用同一套授权页外壳。
 *
 * 「薄页面 + 厚共用资产」（docs/忘记密码页设计.md 2.1）：这里只负责外壳与页面标题，
 * 两步表单、校验、倒计时、接口调用全部在 NomiForgetPasswordForm 里，
 * 外壳样式统一来自 app/assets/styles/auth.scss，三页不再互相 import。
 */
import { computed } from 'vue';
import NomiAuthBrandPanel from '../components/auth/NomiAuthBrandPanel.vue';
import NomiAuthTopBar from '../components/auth/NomiAuthTopBar.vue';
import NomiForgetPasswordForm from '../components/auth/NomiForgetPasswordForm.vue';

const { t } = useI18n();

// 浏览器标签标题随语言切换；computed 保证 locale 变化即刻重算。
// 不拼接品牌名：@nuxtjs/seo 的 titleTemplate 会补上「| Nomi Admin」，与登录 / 注册页一致。
useHead({ title: computed(() => t('forgetPassword.pageTitle')) });
</script>

<template>
  <div class="auth-page">
    <NomiAuthBrandPanel />

    <div class="auth-panel">
      <NomiAuthTopBar />

      <div class="auth-wrap auth-wrap--forget">
        <div class="auth-form auth-form--forget">
          <NomiForgetPasswordForm />
        </div>
      </div>
    </div>
  </div>
</template>
