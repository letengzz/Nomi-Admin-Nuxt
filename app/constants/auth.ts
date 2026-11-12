/**
 * 登录页演示数据。
 *
 * 仅用于模板演示，让登录页「打开即可点登录」。生产环境必须删掉本文件里的
 * 账号与密码，改为真实账号体系（见 docs/登录页设计参考文档.md 13.4 / 13.5）。
 */
export const AUTH_BRAND_NAME = 'Nomi Admin';

export const DEMO_PASSWORD = '123456';

export const REMEMBERED_ACCOUNT_KEY = 'nomi:last-account';

export interface DemoAccount {
  key: 'super' | 'admin' | 'user';
  userName: string;
}

export type DemoAccountKey = DemoAccount['key'];

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  { key: 'super', userName: 'super' },
  { key: 'admin', userName: 'admin' },
  { key: 'user', userName: 'user' },
];
