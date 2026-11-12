<script setup lang="ts">
/**
 * 登录页：左品牌 / 右表单双栏。
 *
 * 对齐 docs/登录页设计参考文档.md 的布局、状态机与视觉规范，但用当前工程的技术栈实现：
 * Nuxt 4 文件路由 + Element Plus + Pinia + @vueuse/core + Nuxt i18n + Nitro mock 接口。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue';
import {
  ElButton,
  ElCheckbox,
  ElForm,
  ElFormItem,
  ElInput,
  ElMessage,
  ElNotification,
  ElOption,
  ElSelect,
  type FormInstance,
  type FormRules,
} from 'element-plus';
import LoginBrandPanel from '../components/auth/LoginBrandPanel.vue';
import AuthTopBar from '../components/auth/AuthTopBar.vue';
import DragVerify from '../components/auth/DragVerify.vue';
import {
  DEMO_ACCOUNTS,
  DEMO_PASSWORD,
  REMEMBERED_ACCOUNT_KEY,
  type DemoAccountKey,
} from '../constants/auth';
import { fetchLogin, getErrorMessage } from '../services/auth';
import { useUserStore } from '../stores/user';

const { t, locale } = useI18n();
const route = useRoute();
const userStore = useUserStore();

useHead({ title: computed(() => t('login.pageTitle')) });

const formRef = ref<FormInstance>();
const dragRef = ref<InstanceType<typeof DragVerify> | null>(null);
const formKey = ref(0);
const isPassing = ref(false);
const isClickPass = ref(false);
const loading = ref(false);

const formData = reactive({
  account: 'super' as DemoAccountKey,
  userName: '',
  password: '',
  rememberPassword: true,
});

const accounts = computed(() =>
  DEMO_ACCOUNTS.map((account) => ({
    key: account.key,
    label: t(`login.roles.${account.key}`),
  })),
);

const rules = computed<FormRules>(() => ({
  userName: [{ required: true, message: t('login.placeholder.username'), trigger: 'blur' }],
  password: [{ required: true, message: t('login.placeholder.password'), trigger: 'blur' }],
}));

function setupAccount(key: DemoAccountKey): void {
  const account = DEMO_ACCOUNTS.find((item) => item.key === key);
  if (!account) return;
  formData.account = account.key;
  formData.userName = account.userName;
  formData.password = DEMO_PASSWORD;
}

function resetDragVerify(): void {
  dragRef.value?.reset();
  isPassing.value = false;
  isClickPass.value = false;
}

function showHint(): void {
  ElMessage.info(t('login.notAvailable'));
}

async function handleSubmit(): Promise<void> {
  if (!formRef.value || loading.value) return;

  const valid = await formRef.value.validate().catch(() => false);
  if (!valid) return;
  if (!isPassing.value) {
    isClickPass.value = true;
    return;
  }

  loading.value = true;
  isClickPass.value = false;
  try {
    const result = await fetchLogin({
      userName: formData.userName.trim(),
      password: formData.password,
    });
    userStore.setToken(result.token, result.refreshToken);

    // 记住的只有账号名，绝不保存明文密码。
    if (formData.rememberPassword) {
      localStorage.setItem(REMEMBERED_ACCOUNT_KEY, formData.userName.trim());
    } else {
      localStorage.removeItem(REMEMBERED_ACCOUNT_KEY);
    }

    ElNotification.success({
      title: t('login.success.title'),
      message: `${t('login.success.message')}，${result.userName}`,
      duration: 3000,
    });

    // 只允许站内相对路径，防止 //evil.com 这类开放重定向。
    const raw = route.query.redirect;
    const redirect =
      typeof raw === 'string' &&
      raw.startsWith('/') &&
      !raw.startsWith('//') &&
      !raw.startsWith('/\\')
        ? raw
        : '/';
    await navigateTo(redirect);
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    loading.value = false;
    resetDragVerify();
  }
}

watch(locale, () => {
  isPassing.value = false;
  isClickPass.value = false;
  formKey.value += 1;
});

onMounted(() => {
  setupAccount('super');
  const remembered = localStorage.getItem(REMEMBERED_ACCOUNT_KEY);
  if (remembered) formData.userName = remembered;
});
</script>

<template>
  <div class="auth-page">
    <LoginBrandPanel />

    <div class="auth-panel">
      <AuthTopBar />

      <div class="auth-wrap">
        <div class="auth-form">
          <h1 class="auth-title">{{ t('login.title') }}</h1>
          <p class="auth-subtitle">{{ t('login.subTitle') }}</p>

          <ElForm
            ref="formRef"
            :key="formKey"
            :model="formData"
            :rules="rules"
            @keyup.enter="handleSubmit"
          >
            <ElFormItem prop="account">
              <ElSelect v-model="formData.account" class="auth-control" @change="setupAccount">
                <ElOption
                  v-for="account in accounts"
                  :key="account.key"
                  :label="account.label"
                  :value="account.key"
                />
              </ElSelect>
            </ElFormItem>

            <ElFormItem prop="userName">
              <ElInput
                v-model.trim="formData.userName"
                class="auth-control"
                :placeholder="t('login.placeholder.username')"
                autocomplete="off"
              />
            </ElFormItem>

            <ElFormItem prop="password">
              <ElInput
                v-model="formData.password"
                class="auth-control"
                type="password"
                show-password
                autocomplete="off"
                :placeholder="t('login.placeholder.password')"
              />
            </ElFormItem>

            <!-- 错误提示藏在滑块背后，出错才滑出，布局零抖动 -->
            <div class="auth-verify-wrap">
              <div class="auth-verify-cover" :class="{ 'is-error': !isPassing && isClickPass }">
                <DragVerify
                  ref="dragRef"
                  v-model:value="isPassing"
                  :text="t('login.sliderText')"
                  :success-text="t('login.sliderSuccessText')"
                />
              </div>
              <p class="auth-verify-error" :class="{ 'is-visible': !isPassing && isClickPass }">
                {{ t('login.placeholder.slider') }}
              </p>
            </div>

            <div class="auth-actions">
              <ElCheckbox v-model="formData.rememberPassword">
                {{ t('login.rememberPwd') }}
              </ElCheckbox>
              <button type="button" class="auth-link" @click="showHint">
                {{ t('login.forgetPwd') }}
              </button>
            </div>

            <div class="auth-submit">
              <ElButton type="primary" class="auth-control" :loading="loading" @click="handleSubmit">
                {{ t('login.btnText') }}
              </ElButton>
            </div>

            <div class="auth-register">
              <span>{{ t('login.noAccount') }}</span>
              <button type="button" class="auth-link" @click="showHint">
                {{ t('login.register') }}
              </button>
            </div>

            <p class="auth-demo-hint">{{ t('login.demoHint') }}</p>
          </ElForm>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
/* 样式全局但全部带 auth- 前缀，只作用于本页。 */
.auth-page {
  display: flex;
  width: 100%;
  height: 100vh;
  overflow: hidden;
  background: var(--bg, #fff);
  color: var(--fg, #0f172a);
}

.auth-panel {
  position: relative;
  flex: 1;
  min-width: 0;
}

/* absolute + inset:0 + 定宽高 + margin:auto = 完美的水平垂直居中，且不与入场动画的 transform 冲突 */
.auth-wrap {
  position: absolute;
  inset: 0;
  width: 440px;
  height: 650px;
  padding: 5px 0;
  margin: auto;
  overflow: hidden;
  animation: slideinright 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) both;
}

.auth-form {
  height: 100%;
  padding: 40px 0;
}

.auth-title {
  margin: 0;
  font-size: 36px;
  font-weight: 600;
  line-height: 1.25;
  color: var(--fg, #0f172a);
}

.auth-subtitle {
  margin: 10px 0 0;
  font-size: 14px;
  color: var(--fg-muted, #64748b);
}

.auth-form .el-form {
  margin-top: 25px;
}

.auth-form .el-form-item {
  margin-bottom: 18px;
}

.auth-form .el-input__wrapper,
.auth-form .el-select__wrapper {
  min-height: 40px;
  background: var(--bg, #fff);
  box-shadow: 0 0 0 1px var(--border, #e2e8f0) inset;
}

.auth-form .el-input__wrapper.is-focus,
.auth-form .el-select__wrapper.is-focused {
  box-shadow: 0 0 0 1px var(--el-color-primary, #5d87ff) inset;
}

.auth-form .el-button.auth-control {
  width: 100%;
  height: 40px;
  font-size: 14px;
}

.auth-form .el-checkbox__label {
  font-size: 14px;
  color: var(--fg-muted, #64748b);
}

.auth-verify-wrap {
  position: relative;
  margin-top: 24px;
  padding-bottom: 20px;
}

.auth-verify-cover {
  position: relative;
  z-index: 2;
  overflow: hidden;
  border: 1px solid transparent;
  border-radius: 8px;
  transition: border-color 0.3s ease;
}

.auth-verify-cover.is-error {
  border-color: #ff4e4f;
}

.auth-verify-error {
  position: absolute;
  z-index: 1;
  top: 0;
  margin: 8px 0 0;
  padding: 0 1px;
  font-size: 12px;
  line-height: 1.4;
  color: #f56c6c;
  transform: translateY(0);
  transition: transform 0.3s ease;
}

.auth-verify-error.is-visible {
  transform: translateY(40px);
}

.auth-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
  font-size: 14px;
}

.auth-submit {
  margin-top: 30px;
}

.auth-register {
  display: flex;
  gap: 4px;
  align-items: center;
  margin-top: 20px;
  font-size: 14px;
  color: var(--fg-muted, #64748b);
}

.auth-demo-hint {
  margin: 14px 0 0;
  font-size: 12px;
  color: var(--fg-muted, #64748b);
  opacity: 0.8;
}

.auth-link {
  padding: 0;
  font-size: 14px;
  color: var(--el-color-primary, #5d87ff);
  background: transparent;
  border: 0;
}

.auth-link:hover {
  border: 0;
  text-decoration: underline;
}

@keyframes slideinright {
  from {
    opacity: 0;
    transform: translateX(30px);
  }

  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@media (max-width: 768px) {
  .auth-wrap {
    animation: none;
  }

  .auth-title {
    font-size: 30px;
  }
}

@media (max-width: 640px) {
  .auth-wrap {
    width: 100%;
    padding: 5px 28px;
  }

  .auth-title {
    padding-top: 40px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .auth-wrap {
    animation: none;
  }
}
</style>
