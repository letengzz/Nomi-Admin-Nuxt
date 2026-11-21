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
