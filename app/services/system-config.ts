/**
 * 系统配置接口封装。管理端三个接口走统一鉴权请求器，
 * 登录页那个是公开的，单独用 callApi 并给出「接口挂了就仍然要验证码」的兜底。
 */
import { callApi } from '../utils/api';
import { apiFetch } from '../utils/request';

export interface SiteConfig {
  logo: string;
  favicon: string;
  name: string;
  description: string;
  copyrightEnabled: boolean;
  copyright: string;
  icp: string;
}

export interface SecurityConfig {
  loginFailLimit: number;
  lockMinutes: number;
  passwordExpireDays: number;
  passwordExpireRemindDays: number;
  passwordHistoryLimit: number;
  passwordMinLength: number;
  allowPasswordUsername: boolean;
  requireSpecialChar: boolean;
}

export interface LoginConfig {
  captchaEnabled: boolean;
  maintenanceEnabled: boolean;
  registrationEnabled: boolean;
}

export interface EmailConfig {
  enabled: boolean;
  host: string;
  port: number;
  encryption: string;
  fromAddress: string;
  fromName: string;
  username: string;
  password: string;
}

export interface StorageConfig {
  driver: string;
  localDir: string;
  publicUrl: string;
  maxFileSize: number;
  allowedExtensions: string;
}

export interface EnvironmentConfig {
  /** development / testing / production */
  current: string;
  showBadge: boolean;
  devUrl: string;
  testUrl: string;
  prodUrl: string;
}

export interface SeoConfig {
  titleTemplate: string;
  description: string;
  keywords: string;
  ogImage: string;
  canonicalBase: string;
  allowIndexing: boolean;
  ogType: string;
}

export interface SystemConfig {
  site: SiteConfig;
  security: SecurityConfig;
  login: LoginConfig;
  email: EmailConfig;
  storage: StorageConfig;
  environment: EnvironmentConfig;
  seo: SeoConfig;
}

export type ConfigSection = keyof SystemConfig;

/**
 * 前端兜底值，和服务端 `server/utils/system-config.ts` 的 DEFAULT_CONFIG 保持一致。
 * 只在接口返回前撑住表单，真正的默认值永远由服务端返回。
 */
export const EMPTY_SYSTEM_CONFIG: SystemConfig = {
  site: {
    logo: '', favicon: '', name: '', description: '', copyrightEnabled: true, copyright: '', icp: '',
  },
  security: {
    loginFailLimit: 5, lockMinutes: 30, passwordExpireDays: 90,
    passwordExpireRemindDays: 7, passwordHistoryLimit: 3,
    passwordMinLength: 8, allowPasswordUsername: false, requireSpecialChar: true,
  },
  login: {
    captchaEnabled: true,
    maintenanceEnabled: false,
    registrationEnabled: true,
  },
  email: {
    enabled: false, host: '', port: 465, encryption: 'ssl',
    fromAddress: '', fromName: '', username: '', password: '',
  },
  storage: {
    driver: 'local', localDir: 'data/uploads', publicUrl: '',
    maxFileSize: 2, allowedExtensions: 'png,jpg,jpeg,gif,webp,ico,svg,pdf,doc,docx,xls,xlsx',
  },
  environment: {
    current: 'development', showBadge: true, devUrl: '', testUrl: '', prodUrl: '',
  },
  seo: {
    titleTemplate: '', description: '', keywords: '', ogImage: '',
    canonicalBase: '', allowIndexing: false, ogType: 'website',
  },
};

export function fetchSystemConfig(): Promise<SystemConfig> {
  return apiFetch<SystemConfig>('/api/admin/settings');
}

export function saveSystemConfig(
  section: ConfigSection,
  values: Partial<SystemConfig[ConfigSection]>,
): Promise<SystemConfig> {
  return apiFetch<SystemConfig>('/api/admin/settings/save', {
    method: 'POST',
    body: { section, values },
  });
}

export function resetSystemConfig(section: ConfigSection): Promise<SystemConfig> {
  return apiFetch<SystemConfig>('/api/admin/settings/reset', {
    method: 'POST',
    body: { section },
  });
}

/** 上传站点 LOGO / 图标，返回可直接写进配置的图片地址。 */
export async function uploadSiteImage(kind: 'logo' | 'favicon', file: File): Promise<string> {
  const body = new FormData();
  body.append('kind', kind);
  body.append('file', file, file.name);
  const result = await apiFetch<{ url: string }>('/api/admin/settings/upload', {
    method: 'POST',
    body,
  });
  return result.url;
}

/**
 * 用**已保存**的邮件配置发一封自检邮件。
 *
 * 只传收件人：SMTP 参数一律由服务端从库里读，避免这个接口变成
 * 「用任意服务器发任意邮件」的代理。改完配置记得先保存再点测试。
 */
export function sendTestMail(to: string): Promise<{ to: string }> {
  return apiFetch<{ to: string }>('/api/admin/settings/test-email', {
    method: 'POST',
    body: { to },
  });
}

export async function fetchLoginConfig(): Promise<LoginConfig> {
  try {
    const response = await callApi<LoginConfig>('/api/auth/login-config');
    if (response?.code === 200 && response.data) return response.data;
  } catch {
    // 配置读不到时保持验证码开启，不能因为接口异常就悄悄放宽登录校验。
  }
  return { captchaEnabled: true, maintenanceEnabled: false, registrationEnabled: true };
}
