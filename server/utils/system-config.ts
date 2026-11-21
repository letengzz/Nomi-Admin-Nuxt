/**
 * 系统配置的唯一事实来源。
 *
 * 配置按「区块 + 键」一行存：没写过的键直接回落到 DEFAULT_CONFIG，所以
 * 「恢复默认」= 删掉该区块的行，不需要把默认值再写一遍；老库新增字段时
 * 也不用迁移数据，读的时候自然拿到新默认值。
 *
 * 前端拿到的永远是合并后的完整对象；写接口只接受白名单里的键，
 * 数值范围在这里兜底，页面上的 min/max 只是第一道闸。
 */
import type { RowDataPacket } from 'mysql2';
import { getPool } from '../database/pool';

export interface SiteConfig {
  logo: string;
  favicon: string;
  name: string;
  description: string;
  /** 是否在后台页脚 / 授权页底部展示版权声明与备案号。 */
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
  /** 开启后普通用户只能看到维护提示页，超管仍可进后台关掉它。 */
  maintenanceEnabled: boolean;
  /** 关闭后注册接口直接拒绝，登录页也隐藏注册入口。 */
  registrationEnabled: boolean;
}

/** 邮件发送服务参数。密码类字段只存值，读取时按是否已配置给前端掩码提示。 */
export interface EmailConfig {
  enabled: boolean;
  host: string;
  port: number;
  /** ssl / tls / none：SSL=465 直连，TLS=587 STARTTLS，none=不加密。 */
  encryption: string;
  fromAddress: string;
  fromName: string;
  username: string;
  password: string;
}

/** 附件存储参数。本地目录/访问域名给前端展示用，真正落盘路径由上传接口统一管理。 */
export interface StorageConfig {
  /** local / oss，目前上传落地仍走本地目录，oss 仅记录参数。 */
  driver: string;
  localDir: string;
  publicUrl: string;
  /** 单文件大小上限，单位 MB。 */
  maxFileSize: number;
  /** 允许的文件扩展名，逗号分隔。 */
  allowedExtensions: string;
}

/**
 * 运行环境标记。
 *
 * 不改编译期 NODE_ENV —— 那由部署方决定，后台改不了也不该改。这里存的是
 * 「这套部署对外宣称自己是什么环境」，用于两件不涉及构建的事：
 *   ① 顶栏角标：让人一眼看出自己是不是在生产库上操作；
 *   ② SEO 兜底：非生产环境默认不该被搜索引擎收录。
 */
export interface EnvironmentConfig {
  /** development / testing / production，取值由 SCHEMAS 里的下拉约束，服务端只做长度兜底。 */
  current: string;
  /** 顶栏是否显示环境角标。生产环境也建议开着，误操作代价比碍眼大得多。 */
  showBadge: boolean;
  /** 三套环境的访问地址：切到哪套，角标提示与 canonical 兜底就用哪套。 */
  devUrl: string;
  testUrl: string;
  prodUrl: string;
}

/** 站点 SEO 参数。真正的 head 注入在 app.vue，这里只是值。 */
export interface SeoConfig {
  /** 标题模板，必须含 %s；留空则回落到「%s | 站点名」。 */
  titleTemplate: string;
  /** SEO 描述，留空回落到 site.description。 */
  description: string;
  keywords: string;
  /** 社交分享图（og:image），留空则不输出 og:image。 */
  ogImage: string;
  /** canonical 域名前缀，留空回落到当前环境的访问地址。 */
  canonicalBase: string;
  /** 是否允许搜索引擎收录；后台站点默认建议关闭。 */
  allowIndexing: boolean;
  /** og:type —— website / article，长尾页面可自行填。 */
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

export const DEFAULT_CONFIG: SystemConfig = {
  site: {
    logo: '',
    favicon: '',
    name: 'Nomi Admin',
    description: '基于 Nuxt 4 的企业级中后台模板',
    copyrightEnabled: true,
    copyright: '© 2026 Nomi Admin',
    icp: '',
  },
  security: {
    loginFailLimit: 5,
    lockMinutes: 30,
    passwordExpireDays: 90,
    passwordExpireRemindDays: 7,
    passwordHistoryLimit: 3,
    passwordMinLength: 8,
    allowPasswordUsername: false,
    requireSpecialChar: true,
  },
  login: {
    captchaEnabled: true,
    maintenanceEnabled: false,
    registrationEnabled: true,
  },
  email: {
    enabled: false,
    host: '',
    port: 465,
    encryption: 'ssl',
    fromAddress: '',
    fromName: '',
    username: '',
    password: '',
  },
  storage: {
    driver: 'local',
    localDir: 'data/uploads',
    publicUrl: '',
    maxFileSize: 2,
    allowedExtensions: 'png,jpg,jpeg,gif,webp,ico,svg,pdf,doc,docx,xls,xlsx',
  },
  environment: {
    current: 'development',
    showBadge: true,
    devUrl: '',
    testUrl: '',
    prodUrl: '',
  },
  seo: {
    titleTemplate: '',
    description: '',
    keywords: '',
    ogImage: '',
    canonicalBase: '',
    allowIndexing: false,
    ogType: 'website',
  },
};

type FieldType = 'string' | 'number' | 'boolean';

interface FieldSpec {
  type: FieldType;
  min?: number;
  max?: number;
  maxLength?: number;
  /** 枚举型字符串：只接受列出的取值，传别的回落到默认值。 */
  options?: readonly string[];
}

type SectionSchema = Record<string, FieldSpec>;

const SCHEMAS: Record<ConfigSection, SectionSchema> = {
  site: {
    logo: { type: 'string', maxLength: 500 },
    favicon: { type: 'string', maxLength: 500 },
    name: { type: 'string', maxLength: 100 },
    description: { type: 'string', maxLength: 500 },
    copyrightEnabled: { type: 'boolean' },
    copyright: { type: 'string', maxLength: 200 },
    icp: { type: 'string', maxLength: 100 },
  },
  security: {
    loginFailLimit: { type: 'number', min: 1, max: 20 },
    lockMinutes: { type: 'number', min: 1, max: 1440 },
    passwordExpireDays: { type: 'number', min: 0, max: 3650 },
    passwordExpireRemindDays: { type: 'number', min: 0, max: 365 },
    passwordHistoryLimit: { type: 'number', min: 0, max: 20 },
    passwordMinLength: { type: 'number', min: 4, max: 64 },
    allowPasswordUsername: { type: 'boolean' },
    requireSpecialChar: { type: 'boolean' },
  },
  login: {
    captchaEnabled: { type: 'boolean' },
    maintenanceEnabled: { type: 'boolean' },
    registrationEnabled: { type: 'boolean' },
  },
  email: {
    enabled: { type: 'boolean' },
    host: { type: 'string', maxLength: 200 },
    port: { type: 'number', min: 1, max: 65535 },
    encryption: { type: 'string', maxLength: 20 },
    fromAddress: { type: 'string', maxLength: 200 },
    fromName: { type: 'string', maxLength: 100 },
    username: { type: 'string', maxLength: 200 },
    password: { type: 'string', maxLength: 500 },
  },
  storage: {
    driver: { type: 'string', maxLength: 20 },
    localDir: { type: 'string', maxLength: 300 },
    publicUrl: { type: 'string', maxLength: 500 },
    maxFileSize: { type: 'number', min: 1, max: 1024 },
    allowedExtensions: { type: 'string', maxLength: 1000 },
  },
  environment: {
    current: { type: 'string', options: ['development', 'testing', 'production'] },
    showBadge: { type: 'boolean' },
    devUrl: { type: 'string', maxLength: 300 },
    testUrl: { type: 'string', maxLength: 300 },
    prodUrl: { type: 'string', maxLength: 300 },
  },
  seo: {
    titleTemplate: { type: 'string', maxLength: 200 },
    description: { type: 'string', maxLength: 500 },
    keywords: { type: 'string', maxLength: 500 },
    ogImage: { type: 'string', maxLength: 500 },
    canonicalBase: { type: 'string', maxLength: 300 },
    allowIndexing: { type: 'boolean' },
    ogType: { type: 'string', options: ['website', 'article', 'product', 'profile'] },
  },
};

interface ConfigRow extends RowDataPacket {
  section: string;
  config_key: string;
  config_value: string;
}

/** 默认值深拷贝：调用方改了返回对象也不能污染 DEFAULT_CONFIG。 */
export function defaultConfig(): SystemConfig {
  return {
    site: { ...DEFAULT_CONFIG.site },
    security: { ...DEFAULT_CONFIG.security },
    login: { ...DEFAULT_CONFIG.login },
    email: { ...DEFAULT_CONFIG.email },
    storage: { ...DEFAULT_CONFIG.storage },
    environment: { ...DEFAULT_CONFIG.environment },
    seo: { ...DEFAULT_CONFIG.seo },
  };
}

function isSection(value: unknown): value is ConfigSection {
  return typeof value === 'string' && value in SCHEMAS;
}

function fromStored(raw: string, spec: FieldSpec, fallback: unknown): string | number | boolean {
  if (spec.type === 'boolean') return raw === '1' || raw === 'true';
  if (spec.type === 'number') {
    const num = Number(raw);
    if (!Number.isFinite(num)) return fallback as number;
    const min = spec.min ?? 0;
    const max = spec.max ?? Number.MAX_SAFE_INTEGER;
    return Math.min(max, Math.max(min, Math.round(num)));
  }
  // 枚举值可能是历史遗留（比如改过选项），不认识就回落默认值，别把脏值透给前端。
  if (spec.options && !spec.options.includes(raw)) return fallback as string;
  return raw;
}

function toStored(value: unknown, spec: FieldSpec, fallback: unknown): string {
  if (spec.type === 'boolean') return value ? '1' : '0';
  if (spec.type === 'number') {
    const num = typeof value === 'number' && Number.isFinite(value) ? value : (fallback as number);
    const min = spec.min ?? 0;
    const max = spec.max ?? Number.MAX_SAFE_INTEGER;
    return String(Math.min(max, Math.max(min, Math.round(num))));
  }
  const raw = typeof value === 'string' ? value.trim().slice(0, spec.maxLength ?? 500) : '';
  if (spec.options && !spec.options.includes(raw)) return String(fallback);
  return raw;
}

/** 整份配置：库里没有的行自动补默认值。 */
export async function loadSystemConfig(): Promise<SystemConfig> {
  const result = defaultConfig();
  const pool = getPool();
  const [rows] = await pool.query<ConfigRow[]>(
    'SELECT `section`,`config_key`,`config_value` FROM `system_config`',
  );

  for (const row of rows) {
    if (!isSection(row.section)) continue;
    const spec = SCHEMAS[row.section][row.config_key];
    if (!spec) continue;
    const bucket = result[row.section] as unknown as Record<string, string | number | boolean>;
    const fallback = (DEFAULT_CONFIG[row.section] as unknown as Record<string, unknown>)[row.config_key];
    bucket[row.config_key] = fromStored(row.config_value ?? '', spec, fallback);
  }
  return result;
}

/** 登录页只需要一个开关，别把安全策略/站点信息一起推到免登录接口。 */
export async function loadLoginConfig(): Promise<LoginConfig> {
  const config = await loadSystemConfig();
  const { captchaEnabled, maintenanceEnabled, registrationEnabled } = config.login;
  return { captchaEnabled, maintenanceEnabled, registrationEnabled };
}

/**
 * 保存一个区块：只写 body 里出现的白名单键。
 * 传了非法区块就直接报错，避免调用方拼错 section 后「保存成功但没生效」。
 */
export async function saveSectionConfig(section: string, values: unknown): Promise<void> {
  if (!isSection(section) || Object.keys(SCHEMAS[section]).length === 0) {
    throw new Error('未知的配置区块');
  }
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    throw new Error('配置内容格式不正确');
  }

  const schema = SCHEMAS[section];
  const defaults = DEFAULT_CONFIG[section] as unknown as Record<string, unknown>;
  const entries: Array<[string, string]> = [];
  for (const [key, spec] of Object.entries(schema)) {
    if (!Object.prototype.hasOwnProperty.call(values, key)) continue;
    entries.push([key, toStored((values as Record<string, unknown>)[key], spec, defaults[key])]);
  }
  if (entries.length === 0) return;

  const pool = getPool();
  const ts = Math.floor(Date.now() / 1000);
  for (const [key, value] of entries) {
    await pool.query(
      `INSERT INTO \`system_config\` (\`section\`,\`config_key\`,\`config_value\`,\`update_time\`)
       VALUES (?,?,?,?)
       ON DUPLICATE KEY UPDATE \`config_value\` = VALUES(\`config_value\`), \`update_time\` = VALUES(\`update_time\`)`,
      [section, key, value, ts],
    );
  }
}

/** 恢复默认：删掉区块所有覆盖行，读取时自然回落到 DEFAULT_CONFIG。 */
export async function resetSectionConfig(section: string): Promise<void> {
  if (!isSection(section)) throw new Error('未知的配置区块');
  const pool = getPool();
  await pool.query('DELETE FROM `system_config` WHERE `section` = ?', [section]);
}
