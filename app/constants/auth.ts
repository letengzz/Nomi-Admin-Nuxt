/**
 * 登录页演示数据。
 *
 * 仅用于模板演示，让登录页「打开即可点登录」。生产环境必须删掉本文件里的
 * 账号与密码，改为真实账号体系（见 docs/登录页设计参考文档.md 13.4 / 13.5）。
 *
 * 选择器从「角色」换成「部门」之后，演示账号与部门的对应关系放在这里：
 * 部门表是真实数据（来自 `/api/auth/departments`），但「哪个部门能一键登录」
 * 只是演示脚本的一部分，不该混进业务表。
 */
export const AUTH_BRAND_NAME = 'Nomi Admin';

export const DEMO_PASSWORD = '123456';

export const REMEMBERED_ACCOUNT_KEY = 'nomi:last-account';

/**
 * 「记住密码」要回填密码，所以账号、密码、勾选状态三者一起持久化：
 * - 账号：REMEMBERED_ACCOUNT_KEY
 * - 密码：REMEMBERED_PASSWORD_KEY（可逆编码存放，见 storage-key.ts，不是裸明文）
 * - 勾选状态：本键，1 = 记住，0 = 都不记住
 *
 * 产品决策（2026-11）覆盖了 docs/登录页设计参考文档.md 9.5 / 13.7 里
 * 「不要存密码」的建议：用户明确要求刷新后密码框自动回填。
 * 安全上的真实边界是同源策略 + XSS 防护；更稳妥的持久凭据应交给浏览器
 * 原生密码管理器（登录框已开启 autocomplete=username/current-password）。
 * 服务端 refresh token 仍负责「长期登录」，与本处的表单回填互不替代。
 */
export const REMEMBER_LOGIN_KEY = 'nomi:remember-login';

/** 记住密码时保存的可逆编码口令；不勾选时与账号一起删除。 */
export const REMEMBERED_PASSWORD_KEY = 'nomi:last-password';

export interface DemoAccount {
  /** 与 seed 里 department 的 id 对齐：1 总经办 / 2 技术中心 / 8 市场运营中心 */
  departmentId: number;
  userName: string;
}

/**
 * 三个演示账号（密码统一 123456），分别挂在三个不同的部门下：
 *   1 总经办 → super（超管）
 *   2 技术中心 → admin（管理员）
 *   8 市场运营中心 → user（普通用户）
 *
 * 部门被人删掉时这里匹配不到，登录页会退化成「手动输入账号」，不会报错。
 */
export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  { departmentId: 1, userName: 'super' },
  { departmentId: 2, userName: 'admin' },
  { departmentId: 8, userName: 'user' },
];
