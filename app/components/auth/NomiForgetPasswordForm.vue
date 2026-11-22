<script setup lang="ts">
/**
 * 忘记密码表单：账号 → 验证码 + 新密码，两步走。
 *
 * 对应 docs/忘记密码页设计.md 第 18.2 节的修复版实现，并按当前工程的技术栈落地：
 *   · Nuxt 4 文件路由 + useI18n()/useLocalePath()，没有 vue-router 的具名路由；
 *   · 校验矩阵抽到 app/utils/forget-password.ts（纯函数、可单测），组件只负责翻文案；
 *   · 真实调用 Nitro 的 /api/auth/password-code 与 /api/auth/password-reset，
 *     不再是模板里那个 `async () => {}` 的空函数；
 *   · 为什么是两步而不是三步：440×650 的表单盒内容区只有 560px，
 *     三步每步一屏会溢出（文档 17.7 / 18 章开头的预算）。两步合计约 470px，余量 ~90px。
 */
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import type { Directive } from 'vue';
import {
  ElButton,
  ElForm,
  ElFormItem,
  ElInput,
  ElMessage,
  type FormInstance,
  type FormItemRule,
  type FormRules,
} from 'element-plus';
import NomiIcon from '../layout/NomiIcon.vue';
import { fetchResetPassword, fetchSendResetCode, getErrorMessage } from '../../services/auth';
import { isDemoMode } from '../../utils/api';
import {
  CODE_LENGTH,
  COUNTDOWN_SECONDS,
  createEmptyForgetDraft,
  maskAccount,
  normalizeCode,
  FORGET_REDIRECT_DELAY,
  validateForgetField,
  type ForgetPasswordDraft,
  type ForgetPasswordField,
  type ForgetStep,
} from '../../utils/forget-password';

const { t, locale } = useI18n();
const localePath = useLocalePath();
/** 与登录页一致：「演示环境可用哪些账号」只在 GitHub Pages 静态站展示。 */
const isDemo = isDemoMode();

const formRef = ref<FormInstance>();
const draft = reactive<ForgetPasswordDraft>(createEmptyForgetDraft());

/** 1 = 收集账号；2 = 验证码 + 新密码。 */
const step = ref<ForgetStep>(1);
const loading = ref(false);
const sending = ref(false);
const countdown = ref(0);
/** 验证码去了哪里：`email` 已投递邮箱；`console` 开发环境打在服务端控制台。 */
const delivery = ref<'email' | 'console' | ''>('');

let timer: ReturnType<typeof setInterval> | undefined;
let redirectTimer: ReturnType<typeof setTimeout> | undefined;

onBeforeUnmount(() => {
  stopCountdown();
  if (redirectTimer) clearTimeout(redirectTimer);
});

// 文档 14.1 的 v-ripple：注册为组件内局部指令，不污染全局，也不用额外插件。
type RippleEl = HTMLElement & { __nomiRipple?: (event: PointerEvent) => void };
const vRipple: Directive<RippleEl> = {
  mounted(el) {
    const handler = (event: PointerEvent): void => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const rect = el.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      const ripple = document.createElement('span');
      ripple.className = 'nomi-forget-ripple';
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

/** 二次确认文案里展示打码后的账号，既能认出来，又不在屏幕上平铺完整账号。 */
const maskedAccount = computed(() => maskAccount(draft.account));

// computed 而非普通对象：切语言后错误文案会一起重新求值（文档 2.5）。
const rules = computed<FormRules<ForgetPasswordDraft>>(() => {
  const ruleFor = (field: ForgetPasswordField): FormItemRule => ({
    validator: (_rule, _value, callback) => {
      const violation = validateForgetField(field, draft);
      if (violation) callback(new Error(t(violation.key, violation.params ?? {})));
      else callback();
    },
    trigger: 'blur',
  });

  return {
    account: [ruleFor('account')],
    code: [ruleFor('code')],
    newPassword: [ruleFor('newPassword')],
    confirmPassword: [ruleFor('confirmPassword')],
  };
});

// 只清校验态，保留已填内容与焦点（文档 18.1 修 17.5，不再 formKey++）。
watch(locale, () => {
  formRef.value?.clearValidate();
});

/** 主密码失焦时联动重校验确认密码，并吞掉 rejection 避免 Uncaught (in promise)。 */
function revalidateConfirm(): void {
  if (!draft.confirmPassword) return;
  void formRef.value?.validateField('confirmPassword').catch(() => {});
}

/** 业务码 → 当前语言文案。服务端 msg 是中文，直接展示会在英文界面里漏出。 */
function localizedError(error: unknown): string {
  const code =
    (error as { data?: { code?: number }; code?: number } | null)?.data?.code ??
    (error as { code?: number } | null)?.code;
  if (code === 429) return t('forgetPassword.tooFrequent');
  if (code === 503) return t('forgetPassword.deliveryUnavailable');
  if (code === 404) return t('forgetPassword.accountNotFound');
  if (code === 440) return t('forgetPassword.emailNotBound');
  if (code === 441) return t('forgetPassword.emailNotFound');
  if (code === 422) return t('forgetPassword.invalid');
  return getErrorMessage(error, t('forgetPassword.failed'));
}

function stopCountdown(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
  countdown.value = 0;
}

/** 启动重发倒计时。秒数取服务端回执，两边节流口径保持一致。 */
function startCountdown(seconds = COUNTDOWN_SECONDS): void {
  stopCountdown();
  countdown.value = seconds > 0 ? seconds : COUNTDOWN_SECONDS;
  timer = setInterval(() => {
    countdown.value -= 1;
    if (countdown.value <= 0) stopCountdown();
  }, 1000);
}

async function requestCode(): Promise<void> {
  if (sending.value || loading.value || !formRef.value) return;

  // 倒计时未走完：服务端会 429，这里既不重复请求也不报错，
  // 直接把用户送回第二步 —— 上一枚验证码仍然有效（TTL 5 分钟 > 冷却 60 秒）。
  if (countdown.value > 0) {
    step.value = 2;
    return;
  }

  // 只校验账号字段；未渲染的字段不会被 validateField 命中。
  const valid = await formRef.value
    .validateField('account')
    .then(() => true)
    .catch(() => false);
  if (!valid) return;

  sending.value = true;
  try {
    const result = await fetchSendResetCode({ account: draft.account.trim() });
    delivery.value = result.delivery;
    step.value = 2;
    startCountdown(result.cooldown);
    ElMessage.success(
      result.delivery === 'console'
        ? t('forgetPassword.codeSentConsole')
        : t('forgetPassword.codeSentTip'),
    );
  } catch (error) {
    ElMessage.error(localizedError(error));
  } finally {
    sending.value = false;
  }
}

async function submit(): Promise<void> {
  // 提交期间（含跳转等待期）整体加锁，不允许重复提交。
  if (!formRef.value || loading.value || sending.value || redirectTimer) return;

  if (step.value === 1) {
    await requestCode();
    return;
  }

  // 校验失败是正常交互：不进 catch、不打错误日志。
  const valid = await formRef.value.validate().catch(() => false);
  if (!valid) return;

  loading.value = true;
  try {
    await fetchResetPassword({
      account: draft.account.trim(),
      code: normalizeCode(draft.code),
      newPassword: draft.newPassword,
    });

    // 成功后立刻清掉内存里的两个明文密码。
    draft.code = '';
    draft.newPassword = '';
    draft.confirmPassword = '';
    delivery.value = '';
    stopCountdown();

    ElMessage.success(t('forgetPassword.success'));
    redirectTimer = setTimeout(() => {
      redirectTimer = undefined;
      loading.value = false;
      void navigateTo({
        path: localePath('/login'),
        query: { username: draft.account.trim() },
      });
    }, FORGET_REDIRECT_DELAY);
  } catch (error) {
    loading.value = false;
    ElMessage.error(localizedError(error));
  }
}

/** 返回：step2 → 回第一步（保留账号与倒计时）；step1 → 回登录。 */
function handleBack(): void {
  if (step.value === 2) {
    step.value = 1;
    draft.code = '';
    draft.newPassword = '';
    draft.confirmPassword = '';
    delivery.value = '';
    formRef.value?.clearValidate();
    return;
  }
  void navigateTo(localePath('/login'));
}
</script>

<template>
  <div class="nomi-forget">
    <h1 class="auth-title">
      {{ step === 1 ? t('forgetPassword.title') : t('forgetPassword.titleStep2') }}
    </h1>
    <p class="auth-subtitle">
      {{
        step === 1
          ? t('forgetPassword.subTitle')
          : t('forgetPassword.subTitleStep2', { account: maskedAccount })
      }}
    </p>

    <ElForm ref="formRef" class="nomi-forget-form" :model="draft" :rules="rules" @keyup.enter="submit">
      <ElFormItem prop="account">
        <ElInput
          v-model.trim="draft.account"
          class="auth-control nomi-forget-field"
          :placeholder="t('forgetPassword.placeholder')"
          :disabled="step === 2"
          autocomplete="username"
        >
          <template #prefix><NomiIcon name="user" :size="16" /></template>
        </ElInput>
      </ElFormItem>

      <template v-if="step === 2">
        <ElFormItem prop="code">
          <div class="nomi-forget-code">
            <ElInput
              v-model.trim="draft.code"
              class="auth-control nomi-forget-field"
              :placeholder="t('forgetPassword.codePlaceholder')"
              :maxlength="CODE_LENGTH"
              inputmode="numeric"
              autocomplete="one-time-code"
            >
              <template #prefix><NomiIcon name="shield" :size="16" /></template>
            </ElInput>
            <ElButton
              class="nomi-forget-code-btn"
              :disabled="countdown > 0"
              :loading="sending"
              @click="requestCode"
            >
              {{
                countdown > 0
                  ? t('forgetPassword.resend', { seconds: countdown })
                  : t('forgetPassword.sendCode')
              }}
            </ElButton>
          </div>
        </ElFormItem>

        <p v-if="delivery" class="nomi-forget-notice">
          {{
            delivery === 'console'
              ? t('forgetPassword.codeSentConsoleHint')
              : t('forgetPassword.codeSentEmailHint')
          }}
        </p>

        <ElFormItem prop="newPassword">
          <ElInput
            v-model="draft.newPassword"
            class="auth-control nomi-forget-field"
            type="password"
            show-password
            autocomplete="new-password"
            :placeholder="t('forgetPassword.newPasswordPlaceholder')"
            @blur="revalidateConfirm"
          >
            <template #prefix><NomiIcon name="lock" :size="16" /></template>
          </ElInput>
        </ElFormItem>

        <ElFormItem prop="confirmPassword">
          <ElInput
            v-model="draft.confirmPassword"
            class="auth-control nomi-forget-field"
            type="password"
            show-password
            autocomplete="new-password"
            :placeholder="t('forgetPassword.confirmPlaceholder')"
          >
            <template #prefix><NomiIcon name="lock" :size="16" /></template>
          </ElInput>
        </ElFormItem>
      </template>
    </ElForm>

    <div class="nomi-forget-actions">
      <ElButton
        v-ripple
        type="primary"
        class="auth-control nomi-forget-submit"
        :loading="loading"
        :disabled="sending"
        @click="submit"
      >
        {{ step === 1 ? t('forgetPassword.submitBtnText') : t('forgetPassword.confirmBtnText') }}
      </ElButton>
      <ElButton class="auth-control nomi-forget-back" plain @click="handleBack">
        {{ step === 1 ? t('forgetPassword.backBtnText') : t('forgetPassword.prevBtnText') }}
      </ElButton>
    </div>

    <div class="nomi-forget-footer">
      <span>{{ t('forgetPassword.remembered') }}</span>
      <NuxtLink class="auth-link" :to="localePath('/login')">
        {{ t('forgetPassword.toLogin') }}
      </NuxtLink>
    </div>

    <!-- 演示账号说明只在演示站出现：真实部署里 super/admin/user 不是公开演示凭据。 -->
    <p v-if="isDemo" class="nomi-forget-hint">{{ t('forgetPassword.hint') }}</p>
  </div>
</template>
