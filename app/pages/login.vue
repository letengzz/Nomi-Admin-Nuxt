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
  ElOption,
  ElSelect,
  type FormInstance,
  type FormRules,
} from 'element-plus';
import NomiAuthBrandPanel from '../components/auth/NomiAuthBrandPanel.vue';
import NomiAuthTopBar from '../components/auth/NomiAuthTopBar.vue';
import NomiSiteFooter from '../components/layout/NomiSiteFooter.vue';
import NomiDragVerify from '../components/auth/NomiDragVerify.vue';
import { DEMO_ACCOUNTS, DEMO_PASSWORD, REMEMBERED_ACCOUNT_KEY } from '../constants/auth';
import { isDemoMode } from '../utils/api';
import { HOME_PATH } from '../constants/layout';
import {
  fetchLogin,
  fetchLoginDepartments,
  getErrorMessage,
  type LoginDepartment,
} from '../services/auth';
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
  /** 选中的部门 id（0 = 还没选） */
  departmentId: 0,
  userName: '',
  password: '',
  rememberPassword: true,
});

/** 登录页的部门表来自免登录接口，拿不到就退化成「手动输入账号」。 */
const departments = ref<LoginDepartment[]>([]);

/**
 * 部门树展开成带缩进的下拉：深度优先、同级按接口给的顺序（weigh 降序），
 * 每层缩进一个全角空格。不直接用 el-tree-select 是因为这里只是「选一个部门」，
 * 下拉比树更轻。
 */
const departmentOptions = computed(() => {
  const children = new Map<number, LoginDepartment[]>();
  for (const dept of departments.value) {
    const siblings = children.get(dept.pid) ?? [];
    siblings.push(dept);
    children.set(dept.pid, siblings);
  }

  const rows: Array<{ id: number; label: string }> = [];
  const walk = (pid: number, depth: number): void => {
    // 层级上限是防御用的：数据被人手工改成环时不至于把登录页挂死。
    if (depth > 8) return;
    for (const dept of children.get(pid) ?? []) {
      rows.push({ id: dept.id, label: `${'\u3000'.repeat(depth)}${dept.name}` });
      walk(dept.id, depth + 1);
    }
  };
  walk(0, 0);
  return rows;
});

const rules = computed<FormRules>(() => ({
  userName: [{ required: true, message: t('login.placeholder.username'), trigger: 'blur' }],
  password: [{ required: true, message: t('login.placeholder.password'), trigger: 'blur' }],
}));

/**
 * 选部门 = 演示脚本。
 *
 * 该部门下有演示账号就自动填入账号密码（三个演示账号分别挂在三个部门下）；
 * 没有就保持用户已经输入的内容 —— 清空反而会让人以为选错了。
 *
 * 只对演示站生效：真实登录页的部门列表来自数据库，部门 id 一旦与演示账号
 * 撞号（1/2/3 很容易撞），就会把人家的用户名密码顶进输入框。
 */
function applyDepartment(id: number): void {
  formData.departmentId = id;
  if (!isDemo) return;
  const demo = DEMO_ACCOUNTS.find((item) => item.departmentId === id);
  if (!demo) return;
  formData.userName = demo.userName;
  formData.password = DEMO_PASSWORD;
}

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
      departmentId: formData.departmentId,
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
  // 验证码开关与部门表都是登录页必需的展示条件，并行拿，谁慢都不拦另一个。
  const [loginConfig, deptList] = await Promise.all([fetchLoginConfig(), fetchLoginDepartments()]);
  captchaEnabled.value = loginConfig.captchaEnabled;
  registrationEnabled.value = loginConfig.registrationEnabled;
  departments.value = deptList;
  // 演示站默认选第一个「有演示账号」的部门：打开页面就能直接点登录。
  // 真实环境不替用户做选择 —— 部门是登录凭据的一部分，选错会登不上。
  if (isDemo) {
    const preferred = DEMO_ACCOUNTS.map((item) => item.departmentId).find((id) =>
      departments.value.some((dept) => dept.id === id),
    );
    if (preferred) applyDepartment(preferred);
  }

  const remembered = localStorage.getItem(REMEMBERED_ACCOUNT_KEY);
  if (remembered) formData.userName = remembered;

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
            <ElFormItem prop="departmentId">
              <ElSelect
                v-model="formData.departmentId"
                class="auth-control"
                :placeholder="t('login.departmentLabel')"
                @change="applyDepartment"
              >
                <ElOption
                  v-for="dept in departmentOptions"
                  :key="dept.id"
                  :label="dept.label"
                  :value="dept.id"
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
