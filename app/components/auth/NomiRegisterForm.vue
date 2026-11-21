<script setup lang="ts">
/**
 * 注册表单（对应文档 src/views/auth/register/index.vue 的「换芯」部分）。
 *
 * 按 docs/注册页设计.md 第 18.1 节的修复版实现，并适配当前工程：
 *   · Nuxt 4 文件路由 + useI18n()/useLocalePath()，没有 vue-router 的具名路由；
 *   · 校验矩阵抽到 app/utils/register.ts（纯函数、可单测），这里只负责翻文案；
 *   · 真实调用 Nitro 的 /api/auth/register，不再是两层 setTimeout 的占位符；
 *   · 4 个字段、7 条规则、密码 → 确认密码联动、协议勾选、隐私政策弹窗；
 *   · 回车提交绑在整个 ElForm 上，切语言只清校验态不重建表单，定时器随卸载清理。
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import type { Directive } from 'vue';
import {
  ElButton,
  ElCheckbox,
  ElForm,
  ElFormItem,
  ElInput,
  ElMessage,
  type FormInstance,
  type FormItemRule,
  type FormRules,
} from 'element-plus';
import NomiIcon from '../layout/NomiIcon.vue';
import NomiPrivacyPolicy from './NomiPrivacyPolicy.vue';
import { fetchRegister } from '../../services/auth';
import {
  clearRegisterDraft,
  createEmptyDraft,
  POLICY_VERSION,
  readRegisterDraft,
  REDIRECT_DELAY,
  registerErrorCode,
  saveRegisterDraft,
  USERNAME_MAX_LENGTH,
  validateRegisterField,
  type RegisterDraft,
  type RegisterField,
} from '../../utils/register';

const { t, locale } = useI18n();
const localePath = useLocalePath();

const formRef = ref<FormInstance>();
const form = reactive<RegisterDraft>(createEmptyDraft());
const loading = ref(false);
const policyVisible = ref(false);

// 所有异步任务都登记在这里，组件卸载时统一清理（文档 17.1 / 15.7）。
let redirectTimer: ReturnType<typeof setTimeout> | undefined;
onBeforeUnmount(() => {
  if (redirectTimer) clearTimeout(redirectTimer);
});

// 切语言是一次真实导航，页面会重新挂载：恢复账号与协议勾选（密码不落盘）。
onMounted(() => {
  const saved = readRegisterDraft();
  if (!saved) return;
  form.username = saved.username;
  form.agreement = saved.agreement;
});

watch(
  [() => form.username, () => form.agreement],
  () => saveRegisterDraft({ username: form.username, agreement: form.agreement }),
);

// 文档 14.1 的 v-ripple：注册为组件内局部指令，不污染全局，也不用额外插件。
type RippleEl = HTMLElement & { __nomiRipple?: (event: PointerEvent) => void };
const vRipple: Directive<RippleEl> = {
  mounted(el) {
    const handler = (event: PointerEvent): void => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const rect = el.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      const ripple = document.createElement('span');
      ripple.className = 'nomi-register-ripple';
      ripple.style.width = `${size}px`;
      ripple.style.height = `${size}px`;
      ripple.style.left = `${event.clientX - rect.left - size / 2}px`;
      ripple.style.top = `${event.clientY - rect.top - size / 2}px`;
      el.appendChild(ripple);
      ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
    };
    el.__nomiRipple = handler;
    el.addEventListener('pointerdown', handler);
  },
  unmounted(el) {
    if (el.__nomiRipple) el.removeEventListener('pointerdown', el.__nomiRipple);
  },
};

// computed 而非普通对象：切语言后错误文案会一起重新求值（文档 2.5）。
const rules = computed<FormRules<RegisterDraft>>(() => {
  const ruleFor = (field: RegisterField): FormItemRule => ({
    validator: (_rule, _value, callback) => {
      const violation = validateRegisterField(field, form);
      if (violation) callback(new Error(t(violation.key, violation.params ?? {})));
      else callback();
    },
    trigger: field === 'agreement' ? 'change' : 'blur',
  });

  return {
    username: [ruleFor('username')],
    password: [ruleFor('password')],
    confirmPassword: [ruleFor('confirmPassword')],
    agreement: [ruleFor('agreement')],
  };
});

// 只清校验态，保留已填内容与焦点（文档 18.1 修 17.5，不再 formKey++）。
watch(locale, () => {
  formRef.value?.clearValidate();
});

/** 主密码失焦时联动重校验确认密码，并吞掉 rejection 避免 Uncaught (in promise)。 */
function revalidateConfirm(): void {
  if (!form.confirmPassword) return;
  void formRef.value?.validateField('confirmPassword').catch(() => {});
}

function acceptPolicy(): void {
  form.agreement = true;
  void formRef.value?.validateField('agreement').catch(() => {});
}

async function submit(): Promise<void> {
  // 提交期间（含跳转等待期）整体加锁，不允许重复提交（文档 17.1）。
  if (!formRef.value || loading.value || redirectTimer) return;

  // 校验失败是正常交互：不进 catch、不打错误日志（文档 17.2）。
  const valid = await formRef.value.validate().catch(() => false);
  if (!valid) return;

  loading.value = true;
  try {
    await fetchRegister({
      userName: form.username.trim(),
      password: form.password,
      agreement: form.agreement,
      policyVersion: POLICY_VERSION,
      agreedAt: new Date().toISOString(),
    });

    // 成功后立刻清掉内存里的两个明文密码（文档 17.21）。
    form.password = '';
    form.confirmPassword = '';
    clearRegisterDraft();

    ElMessage.success(t('register.success'));
    redirectTimer = setTimeout(() => {
      redirectTimer = undefined;
      loading.value = false;
      void navigateTo({ path: localePath('/login'), query: { username: form.username.trim() } });
    }, REDIRECT_DELAY);
  } catch (error) {
    loading.value = false;
    // 业务码本地化，避免把服务端中文 msg 直接糊到英文界面上。
    ElMessage.error(
      registerErrorCode(error) === 409 ? t('register.conflict') : t('register.failed'),
    );
  }
}
</script>

<template>
  <ElForm
    ref="formRef"
    class="nomi-register-form"
    :model="form"
    :rules="rules"
    @keyup.enter="submit"
  >
    <ElFormItem prop="username">
      <ElInput
        v-model.trim="form.username"
        class="auth-control nomi-register-field"
        :maxlength="USERNAME_MAX_LENGTH"
        :placeholder="t('register.placeholder.username')"
        autocomplete="username"
      >
        <template #prefix><NomiIcon name="user" :size="16" /></template>
      </ElInput>
    </ElFormItem>

    <ElFormItem prop="password">
      <ElInput
        v-model="form.password"
        class="auth-control nomi-register-field"
        type="password"
        show-password
        autocomplete="new-password"
        :placeholder="t('register.placeholder.password')"
        @blur="revalidateConfirm"
      >
        <template #prefix><NomiIcon name="lock" :size="16" /></template>
      </ElInput>
    </ElFormItem>

    <ElFormItem prop="confirmPassword">
      <ElInput
        v-model="form.confirmPassword"
        class="auth-control nomi-register-field"
        type="password"
        show-password
        autocomplete="new-password"
        :placeholder="t('register.placeholder.confirmPassword')"
      >
        <template #prefix><NomiIcon name="shield" :size="16" /></template>
      </ElInput>
    </ElFormItem>

    <!-- 链接移出 ElCheckbox 的 label：点它只开弹窗，不会误勾选、也不会跳 404。 -->
    <ElFormItem prop="agreement">
      <div class="nomi-register-agreement">
        <ElCheckbox v-model="form.agreement">{{ t('register.agreeText') }}</ElCheckbox>
        <button
          type="button"
          class="nomi-register-policy-link"
          @click.stop.prevent="policyVisible = true"
        >
          {{ t('register.privacyPolicy') }}
        </button>
      </div>
    </ElFormItem>

    <div class="nomi-register-submit">
      <ElButton
        v-ripple
        type="primary"
        class="auth-control nomi-register-submit-btn"
        :loading="loading"
        @click="submit"
      >
        {{ t('register.submitBtnText') }}
      </ElButton>
    </div>

    <div class="nomi-register-footer">
      <span>{{ t('register.hasAccount') }}</span>
      <NuxtLink class="auth-link" :to="localePath('/login')">{{ t('register.toLogin') }}</NuxtLink>
    </div>

    <p class="nomi-register-hint">{{ t('register.hint') }}</p>
  </ElForm>

  <NomiPrivacyPolicy v-model="policyVisible" @accept="acceptPolicy" />
</template>
