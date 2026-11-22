<script setup lang="ts">
/**
 * 个人中心 —— 左侧「我是谁」，右侧「我的账号安全」。
 *
 * 三块内容的边界：
 *   · 基本信息：**只读**。姓名 / 部门 / 角色都由管理员在用户管理里指派，
 *     自己改会绕开审批流程；这里只负责把「服务端算好的身份」摆清楚。
 *   · 安全设置：手机 / 邮箱 / 密码，每一项都能改，但都要先验当前密码 ——
 *     没有短信与邮件网关时，当前密码是唯一能证明「是本人」的东西。
 *   · 第三方账号：目前只有入口，没有接入 OAuth，点击给一句明确提示，
 *     而不是假装绑定成功。
 *
 * 入口只在右上角用户下拉框（NomiUserMenu）：常量里的 HIDDEN_MENU_LIST 记录了
 * 这件事 —— 菜单里没有它，但面包屑 / 工作标签仍能查到标题。
 */
import { computed, onMounted, reactive, ref } from 'vue';
import {
  ElButton,
  ElDialog,
  ElForm,
  ElFormItem,
  ElInput,
  ElMessage,
  type FormInstance,
  type FormItemRule,
  type FormRules,
} from 'element-plus';
import NomiIcon from '../../components/layout/NomiIcon.vue';
import NomiSpinner from '../../components/layout/NomiSpinner.vue';
import { usePermissionStore } from '../../stores/permission';
import {
  changeSelfPassword,
  fetchSelfProfile,
  updateSelfContact,
  type SelfProfile,
} from '../../services/profile';
import { formatDate, maskEmail, maskMobile } from '../../utils/format';

definePageMeta({ layout: 'admin', keepalive: true });
defineOptions({ name: 'NomiAdminProfile' });

const { t } = useI18n();
useHead({ title: computed(() => t('layout.menu.profile')) });

type SecurityKey = 'mobile' | 'email' | 'password';

const loading = ref(true);
const profile = ref<SelfProfile | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  try {
    profile.value = await fetchSelfProfile();
  } catch (error) {
    ElMessage.error((error as Error).message || t('layout.profile.loadFailed'));
  } finally {
    loading.value = false;
  }
}

/**
 * 初始口令未改：页面一进来就把改密弹窗打开。
 *
 * 服务端的拦截（428）已经保证「不改密什么都干不了」，这里只是别让用户
 * 对着一个空后台猜「为什么菜单都点不动」。弹窗允许关掉 —— 强制的是结果，
 * 不是把人锁在模态框里。
 */
onMounted(async () => {
  await load();
  if (profile.value?.mustChangePassword) {
    ElMessage.warning(t('layout.profile.passwordRequired'));
    openDialog('password');
  }
});

/** 姓名首字母当头像兜底；中文名取第一个字（比首字母更像「这个人」）。 */
const avatarText = computed(() => {
  const name = profile.value?.nickname || profile.value?.username || '';
  return name.slice(0, 1).toUpperCase() || '?';
});

/** 性别用符号表示（♂ / ♀），保密时干脆不显示 —— 空缺本身就是「没说」。 */
const genderSymbol = computed(() => {
  if (profile.value?.gender === 'male') return '♂';
  if (profile.value?.gender === 'female') return '♀';
  return '';
});

const displayName = computed(() => profile.value?.nickname || profile.value?.username || '');

/** 六个字段三列排布：用户名 / 手机 / 邮箱 / 部门 / 角色 / 注册时间。 */
const infoItems = computed(() => {
  const data = profile.value;
  const dash = '—';
  return [
    {
      key: 'username',
      label: t('layout.profile.username'),
      value: data?.username || dash,
    },
    {
      key: 'mobile',
      label: t('layout.profile.phone'),
      value: data?.mobile ? maskMobile(data.mobile) : t('layout.profile.unset'),
    },
    {
      key: 'email',
      label: t('layout.profile.email'),
      value: data?.email ? maskEmail(data.email) : t('layout.profile.unset'),
    },
    {
      key: 'department',
      label: t('layout.profile.department'),
      value: data?.departmentName || t('layout.profile.noDepartment'),
    },
    {
      key: 'roles',
      label: t('layout.profile.roles'),
      value: data?.roles.length ? data.roles.map((role) => role.name).join('、') : t('layout.profile.noRole'),
    },
    {
      key: 'createTime',
      label: t('layout.profile.createTime'),
      value: data?.createTime ? formatDate(data.createTime) : dash,
    },
  ];
});

interface SecurityRow {
  key: SecurityKey;
  icon: string;
  title: string;
  bound: boolean;
  /** 描述行：手机 / 邮箱显示脱敏号码，密码只留一句建议 */
  detail: string;
  desc: string;
}

const securityRows = computed<SecurityRow[]>(() => {
  const data = profile.value;
  return [
    {
      key: 'mobile',
      icon: 'mobile',
      title: t('layout.profile.securityMobile'),
      bound: Boolean(data?.security.mobile),
      detail: data?.mobile ? maskMobile(data.mobile) : t('layout.profile.unset'),
      desc: t('layout.profile.securityDesc'),
    },
    {
      key: 'email',
      icon: 'mail',
      title: t('layout.profile.securityEmail'),
      bound: Boolean(data?.security.email),
      detail: data?.email ? maskEmail(data.email) : t('layout.profile.unset'),
      desc: t('layout.profile.securityDesc'),
    },
    {
      key: 'password',
      icon: 'lock',
      title: t('layout.profile.loginPassword'),
      bound: Boolean(data?.security.password),
      detail: '',
      desc: t('layout.profile.passwordDesc'),
    },
  ];
});

const thirdPartyRows = computed(() => [
  {
    key: 'qq' as const,
    title: t('layout.profile.qqTitle'),
    bound: Boolean(profile.value?.thirdParty.qq),
    desc: t('layout.profile.qqDesc'),
  },
  {
    key: 'wechat' as const,
    title: t('layout.profile.wechatTitle'),
    bound: Boolean(profile.value?.thirdParty.wechat),
    desc: t('layout.profile.wechatDesc'),
  },
]);

// --- 修改弹窗 ---------------------------------------------------------------
// 三个入口共用一个弹窗：字段与校验按 dialogKey 切换，避免三份几乎一样的模板。
const dialogVisible = ref(false);
const dialogKey = ref<SecurityKey>('mobile');
const submitting = ref(false);
const formRef = ref<FormInstance>();
const form = reactive({ value: '', password: '', newPassword: '', confirmPassword: '' });

const dialogTitle = computed(() => {
  if (dialogKey.value === 'mobile') return t('layout.profile.mobileDialog');
  if (dialogKey.value === 'email') return t('layout.profile.emailDialog');
  return t('layout.profile.passwordDialog');
});

const valueLabel = computed(() =>
  dialogKey.value === 'mobile' ? t('layout.profile.newMobile') : t('layout.profile.newEmail'),
);

const valuePlaceholder = computed(() =>
  dialogKey.value === 'mobile'
    ? t('layout.profile.mobilePlaceholder')
    : t('layout.profile.emailPlaceholder'),
);

const formRules = computed<FormRules>(() => {
  const currentPassword: FormItemRule[] = [
    { required: true, message: t('layout.profile.currentPasswordRequired'), trigger: 'blur' },
  ];
  if (dialogKey.value === 'mobile') {
    return {
      value: [
        { required: true, message: t('layout.profile.mobileRequired'), trigger: 'blur' },
        {
          validator: (_rule, value: string, callback) => {
            if (!value || /^[0-9+\-() ]{5,20}$/.test(value)) return callback();
            return callback(new Error(t('layout.profile.mobileInvalid')));
          },
          trigger: 'blur',
        },
      ],
      password: currentPassword,
    };
  }
  if (dialogKey.value === 'email') {
    return {
      value: [
        { required: true, message: t('layout.profile.emailRequired'), trigger: 'blur' },
        {
          validator: (_rule, value: string, callback) => {
            if (!value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return callback();
            return callback(new Error(t('layout.profile.emailInvalid')));
          },
          trigger: 'blur',
        },
      ],
      password: currentPassword,
    };
  }
  return {
    password: currentPassword,
    newPassword: [
      { required: true, message: t('layout.profile.newPasswordRequired'), trigger: 'blur' },
      // 与服务端 checkPasswordStrength 的最低长度保持一致：前端先挡住，
      // 用户不用等一次往返才知道「太短了」。
      { min: 10, message: t('layout.profile.passwordPolicy'), trigger: 'blur' },
    ],
    confirmPassword: [
      { required: true, message: t('layout.profile.confirmPasswordRequired'), trigger: 'blur' },
      {
        validator: (_rule, value: string, callback) => {
          if (value === form.newPassword) return callback();
          return callback(new Error(t('layout.profile.passwordMismatch')));
        },
        trigger: 'blur',
      },
    ],
  };
});

function openDialog(key: SecurityKey): void {
  dialogKey.value = key;
  form.value = '';
  form.password = '';
  form.newPassword = '';
  form.confirmPassword = '';
  dialogVisible.value = true;
  // destroy-on-close 下表单是新建的：等它挂载完再清校验，否则清的是上一份实例。
  void nextTick(() => formRef.value?.clearValidate());
}

async function submit(): Promise<void> {
  if (!formRef.value) return;
  const valid = await formRef.value.validate().catch(() => false);
  if (!valid) return;

  submitting.value = true;
  try {
    if (dialogKey.value === 'password') {
      await changeSelfPassword({ oldPassword: form.password, newPassword: form.newPassword });
      ElMessage.success(t('layout.profile.passwordChanged'));
      // 服务端已经把标记清了，本地同步两处：横幅立刻收起，路由守卫不再把人弹回来。
      if (profile.value) profile.value.mustChangePassword = false;
      const permission = usePermissionStore();
      if (permission.adminInfo) permission.adminInfo.mustChangePassword = false;
    } else {
      const result = await updateSelfContact({
        field: dialogKey.value,
        value: form.value,
        password: form.password,
      });
      // 只改一个字段，不再拉整页：本地对齐服务端返回值即可。
      if (profile.value) {
        if (result.field === 'mobile') {
          profile.value.mobile = result.value;
          profile.value.security.mobile = true;
        } else {
          profile.value.email = result.value;
          profile.value.security.email = true;
        }
      }
      ElMessage.success(
        dialogKey.value === 'mobile'
          ? t('layout.profile.mobileChanged')
          : t('layout.profile.emailChanged'),
      );
    }
    dialogVisible.value = false;
  } catch (error) {
    ElMessage.error((error as Error).message);
  } finally {
    submitting.value = false;
  }
}

/** 第三方绑定：没有接入开放平台，先把「为什么点了没反应」说清楚。 */
function bindThirdParty(): void {
  ElMessage.info(t('layout.profile.thirdPartySoon'));
}
</script>

<template>
  <div class="profile-page">
    <div v-if="loading && !profile" class="profile-loading">
      <NomiSpinner :size="52" />
    </div>

    <div v-else-if="!profile" class="page-content profile-empty">
      <p>{{ t('layout.profile.loadFailed') }}</p>
      <button type="button" class="nomi-btn" @click="load">
        {{ t('action.retry') }}
      </button>
    </div>

    <div v-else class="nomi-grid nomi-grid--main profile-grid">
      <!-- 初始口令未改：横幅 + 自动弹窗之外再给一个常驻入口。
           用户关掉弹窗后，至少要能一眼看到「为什么别的菜单都点不动」。 -->
      <div v-if="profile.mustChangePassword" class="profile-alert" role="alert">
        <NomiIcon name="shield" :size="16" />
        <p>{{ t('layout.profile.passwordRequired') }}</p>
        <button type="button" class="nomi-btn" @click="openDialog('password')">
          {{ t('layout.profile.modify') }}
        </button>
      </div>

      <!-- 左：基本信息 -->
      <section class="page-content profile-basic">
        <div class="profile-banner" aria-hidden="true" />
        <div class="profile-body">
          <div class="profile-avatar">
            <img v-if="profile.avatar" :src="profile.avatar" :alt="displayName" />
            <span v-else>{{ avatarText }}</span>
          </div>

          <div class="profile-name">
            <strong>{{ displayName }}</strong>
            <span v-if="genderSymbol" class="profile-gender" :class="`is-${profile.gender}`">
              {{ genderSymbol }}
            </span>
          </div>
          <p class="profile-bio">
            {{ profile.motto || t('layout.profile.noBio') }}
          </p>

          <div class="profile-divider" />

          <h2 class="profile-section-title">
            <NomiIcon name="user" :size="15" />
            <span>{{ t('layout.profile.basicInfo') }}</span>
          </h2>
          <dl class="profile-info">
            <div v-for="item in infoItems" :key="item.key" class="profile-info-item">
              <dt>{{ item.label }}</dt>
              <dd :title="item.value">{{ item.value }}</dd>
            </div>
          </dl>
        </div>
      </section>

      <!-- 右：安全设置 + 第三方账号 -->
      <div class="profile-side">
        <section class="page-content">
          <h2 class="profile-section-title">
            <NomiIcon name="shield" :size="15" />
            <span>{{ t('layout.profile.security') }}</span>
          </h2>

          <div class="security-list">
            <div v-for="row in securityRows" :key="row.key" class="security-row">
              <span class="security-icon">
                <NomiIcon :name="row.icon" :size="17" />
              </span>
              <div class="security-main">
                <div class="security-head">
                  <strong>{{ row.title }}</strong>
                  <span class="security-badge" :class="row.bound ? 'is-on' : 'is-off'">
                    <NomiIcon v-if="row.bound" name="check" :size="11" :stroke-width="2.4" />
                    <NomiIcon v-else name="info" :size="11" />
                    {{ row.bound ? t('layout.profile.bound') : t('layout.profile.unbound') }}
                  </span>
                </div>
                <p class="security-detail">
                  <span v-if="row.detail" class="security-value">{{ row.detail }}</span>
                  <span class="security-desc">{{ row.desc }}</span>
                </p>
              </div>
              <button type="button" class="nomi-btn security-action" @click="openDialog(row.key)">
                {{ t('layout.profile.modify') }}
              </button>
            </div>
          </div>
        </section>

        <section class="page-content">
          <h2 class="profile-section-title">
            <NomiIcon name="link" :size="15" />
            <span>{{ t('layout.profile.thirdParty') }}</span>
          </h2>

          <div class="security-list">
            <div v-for="row in thirdPartyRows" :key="row.key" class="security-row">
              <span class="third-logo" :class="`is-${row.key}`">
                <!-- QQ / 微信是品牌标识：用填充剪影，不套 24×24 的描边图标表 -->
                <svg v-if="row.key === 'qq'" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path
                    d="M12 2.4c-2.7 0-4.5 2-4.5 4.6 0 .6 0 1.1.1 1.6-.6.8-1.2 1.9-1.5 3.1-.4 1.6-.2 2.6.4 2.8.3.1.7-.2 1-.7.1 1 .5 1.9.5 1.9-1 .5-1.7 1.5-1.7 2.3 0 1.4 1.4 2.5 3.3 2.8.6.1 1.2.2 1.9.2s1.3-.1 1.9-.2c1.9-.3 3.3-1.4 3.3-2.8 0-.8-.7-1.8-1.7-2.3 0 0 .4-.9.5-1.9.3.5.7.8 1 .7.6-.2.8-1.2.4-2.8-.3-1.2-.9-2.3-1.5-3.1.1-.5.1-1 .1-1.6 0-2.6-1.8-4.6-4.5-4.6Z"
                  />
                  <circle cx="9.6" cy="8.1" r="1.05" fill="#12b7f5" />
                  <circle cx="14.4" cy="8.1" r="1.05" fill="#12b7f5" />
                </svg>
                <svg v-else viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path
                    d="M9.1 3.1C5.4 3.1 2.4 5.6 2.4 8.7c0 1.8 1 3.5 2.5 4.5l-.6 2.1 2.4-1.2c.7.2 1.4.3 2.2.3h.4a5 5 0 0 1-.2-1.4c0-3 2.9-5.4 6.5-5.4h.5C15.4 4.6 12.5 3.1 9.1 3.1Z"
                  />
                  <path
                    d="M22 13.1c0-2.6-2.5-4.7-5.6-4.7s-5.6 2.1-5.6 4.7 2.5 4.7 5.6 4.7c.7 0 1.3-.1 1.9-.3l2 .9-.5-1.7c1.4-.8 2.2-2.1 2.2-3.6Z"
                  />
                </svg>
              </span>
              <div class="security-main">
                <div class="security-head">
                  <strong>{{ row.title }}</strong>
                  <span class="security-badge" :class="row.bound ? 'is-on' : 'is-off'">
                    {{ row.bound ? t('layout.profile.bound') : t('layout.profile.unbound') }}
                  </span>
                </div>
                <p class="security-detail">
                  <span class="security-desc">{{ row.desc }}</span>
                </p>
              </div>
              <button type="button" class="nomi-btn security-action" @click="bindThirdParty">
                {{ t('layout.profile.bind') }}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>

    <ElDialog
      v-model="dialogVisible"
      :title="dialogTitle"
      width="min(420px, calc(100vw - 32px))"
      destroy-on-close
      append-to-body
    >
      <!--
        validate-on-rule-change 关掉：rules 是随语言与弹窗类型重算的 computed，
        运行时译文到达时它换了引用，ElForm 会立刻跑一遍校验，把「请输入…」的红字
        全部点亮 —— 用户还没开始输入就先看到一屏错误。
      -->
      <ElForm
        ref="formRef"
        :model="form"
        :rules="formRules"
        :validate-on-rule-change="false"
        label-width="auto"
      >
        <template v-if="dialogKey === 'password'">
          <ElFormItem :label="t('layout.profile.currentPassword')" prop="password">
            <ElInput
              v-model="form.password"
              type="password"
              show-password
              autocomplete="current-password"
            />
          </ElFormItem>
          <ElFormItem :label="t('layout.profile.newPassword')" prop="newPassword">
            <ElInput
              v-model="form.newPassword"
              type="password"
              show-password
              autocomplete="new-password"
              :placeholder="t('layout.profile.passwordPolicyShort')"
            />
          </ElFormItem>
          <ElFormItem :label="t('layout.profile.confirmPassword')" prop="confirmPassword">
            <ElInput
              v-model="form.confirmPassword"
              type="password"
              show-password
              autocomplete="new-password"
              @keyup.enter="submit"
            />
          </ElFormItem>
        </template>
        <template v-else>
          <ElFormItem :label="valueLabel" prop="value">
            <ElInput v-model="form.value" clearable :placeholder="valuePlaceholder" />
          </ElFormItem>
          <ElFormItem :label="t('layout.profile.currentPassword')" prop="password">
            <ElInput
              v-model="form.password"
              type="password"
              show-password
              autocomplete="current-password"
              @keyup.enter="submit"
            />
          </ElFormItem>
        </template>
      </ElForm>
      <template #footer>
        <ElButton @click="dialogVisible = false">{{ t('action.cancel') }}</ElButton>
        <ElButton type="primary" :loading="submitting" @click="submit">
          {{ t('action.save') }}
        </ElButton>
      </template>
    </ElDialog>
  </div>
</template>

<style scoped>
.profile-page {
  min-height: 240px;
}

.profile-loading {
  display: grid;
  padding: 80px 0;
  place-items: center;
}

.profile-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 60px 20px;
  font-size: 13px;
  color: var(--fg-muted);
}

.profile-grid {
  align-items: start;
  /* 1.7fr / 1fr 时右栏只有 ~310px：号码 + 说明挤成三行，徽标和「修改」也贴得很近。
     1.55fr 让右栏拿到 ~420px，左栏仍然是最宽的一块。 */
  grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr);
}

/* 初始口令提示条：横跨两栏，跟着警告色走，和普通卡片区分开。 */
.profile-alert {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  grid-column: 1 / -1;
  color: var(--el-color-warning-dark-2);
  background: var(--el-color-warning-light-9);
  border: 1px solid var(--el-color-warning-light-7);
  border-radius: 12px;
}

.profile-alert p {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  line-height: 1.5;
}

.profile-side {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

/* ---------------------------------------------------------------------------
 * 基本信息卡：背景条要贴到卡片边缘，所以覆盖全局 .page-content 的 20px 内边距。
 * 选择器多带一个类名才压得住 #app-content .page-content 的 id 权重。
 * ------------------------------------------------------------------------- */
#app-content .page-content.profile-basic {
  padding: 0;
}

.profile-banner {
  position: relative;
  height: 132px;
  background:
    radial-gradient(120% 150% at 8% 0%, color-mix(in srgb, var(--el-color-primary) 55%, #7c3aed) 0%, transparent 62%),
    linear-gradient(118deg, var(--el-color-primary) 6%, color-mix(in srgb, var(--el-color-primary) 55%, #0ea5e9) 100%);
}

/* 细网点：纯色渐变在浅色主题下有点空，一层 1px 网点让它像「背景图」而不是色块 */
.profile-banner::after {
  position: absolute;
  background-image: radial-gradient(rgb(255 255 255 / 38%) 1px, transparent 1px);
  background-size: 16px 16px;
  content: '';
  inset: 0;
  opacity: 0.7;
}

.profile-body {
  padding: 0 24px 22px;
}

/* 圆形头像压在背景条的下沿：上移半个圆，一半在图上、一半在卡里 */
.profile-avatar {
  position: relative;
  display: flex;
  width: 88px;
  height: 88px;
  align-items: center;
  justify-content: center;
  margin: -44px auto 0;
  overflow: hidden;
  color: #fff;
  background: linear-gradient(135deg, var(--el-color-primary), color-mix(in srgb, var(--el-color-primary) 45%, #7c3aed));
  border: 4px solid var(--nomi-card);
  border-radius: 50%;
  box-shadow: 0 8px 20px rgb(15 23 42 / 14%);
  font-size: 30px;
  font-weight: 700;
}

.profile-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.profile-name {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 12px;
}

.profile-name strong {
  font-size: 18px;
  font-weight: 650;
  letter-spacing: -0.01em;
}

.profile-gender {
  font-size: 17px;
  font-weight: 700;
  line-height: 1;
}

.profile-gender.is-male {
  color: #2563eb;
}

.profile-gender.is-female {
  color: #db2777;
}

.profile-bio {
  max-width: 460px;
  margin: 8px auto 0;
  color: var(--fg-muted);
  font-size: 13px;
  line-height: 1.65;
  text-align: center;
}

.profile-divider {
  height: 1px;
  margin: 20px 0 18px;
  background: var(--nomi-border);
}

.profile-section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 14px;
  color: var(--fg);
  font-size: 14px;
  font-weight: 600;
}

.profile-section-title :deep(svg) {
  color: var(--el-color-primary);
}

.profile-info {
  display: grid;
  margin: 0;
  gap: 16px 20px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.profile-info-item {
  min-width: 0;
}

.profile-info-item dt {
  color: var(--fg-muted);
  font-size: 12px;
}

.profile-info-item dd {
  overflow: hidden;
  margin: 5px 0 0;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

/* ---------------------------------------------------------------------------
 * 安全设置 / 第三方账号：一行一条，图标 — 文案 — 操作
 * ------------------------------------------------------------------------- */
.security-list {
  display: flex;
  flex-direction: column;
}

.security-row {
  display: grid;
  align-items: center;
  padding: 14px 0;
  border-bottom: 1px dashed var(--nomi-border);
  gap: 12px;
  grid-template-columns: 38px minmax(0, 1fr) auto;
}

.security-row:first-child {
  padding-top: 0;
}

.security-row:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}

.security-icon {
  display: inline-flex;
  width: 38px;
  height: 38px;
  align-items: center;
  justify-content: center;
  color: var(--el-color-primary);
  background: var(--nomi-hover);
  border-radius: 10px;
}

.third-logo {
  display: inline-flex;
  width: 38px;
  height: 38px;
  align-items: center;
  justify-content: center;
  color: #fff;
  border-radius: 10px;
}

.third-logo svg {
  width: 24px;
  height: 24px;
}

.third-logo.is-qq {
  background: #12b7f5;
}

.third-logo.is-wechat {
  background: #07c160;
}

.security-main {
  min-width: 0;
}

.security-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.security-head strong {
  font-size: 13px;
  font-weight: 550;
}

.security-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  gap: 3px;
  white-space: nowrap;
}

.security-badge.is-on {
  color: #16a34a;
  background: rgb(22 163 74 / 10%);
}

.security-badge.is-off {
  color: #d97706;
  background: rgb(217 119 6 / 10%);
}

.security-detail {
  /* 号码与说明走行内流而不是 flex：说明放不下时自然折到下一行，折行后的起点
     与号码左边缘对齐（flex 会把说明挤成一个几字宽的小窄条，折成三行参差不齐）。 */
  display: block;
  margin: 4px 0 0;
  color: var(--fg-muted);
  font-size: 12px;
  line-height: 1.55;
}

.security-value {
  margin-right: 6px;
  color: var(--fg);
  font-weight: 500;
  white-space: nowrap;
}

.security-desc {
  min-width: 0;
}

.security-action {
  height: 28px;
  padding: 0 12px;
  font-size: 12px;
}

@media (max-width: 1180px) {
  /* 必须在这里把列数写回来：页面上方那条 1.55fr / 1fr 的规则权重比全局
     .nomi-grid--main 的媒体查询高，不覆盖的话 390px 下右栏会被挤成一条窄缝。 */
  .profile-grid {
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
  }
}

@media (max-width: 640px) {
  .profile-body {
    padding: 0 16px 18px;
  }

  .profile-info {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .security-row {
    grid-template-columns: 34px minmax(0, 1fr);
  }

  .security-icon,
  .third-logo {
    width: 34px;
    height: 34px;
  }

  /* 窄屏把「修改 / 绑定」挪到文字下方，避免挤掉描述 */
  .security-action {
    grid-column: 2;
    justify-self: start;
  }
}

/* 320px 级窄屏才降到单列：390px 的两列仍然放得下「138****8888」这种长度，
   单列会把六个字段拉成很长一条，滚动距离白白翻倍。 */
@media (max-width: 360px) {
  .profile-info {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
