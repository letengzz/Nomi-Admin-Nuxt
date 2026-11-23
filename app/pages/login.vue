<script setup lang="ts">
/**
 * 登录页：左品牌 / 右表单双栏。
 *
 * 对齐 docs/登录页设计参考文档.md 的布局、状态机与视觉规范，但用当前工程的技术栈实现：
 * Nuxt 4 文件路由 + Element Plus + Pinia + @vueuse/core + Nuxt i18n + Nitro mock 接口。
 *
 * 外壳样式在 app/assets/styles/auth.scss，与注册页共用一份（不再反向 import 登录页样式）。
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
  type FormInstance,
  type FormRules,
} from 'element-plus';
import NomiAuthBrandPanel from '../components/auth/NomiAuthBrandPanel.vue';
import NomiAuthTopBar from '../components/auth/NomiAuthTopBar.vue';
import NomiSiteFooter from '../components/layout/NomiSiteFooter.vue';
import NomiDragVerify from '../components/auth/NomiDragVerify.vue';
import { DEMO_PASSWORD } from '../constants/auth';
import { readRememberLogin, saveRememberLogin } from '../utils/storage-key';
import { isDemoMode } from '../utils/api';
import { HOME_PATH } from '../constants/layout';
import { fetchLogin, getErrorMessage } from '../services/auth';
import { usePermissionStore } from '../stores/permission';
import { useUserStore } from '../stores/user';
import { fetchLoginConfig } from '../services/system-config';

const { t, locale } = useI18n();
const route = useRoute();
const localePath = useLocalePath();
const userStore = useUserStore();
/** 演示站（GitHub Pages 那套静态构建）才有的脚本化行为，真实登录页一概不参与。 */
const isDemo = isDemoMode();

useHead({ title: computed(() => t('login.pageTitle')) });

const formRef = ref<FormInstance>();
const dragRef = ref<InstanceType<typeof NomiDragVerify> | null>(null);
const formKey = ref(0);
const isPassing = ref(false);
const isClickPass = ref(false);
const loading = ref(false);
/** 由系统配置里的「登录配置」下发；接口不可用时保持 true，不放宽校验。 */
const captchaEnabled = ref(true);
/** 关闭注册时连入口一起收起，别让用户点进去才看到「暂未开放」。 */
const registrationEnabled = ref(true);

const formData = reactive({
  userName: '',
  password: '',
  rememberPassword: true,
});

const rules = computed<FormRules>(() => ({
  userName: [{ required: true, message: t('login.placeholder.username'), trigger: 'blur' }],
  password: [{ required: true, message: t('login.placeholder.password'), trigger: 'blur' }],
}));

function resetDragVerify(): void {
  dragRef.value?.reset();
  isPassing.value = false;
  isClickPass.value = false;
}

/** 文档 15.2：登录 → 忘记密码是真实导航，用 localePath 保持当前语言前缀。 */
function toForgetPassword(): void {
  void navigateTo(localePath('/forget-password'));
}

/** 文档 15.2：登录 → 注册是真实导航，用 localePath 保持当前语言前缀。 */
function toRegister(): void {
  void navigateTo(localePath('/register'));
}

async function handleSubmit(): Promise<void> {
  if (!formRef.value || loading.value) return;

  const valid = await formRef.value.validate().catch(() => false);
  if (!valid) return;
  if (captchaEnabled.value && !isPassing.value) {
    isClickPass.value = true;
    return;
  }

  loading.value = true;
  isClickPass.value = false;
  try {
    const result = await fetchLogin({
      userName: formData.userName.trim(),
      password: formData.password,
      // 勾选状态直接决定会话形态：不勾选就不发 refresh token，过期后必须重登。
      keepLogin: formData.rememberPassword,
    });
    // 凭证与身份一次写完：store 内部会顺手判断「是不是换了个人」，
    // 是的话清掉上一位用户留下的标签页（docs/状态管理.md 3.4）。
    userStore.login({
      token: result.token,
      refreshToken: result.refreshToken,
      info: { userId: result.userName, userName: result.userName, roles: [result.role] },
    });
    // 换人了：清掉上一位用户的权限缓存。进后台时由全局路由守卫重新拉一次，
    // 避免「登录了 A，侧边栏还是 B 的菜单」这种要刷新才好使的怪现象。
    usePermissionStore().reset();

    // 记住「账号 + 密码 + 勾选状态」：勾选时下次打开直接回填，省得再敲一遍。
    // 密码在 storage-key 里做可逆编码，不落裸明文；取消勾选也要落盘，
    // 否则刷新后复选框会回到默认勾选，看起来像没生效。
    saveRememberLogin(
      formData.userName.trim(),
      formData.rememberPassword,
      formData.password,
    );

    // 初始口令未改：后台只放行「改密 + 看自己资料」，直接送到改密入口，
    // 别让用户先进仪表盘、再被一串 428 弹回来。
    if (result.mustChangePassword) {
      ElNotification.warning({
        title: t('layout.profile.passwordRequiredTitle'),
        message: t('layout.profile.passwordRequired'),
        duration: 6000,
      });
      await navigateTo(localePath('/admin/profile'));
      return;
    }

    ElNotification.success({
      title: t('login.success.title'),
      message: `${t('login.success.message')}，${result.userName}`,
      duration: 3000,
    });

    // 只允许站内相对路径，防止 //evil.com 这类开放重定向。
    const raw = route.query.redirect;
    const safe =
      typeof raw === 'string' && raw.startsWith('/') && !raw.startsWith('//') && !raw.startsWith('/\\')
        ? raw
        : '';

    // 没有 redirect（或它指向根路径）时落主界面：根路径已经没有介绍页了，
    // 再走一次 '/' 只会多一跳。localePath 保证英文环境落到 /en/admin。
    await navigateTo(safe && safe !== '/' ? safe : localePath(HOME_PATH));
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

onMounted(async () => {
  // 先恢复上次勾没勾：放在网络请求之前，避免配置接口慢时复选框先闪回默认勾选。
  const remembered = readRememberLogin();
  formData.rememberPassword = remembered.remember;

  const loginConfig = await fetchLoginConfig();
  captchaEnabled.value = loginConfig.captchaEnabled;
  registrationEnabled.value = loginConfig.registrationEnabled;

  // 演示站默认预填 admin（技术中心）：打开页面就能直接点登录，登录后按账号所属部门
  // 展示本部门及下级部门的内容。真实环境不预填，账号是用户自己输入的登录凭据。
  if (isDemo) {
    formData.userName = 'admin';
    formData.password = DEMO_PASSWORD;
  }

  // 记住的账号 / 密码优先级高于演示站预填：用户上次用自己的账号登录过，
  // 再打开就该回到那套凭据，而不是被演示账号的 admin/123456 覆盖。
  if (remembered.account) formData.userName = remembered.account;
  if (remembered.password) formData.password = remembered.password;

  // 文档 18.8：注册成功后带 username 回来，直接预填，省掉用户重新敲一遍。
  const registered = route.query.username;
  if (typeof registered === 'string' && registered.length > 0 && registered.length <= 20) {
    formData.userName = registered;
    // 新账号用的是注册时自己设的密码，别把演示密码留在框里误导用户。
    formData.password = '';
  }
});
</script>

<template>
  <div class="auth-page">
    <NomiAuthBrandPanel />

    <div class="auth-panel">
      <NomiAuthTopBar />

      <div class="auth-wrap">
        <div class="auth-form auth-form--login">
          <h1 class="auth-title">{{ t('login.title') }}</h1>
          <p class="auth-subtitle">{{ t('login.subTitle') }}</p>

          <ElForm
            ref="formRef"
            :key="formKey"
            :model="formData"
            :rules="rules"
            @keyup.enter="handleSubmit"
          >
            <ElFormItem prop="userName">
              <ElInput
                v-model.trim="formData.userName"
                class="auth-control"
                :placeholder="t('login.placeholder.username')"
                autocomplete="username"
              />
            </ElFormItem>

            <ElFormItem prop="password">
              <ElInput
                v-model="formData.password"
                class="auth-control"
                type="password"
                show-password
                autocomplete="current-password"
                :placeholder="t('login.placeholder.password')"
              />
            </ElFormItem>

            <template v-if="captchaEnabled">
              <!-- 错误提示藏在滑块背后，出错才滑出，布局零抖动 -->
              <div class="auth-verify-wrap">
                <div class="auth-verify-cover" :class="{ 'is-error': !isPassing && isClickPass }">
                  <NomiDragVerify
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
            </template>

            <div class="auth-actions">
              <ElCheckbox v-model="formData.rememberPassword">
                {{ t('login.rememberPwd') }}
              </ElCheckbox>
              <button type="button" class="auth-link" @click="toForgetPassword">
                {{ t('login.forgetPwd') }}
              </button>
            </div>

            <div class="auth-submit">
              <ElButton type="primary" class="auth-control" :loading="loading" @click="handleSubmit">
                {{ t('login.btnText') }}
              </ElButton>
            </div>

            <div v-if="registrationEnabled" class="auth-register">
              <span>{{ t('login.noAccount') }}</span>
              <button type="button" class="auth-link" @click="toRegister">
                {{ t('login.register') }}
              </button>
            </div>

            <!--
              演示提示只在 GitHub Pages 那套静态站出现（NUXT_PUBLIC_DEMO=1）。
              真实部署里「密码统一为 123456」是错误信息，不能露给用户看。
            -->
            <p v-if="isDemo" class="auth-demo-hint">{{ t('login.demoHint') }}</p>
          </ElForm>
        </div>
      </div>
      <NomiSiteFooter variant="auth" />
    </div>
  </div>
</template>
