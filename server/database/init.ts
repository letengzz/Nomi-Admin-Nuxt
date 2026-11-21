/**
 * 数据库自动初始化：**库没有就建库，表改名、表没有就建表，表空了就灌种子**。
 *
 * 触发时机有两处，缺一不可：
 *   ① Nitro 启动插件（server/plugins/database.ts）—— 让「一开始」就建好，
 *      而不是等第一个请求进来才建；
 *   ② 每个管理端接口的入口（ensureDatabase 内 memoize）—— 插件失败（比如
 *      MySQL 比应用晚启动）后，请求进来还能再试一次，不用重启应用。
 *
 * 幂等性来自三点：DDL 全是 CREATE TABLE IF NOT EXISTS；种子只在空表写入；
 * 表改名只在「旧表在、新表不在」时发生。
 */
import mysql, { type Pool, type RowDataPacket } from 'mysql2/promise';
import { assertSafeDatabaseName, getDbConfig } from './config';
import { runMigrations, migrateLegacyTableNames } from './migrations';
import { getPool } from './pool';
import { SCHEMA_STATEMENTS } from './schema';
import { seedIfEmpty } from './seed';

const READY_KEY = Symbol.for('nomi.admin.mysql.ready');

interface GlobalWithReady {
  [READY_KEY]?: Promise<Pool>;
}

export interface InitReport {
  database: string;
  createdDatabase: boolean;
  createdTables: string[];
}

/** mysql2 的泛型要求行类型带 RowDataPacket，否则拿不到 `.length` 之类的结构信息。 */
interface SchemaNameRow extends RowDataPacket {
  SCHEMA_NAME: string;
}

interface TableNameRow extends RowDataPacket {
  TABLE_NAME: string;
}

/** 启动日志里的中文表名：控制台是给人看的，别让人对着 permission_rule 猜是什么意思。 */
const SEED_LABELS: Record<string, string> = {
  language: '语言',
  department: '部门',
  permission_rule: '菜单/权限节点',
  role: '角色',
  user: '账号',
  system_config: '系统配置',
};

let lastReport: InitReport | undefined;

/** 最近一次初始化的结果，健康检查接口用它报告「表建在哪」。 */
export function getInitReport(): InitReport | undefined {
  return lastReport;
}

/** 只建库（不建表）：库名是标识符，已做白名单校验，仍用反引号包住。 */
async function ensureDatabaseExists(): Promise<boolean> {
  const config = getDbConfig();
  const database = assertSafeDatabaseName(config.database);

  const connection = await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
  });

  try {
    const [rows] = await connection.query<SchemaNameRow[]>(
      'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?',
      [database],
    );
    if (rows.length > 0) return false;
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
    return true;
  } finally {
    await connection.end();
  }
}

/** 当前库里已存在的表名，用来把「这次新建了哪几张表」讲清楚。 */
async function listTables(pool: Pool, database: string): Promise<Set<string>> {
  const [rows] = await pool.query<TableNameRow[]>(
    'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?',
    [database],
  );
  return new Set(rows.map((row) => row.TABLE_NAME));
}

/** 过期 token 清理：保留 2 天，理由见 docs 1.9 —— 过期记录要能被读到才能返回 409。 */
async function cleanupExpiredTokens(pool: Pool): Promise<void> {
  const cutoff = Math.floor(Date.now() / 1000) - 2 * 24 * 3600;
  await pool.query('DELETE FROM `token` WHERE `expire_time` < ?', [cutoff]).catch(() => undefined);
}

async function bootstrap(): Promise<Pool> {
  const database = assertSafeDatabaseName(getDbConfig().database);
  const createdDatabase = await ensureDatabaseExists();
  const pool = getPool();

  // 表改名必须抢在 CREATE TABLE IF NOT EXISTS 之前：否则会先建出空的新表，
  // 再改名就撞名了。全新库没有旧表，这一步是空操作。
  await migrateLegacyTableNames(pool);

  const before = await listTables(pool, database);
  for (const statement of SCHEMA_STATEMENTS) {
    await pool.query(statement);
  }
  const after = await listTables(pool, database);
  const createdTables = [...after].filter((table) => !before.has(table)).sort();

  const seed = await seedIfEmpty(pool);
  // 种子只负责「空表填满」，字段与节点搬迁这类结构改动走一次性迁移。
  // 顺序不能反：全新库要先写入 id 写死的种子账号，迁移里的自增数据才不会抢占 id。
  const migrations = await runMigrations(pool);
  await cleanupExpiredTokens(pool);

  lastReport = { database, createdDatabase, createdTables };

  if (createdDatabase || createdTables.length > 0) {
    const parts = [
      createdDatabase ? `数据库 ${database}` : '',
      createdTables.length > 0 ? `表 ${createdTables.join(', ')}` : '',
    ].filter(Boolean);
    console.info(`[db] 已自动创建 ${parts.join(' / ')}`);
  }

  // 单独打一行：初始化到底写了什么，是排查「账号/菜单没生成」时第一个要看的信息。
  const seeded = Object.entries(seed.inserted);
  if (seeded.length > 0) {
    const detail = seeded.map(([table, rows]) => `${SEED_LABELS[table] ?? table} ${rows}`).join(' / ');
    console.info(`[db] 种子数据已写入：${detail}`);
  } else if (
    !createdDatabase &&
    createdTables.length === 0 &&
    migrations.applied.length === 0
  ) {
    console.info('[db] 库与表已存在且种子齐备，本次不做任何写入');
  }

  return pool;
}

/**
 * 拿到一个「结构与种子都已就绪」的池。
 *
 * 失败时会清掉缓存的 promise，让下一次调用重新尝试 —— 否则 MySQL 启动晚于
 * 应用时，这个进程就永远卡在第一次失败的 promise 上。
 */
export async function ensureDatabase(): Promise<Pool> {
  const globalStore = globalThis as GlobalWithReady;
  const cached = globalStore[READY_KEY];
  if (cached) return cached;

  const pending = bootstrap().catch((error: unknown) => {
    // 清掉缓存（而不是 delete 动态属性），让下一次调用重新尝试。
    globalStore[READY_KEY] = undefined;
    lastReport = undefined;
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[db] 数据库初始化失败：${message}\n` +
        '      请确认 MySQL 已启动，并检查 MYSQL_HOST / MYSQL_PORT / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE。',
    );
    throw error;
  });

  globalStore[READY_KEY] = pending;
  return pending;
}
