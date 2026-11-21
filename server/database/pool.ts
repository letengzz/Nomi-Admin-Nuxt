/**
 * MySQL 连接池。
 *
 * 为什么用全局缓存：Nuxt 开发模式会反复重载服务端模块，每次重载都新建一个池
 * 就是「连接数缓慢泄漏」。挂到 globalThis 上，热更新时复用同一个池。
 *
 * 这里只负责「连上库」，建库/建表/种子在 init.ts —— 一个负责连接、一个负责
 * 结构，排查问题时能立刻分清是「连不上」还是「表没建对」。
 */
import mysql, { type Pool } from 'mysql2/promise';
import { assertSafeDatabaseName, getDbConfig } from './config';

const POOL_KEY = Symbol.for('nomi.admin.mysql.pool');

interface GlobalWithPool {
  [POOL_KEY]?: Pool;
}

let closing = false;

/** 建池（不验证库是否存在，createConnection 是惰性的，首次查询才真正连）。 */
export function createPool(): Pool {
  const config = getDbConfig();
  const database = assertSafeDatabaseName(config.database);
  const pool = mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database,
    waitForConnections: true,
    connectionLimit: config.connectionLimit,
    queueLimit: 0,
    charset: 'utf8mb4_unicode_ci',
    // 权限相关查询都是小结果集，但 operation_log 的 data 可能较长，
    // 默认的 16MB 上限足够，不需要 jsonStrings 之类的特殊处理。
    timezone: 'Z',
  });

  const globalStore = globalThis as GlobalWithPool;
  globalStore[POOL_KEY] = pool;
  closing = false;
  return pool;
}

/** 取当前池；没有就建。进程退出时由 Nitro 的 close 钩子统一 end()。 */
export function getPool(): Pool {
  const globalStore = globalThis as GlobalWithPool;
  const existing = globalStore[POOL_KEY];
  if (existing && !closing) return existing;
  return createPool();
}

/** 断开连接池。测试与优雅退出用；下次 getPool() 会重新建。 */
export async function closePool(): Promise<void> {
  const globalStore = globalThis as GlobalWithPool;
  const pool = globalStore[POOL_KEY];
  if (!pool) return;
  closing = true;
  globalStore[POOL_KEY] = undefined;
  await pool.end().catch(() => undefined);
}
