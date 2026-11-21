/**
 * 注册表单的纯逻辑层：长度常量 + 校验矩阵。
 *
 * 与组件分离的收益（docs/注册页设计.md 2.4 / 10 章）：
 *   ① 校验规则不依赖 Vue / Element Plus，可以直接单测；
 *   ② 组件只负责把返回的 i18n key 翻成当前语言文案，切语言时 computed 自动重算；
 *   ③ 服务端与前端共用同一组长度常量，不会出现「前端放行、后端拒绝」。
 */
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;
export const PASSWORD_MIN_LENGTH = 6;
export const REDIRECT_DELAY = 1000;
export const POLICY_VERSION = '1.0';

export interface RegisterDraft {
  username: string;
  password: string;
  confirmPassword: string;
  agreement: boolean;
}

export type RegisterField = keyof RegisterDraft;

/** 一条违规：key 是 i18n 文案键，params 供 vue-i18n 插值（如 {min} / {max}）。 */
export interface RegisterViolation {
  key: string;
  params?: Record<string, number>;
}

export function createEmptyDraft(): RegisterDraft {
  return { username: '', password: '', confirmPassword: '', agreement: false };
}

// ---------------------------------------------------------------------------
// 切语言草稿
//
// Nuxt i18n 的 switchLocalePath 会产生一次真实导航（/register → /en/register），
// 页面组件被重新挂载，reactive 表单会整个清空，比原模板的「丢焦点 + 丢校验态」
// 更严重。这里只把**账号名和协议勾选**存进 sessionStorage：密码与确认密码
// 绝不落盘（文档 17.21），会话结束即失效，也不跨设备同步。
// ---------------------------------------------------------------------------
export const REGISTER_DRAFT_KEY = 'nomi:register-draft';

export interface RegisterDraftSnapshot {
  username: string;
  agreement: boolean;
}

function draftStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    // 隐私模式 / 存储被禁用时静默降级。
    return null;
  }
}

export function readRegisterDraft(): RegisterDraftSnapshot | null {
  const storage = draftStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(REGISTER_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RegisterDraftSnapshot>;
    return {
      username:
        typeof parsed.username === 'string'
          ? parsed.username.slice(0, USERNAME_MAX_LENGTH)
          : '',
      agreement: parsed.agreement === true,
    };
  } catch {
    // 草稿损坏就当没有，不能让它挡住注册页渲染。
    return null;
  }
}

export function saveRegisterDraft(snapshot: RegisterDraftSnapshot): void {
  try {
    draftStorage()?.setItem(REGISTER_DRAFT_KEY, JSON.stringify(snapshot));
  } catch {
    // 写入配额不足时不影响表单本身。
    return;
  }
}

export function clearRegisterDraft(): void {
  try {
    draftStorage()?.removeItem(REGISTER_DRAFT_KEY);
  } catch {
    return;
  }
}

/**
 * 从接口异常里提取业务码。
 *
 * $fetch 对非 2xx 抛的是 FetchError，其 data 是**整个响应体**，所以
 * createError({ data: { code } }) 里的 code 在 data.data.code；
 * 而业务层主动抛出的 Error 可能只带 data.code 或裸 statusCode。
 * 三种结构都兼容，才能让「账号已存在」在英文界面也翻译成对应文案。
 */
export function registerErrorCode(error: unknown): number | undefined {
  const value = error as {
    statusCode?: number;
    status?: number;
    data?: { code?: number; data?: { code?: number } };
  } | null;
  return (
    value?.data?.data?.code ?? value?.data?.code ?? value?.statusCode ?? value?.status
  );
}

/**
 * 校验单个字段。返回 null 表示通过。
 *
 * 一致性校验直接读 draft.password（跨字段 validator），不引入额外状态；
 * 协议用布尔判断，没有「失焦」概念，由 ElFormItem 的 change 触发。
 */
export function validateRegisterField(
  field: RegisterField,
  draft: RegisterDraft,
): RegisterViolation | null {
  switch (field) {
    case 'username': {
      const value = draft.username.trim();
      if (!value) return { key: 'register.rule.usernameRequired' };
      if (value.length < USERNAME_MIN_LENGTH || value.length > USERNAME_MAX_LENGTH) {
        return {
          key: 'register.rule.usernameLength',
          params: { min: USERNAME_MIN_LENGTH, max: USERNAME_MAX_LENGTH },
        };
      }
      return null;
    }
    case 'password': {
      if (!draft.password) return { key: 'register.rule.passwordRequired' };
      if (draft.password.length < PASSWORD_MIN_LENGTH) {
        return { key: 'register.rule.passwordLength', params: { min: PASSWORD_MIN_LENGTH } };
      }
      return null;
    }
    case 'confirmPassword': {
      if (!draft.confirmPassword) return { key: 'register.rule.confirmPasswordRequired' };
      if (draft.confirmPassword !== draft.password) return { key: 'register.rule.passwordMismatch' };
      return null;
    }
    case 'agreement': {
      if (!draft.agreement) return { key: 'register.rule.agreementRequired' };
      return null;
    }
    default:
      return null;
  }
}
