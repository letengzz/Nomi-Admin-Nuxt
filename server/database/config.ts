/**
 * MySQL 连接配置。
 *
 * 全部走环境变量，且**不通过 runtimeConfig 暴露给前端**（public 里没有它们）。
 * 默认值只面向本机开发：MySQL 8 装了就能跑，不改任何配置。
 *
 * 生产必须设置 MYSQL_PASSWORD 与 TOKEN_SECRET —— 后者决定 token 的 HMAC 密钥，
 * 换掉它等于让所有已登录会话立即失效（这本身也是一个可用的「强制下线」手段）。
 */
export interface DbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  connectionLimit: number;
  /** token 表的 HMAC 密钥，缺省时退化为固定串并打警告 */
  tokenSecret: string;
}

function readInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function getDbConfig(): DbConfig {
  return {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: readInt('MYSQL_PORT', 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD ?? '',
    database: process.env.MYSQL_DATABASE || 'nomi_admin',
    connectionLimit: readInt('MYSQL_POOL_SIZE', 10),
    tokenSecret:
      process.env.TOKEN_SECRET || 'nomi-admin-dev-token-secret-change-me-in-production',
  };
}

/** 数据库名会拼进 DDL，只允许标识符字符，避免配置写错变成注入点。 */
export function assertSafeDatabaseName(name: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(`MYSQL_DATABASE 只允许字母、数字和下划线，当前值：${name}`);
  }
  return name;
}
