/**
 * 语言管理：语言定义、词条、译文的读写。
 *
 * 与部门/角色一样，这里只管「内容」，不参与权限判定：
 *   · `language`        语言（code 必须和 nuxt.config.ts 的 i18n.locales.code 对齐）
 *   · `language_entry`  词条（点分 key + 模块）
 *   · `language_value`  某个词条在某个语言下的译文（按行存，新增语言不用改表）
 *
 * 前端 `@nuxtjs/i18n` 的静态 JSON 仍是**兜底**：`/api/i18n/messages` 只返回数据库里
 * 有值的译文，客户端用 mergeLocaleMessage 深度合并，所以库里删掉某个 key 后
 * 页面会自动回退到内置文案，不会变成一片 `auth.user.title`。
 */
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { getPool } from '../../database/pool';
import { ApiError } from '../http';

/** 与 nuxt.config.ts 的 i18n.defaultLocale 保持一致。 */
export const DEFAULT_LANGUAGE_CODE = 'zh';

/**
 * 词条类型：
 *   system —— 从项目内置 zh/en.json 导入，是页面文案的兜底，可改译文但不可删；
 *   custom —— 后台手工新增，可以随便改和删。
 */
export const ENTRY_TYPE = { SYSTEM: 'system', CUSTOM: 'custom' } as const;
export type EntryType = (typeof ENTRY_TYPE)[keyof typeof ENTRY_TYPE];

const KEY_PATTERN = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/;
const CODE_PATTERN = /^[a-z][a-z0-9_-]{0,19}$/;

export interface LanguageItem {
  id: number;
  code: string;
  name: string;
  nativeName: string;
  weigh: number;
  status: number;
  /** 已填译文数 / 词条总数，用来显示翻译完成度 */
  translated: number;
  isDefault: boolean;
}

export interface LanguageOverview {
  languages: LanguageItem[];
  modules: string[];
  total: number;
  /** 按类型分组的词条数：类型筛选下拉直接显示，不用再查一次 */
  entryCounts: Record<EntryType, number>;
}

export interface LanguageEntryItem {
  id: number;
  key: string;
  module: string;
  /** 系统词条来自内置语言文件，不允许删除 */
  type: EntryType;
  remark: string;
  /** lang code → 译文（没填的语言是空串） */
  values: Record<string, string>;
}

export interface EntryQuery {
  page: number;
  limit: number;
  keyword: string;
  module: string;
  /** '' = 全部类型 */
  type: '' | EntryType;
}

interface LanguageRow extends RowDataPacket {
  id: number;
  code: string;
  name: string;
  native_name: string;
  weigh: number;
  status: number;
}

interface CountRow extends RowDataPacket {
  total: number;
}

interface ValueCountRow extends RowDataPacket {
  lang_code: string;
  total: number;
}

interface ModuleRow extends RowDataPacket {
  module: string;
}

interface EntryRow extends RowDataPacket {
  id: number;
  key: string;
  module: string;
  type: EntryType;
  remark: string;
}

interface EntryTypeRow extends RowDataPacket {
  id: number;
  key: string;
  type: EntryType;
}

interface ValueRow extends RowDataPacket {
  entry_id: number;
  lang_code: string;
  value: string | null;
}

interface MessageRow extends RowDataPacket {
  key: string;
  lang_code: string;
  value: string;
}

function ts(): number {
  return Math.floor(Date.now() / 1000);
}

/** 点分 key 的合法字符集：只允许字母数字下划线中划线，段之间用点分隔。 */
export function normalizeEntryKey(raw: unknown): string {
  const key = typeof raw === 'string' ? raw.trim() : '';
  if (!key) throw new ApiError('词条键不能为空');
  if (key.length > 190) throw new ApiError('词条键过长');
  if (!KEY_PATTERN.test(key)) throw new ApiError('词条键只能包含字母、数字、_、- 和点');
  return key;
}

export function normalizeLanguageCode(raw: unknown): string {
  const code = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!CODE_PATTERN.test(code)) {
    throw new ApiError('语言代码只能是小写字母开头，含字母、数字、_ 或 -');
  }
  return code;
}

export function normalizeEntryQuery(raw: unknown): EntryQuery {
  const value = (raw ?? {}) as Record<string, unknown>;
  const type = typeof value.type === 'string' ? value.type.trim() : '';
  return {
    page: Math.max(1, Number(value.page ?? 1) || 1),
    limit: Math.min(100, Math.max(1, Number(value.limit ?? 10) || 10)),
    keyword: typeof value.keyword === 'string' ? value.keyword.trim().slice(0, 100) : '',
    module: typeof value.module === 'string' ? value.module.trim().slice(0, 50) : '',
    type: type === ENTRY_TYPE.SYSTEM || type === ENTRY_TYPE.CUSTOM ? type : '',
  };
}

/** 把 `a.b.c` 写成 `{ a: { b: { c: value } } }`，供前端 mergeLocaleMessage 使用。 */
export function setNested(
  target: Record<string, unknown>,
  key: string,
  value: string,
): Record<string, unknown> {
  const parts = key.split('.');
  let cursor = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i]!;
    const next = cursor[part];
    if (!next || typeof next !== 'object' || Array.isArray(next)) cursor[part] = {};
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]!] = value;
  return target;
}

export async function listLanguages(): Promise<LanguageOverview> {
  const pool = getPool();
  const [[langRows], [entryCount], [valueCounts], [moduleRows], [typeRows]] = await Promise.all([
    pool.query<LanguageRow[]>(
      'SELECT `id`,`code`,`name`,`native_name`,`weigh`,`status` FROM `language` ORDER BY `weigh` DESC, `id` ASC',
    ),
    pool.query<CountRow[]>('SELECT COUNT(*) AS total FROM `language_entry`'),
    pool.query<ValueCountRow[]>(
      "SELECT `lang_code`, COUNT(*) AS total FROM `language_value` WHERE `value` IS NOT NULL AND `value` <> '' GROUP BY `lang_code`",
    ),
    pool.query<ModuleRow[]>('SELECT DISTINCT `module` FROM `language_entry` ORDER BY `module` ASC'),
    pool.query<Array<{ type: EntryType; total: number } & RowDataPacket>>(
      'SELECT `type`, COUNT(*) AS total FROM `language_entry` GROUP BY `type`',
    ),
  ]);
  const counts = new Map(valueCounts.map((row) => [row.lang_code, Number(row.total)]));
  const entryCounts: Record<EntryType, number> = { system: 0, custom: 0 };
  for (const row of typeRows) {
    if (row.type === ENTRY_TYPE.SYSTEM) entryCounts.system = Number(row.total);
    else entryCounts.custom += Number(row.total);
  }
  return {
    languages: langRows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      nativeName: row.native_name,
      weigh: Number(row.weigh ?? 0),
      status: row.status,
      translated: counts.get(row.code) ?? 0,
      isDefault: row.code === DEFAULT_LANGUAGE_CODE,
    })),
    modules: moduleRows.map((row) => row.module).filter(Boolean),
    total: Number(entryCount[0]?.total ?? 0),
    entryCounts,
  };
}

export async function listEntries(
  query: EntryQuery,
): Promise<{ list: LanguageEntryItem[]; total: number; page: number; limit: number }> {
  const pool = getPool();
  const where: string[] = [];
  const params: unknown[] = [];
  if (query.keyword) {
    const like = `%${query.keyword}%`;
    // 同时搜 key 与任意语言的译文，用子查询避免 JOIN 后 COUNT 被放大。
    where.push(
      '(e.`key` LIKE ? OR e.`id` IN (SELECT `entry_id` FROM `language_value` WHERE `value` LIKE ?))',
    );
    params.push(like, like);
  }
  if (query.module) {
    where.push('e.`module` = ?');
    params.push(query.module);
  }
  if (query.type) {
    where.push('e.`type` = ?');
    params.push(query.type);
  }
  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const [[countRows], [rows]] = await Promise.all([
    pool.query<CountRow[]>(`SELECT COUNT(*) AS total FROM \`language_entry\` e ${clause}`, params),
    pool.query<EntryRow[]>(
      `SELECT e.\`id\`, e.\`key\`, e.\`module\`, e.\`type\`, e.\`remark\` FROM \`language_entry\` e ${clause}
        ORDER BY e.\`key\` ASC LIMIT ? OFFSET ?`,
      [...params, query.limit, (query.page - 1) * query.limit],
    ),
  ]);

  const ids = rows.map((row) => row.id);
  let values: ValueRow[] = [];
  if (ids.length > 0) {
    const [valueRows] = await pool.query<ValueRow[]>(
      'SELECT `entry_id`,`lang_code`,`value` FROM `language_value` WHERE `entry_id` IN (?)',
      [ids],
    );
    values = valueRows;
  }
  const byEntry = new Map<number, Record<string, string>>();
  for (const value of values) {
    const map = byEntry.get(value.entry_id) ?? {};
    map[value.lang_code] = value.value ?? '';
    byEntry.set(value.entry_id, map);
  }

  return {
    list: rows.map((row) => ({
      id: row.id,
      key: row.key,
      module: row.module,
      type: row.type === ENTRY_TYPE.SYSTEM ? ENTRY_TYPE.SYSTEM : ENTRY_TYPE.CUSTOM,
      remark: row.remark,
      values: byEntry.get(row.id) ?? {},
    })),
    total: Number(countRows[0]?.total ?? 0),
    page: query.page,
    limit: query.limit,
  };
}

export interface LanguageInput {
  id: number;
  code: string;
  name: string;
  nativeName: string;
  weigh: number;
  status: number;
}

export function normalizeLanguageInput(raw: unknown): LanguageInput {
  const body = (raw ?? {}) as Record<string, unknown>;
  const id = Math.max(0, Number(body.id ?? 0) || 0);
  const code = normalizeLanguageCode(body.code);
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 50) : '';
  if (!name) throw new ApiError('语言名称不能为空');
  const nativeName =
    typeof body.nativeName === 'string' ? body.nativeName.trim().slice(0, 50) : name;
  const weigh = Math.trunc(Number(body.weigh ?? 0) || 0);
  const status = body.status === 0 || body.status === '0' || body.status === false ? 0 : 1;
  return { id, code, name, nativeName, weigh, status };
}

/** 新增或编辑语言。编辑时 code 不可改（译文表的 lang_code 引用它）。 */
export async function saveLanguage(input: LanguageInput): Promise<{ id: number }> {
  const pool = getPool();
  const now = ts();
  if (input.id > 0) {
    const [rows] = await pool.query<LanguageRow[]>(
      'SELECT `id`,`code` FROM `language` WHERE `id` = ? LIMIT 1',
      [input.id],
    );
    const existing = rows[0];
    if (!existing) throw new ApiError('语言不存在');
    if (existing.code === DEFAULT_LANGUAGE_CODE && input.status === 0) {
      throw new ApiError('默认语言不能停用');
    }
    await pool.query(
      'UPDATE `language` SET `name`=?,`native_name`=?,`weigh`=?,`status`=?,`update_time`=? WHERE `id`=?',
      [input.name, input.nativeName, input.weigh, input.status, now, input.id],
    );
    return { id: input.id };
  }

  try {
    const [result] = await pool.query<ResultSetHeader>(
      'INSERT INTO `language` (`code`,`name`,`native_name`,`weigh`,`status`,`create_time`,`update_time`) VALUES (?,?,?,?,?,?,?)',
      [input.code, input.name, input.nativeName, input.weigh, input.status, now, now],
    );
    return { id: result.insertId };
  } catch (error) {
    if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
      throw new ApiError('语言代码已存在');
    }
    throw error;
  }
}

export async function deleteLanguage(id: number): Promise<void> {
  if (!Number.isInteger(id) || id <= 0) throw new ApiError('缺少语言 id');
  const pool = getPool();
  const [rows] = await pool.query<LanguageRow[]>(
    'SELECT `id`,`code` FROM `language` WHERE `id` = ? LIMIT 1',
    [id],
  );
  const existing = rows[0];
  if (!existing) throw new ApiError('语言不存在');
  if (existing.code === DEFAULT_LANGUAGE_CODE) throw new ApiError('默认语言不能删除');

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query('DELETE FROM `language_value` WHERE `lang_code` = ?', [existing.code]);
    await connection.query('DELETE FROM `language` WHERE `id` = ?', [id]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export interface EntryInput {
  id: number;
  key: string;
  remark: string;
  /** 只接受已注册语言的 code，避免往库里塞垃圾列 */
  values: Record<string, string>;
}

export function normalizeEntryInput(
  raw: unknown,
  languageCodes: readonly string[],
): EntryInput {
  const body = (raw ?? {}) as Record<string, unknown>;
  const id = Math.max(0, Number(body.id ?? 0) || 0);
  const key = normalizeEntryKey(body.key);
  const remark = typeof body.remark === 'string' ? body.remark.trim().slice(0, 255) : '';
  const rawValues =
    body.values && typeof body.values === 'object' && !Array.isArray(body.values)
      ? (body.values as Record<string, unknown>)
      : {};
  const codes = new Set(languageCodes);
  const values: Record<string, string> = {};
  for (const [code, value] of Object.entries(rawValues)) {
    if (!codes.has(code)) continue;
    const text = typeof value === 'string' ? value : '';
    if (text.length > 4000) throw new ApiError(`${code} 的译文过长`);
    values[code] = text;
  }
  return { id, key, remark, values };
}

/** 新增或编辑词条；编辑时 key 不可改，只更新备注与译文。 */
export async function saveEntry(input: EntryInput): Promise<{ id: number }> {
  const pool = getPool();
  const now = ts();
  let entryId = input.id;

  if (entryId > 0) {
    const [rows] = await pool.query<EntryRow[]>(
      'SELECT `id`,`key` FROM `language_entry` WHERE `id` = ? LIMIT 1',
      [entryId],
    );
    if (!rows[0]) throw new ApiError('词条不存在');
    await pool.query('UPDATE `language_entry` SET `remark`=?,`update_time`=? WHERE `id`=?', [
      input.remark,
      now,
      entryId,
    ]);
  } else {
    const module = input.key.split('.')[0] ?? '';
    try {
      // 后台新建的词条一律是 custom：系统词条只能由内置语言文件导入。
      const [result] = await pool.query<ResultSetHeader>(
        'INSERT INTO `language_entry` (`key`,`module`,`type`,`remark`,`create_time`,`update_time`) VALUES (?,?,?,?,?,?)',
        [input.key, module, ENTRY_TYPE.CUSTOM, input.remark, now, now],
      );
      entryId = result.insertId;
    } catch (error) {
      if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
        throw new ApiError('词条键已存在');
      }
      throw error;
    }
  }

  for (const [code, value] of Object.entries(input.values)) {
    await pool.query(
      'INSERT INTO `language_value` (`entry_id`,`lang_code`,`value`,`update_time`) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE `value`=VALUES(`value`), `update_time`=VALUES(`update_time`)',
      [entryId, code, value, now],
    );
  }
  return { id: entryId };
}

export async function deleteEntry(id: number): Promise<void> {
  if (!Number.isInteger(id) || id <= 0) throw new ApiError('缺少词条 id');
  const pool = getPool();
  const [rows] = await pool.query<EntryTypeRow[]>(
    'SELECT `id`,`key`,`type` FROM `language_entry` WHERE `id` = ? LIMIT 1',
    [id],
  );
  const existing = rows[0];
  if (!existing) throw new ApiError('词条不存在');
  // 系统词条是页面文案的兜底：删了以后界面会自动回退到内置文案，
  // 列表里却少了一条记录 —— 这种「删了还在用」的状态不该被允许。
  if (existing.type === ENTRY_TYPE.SYSTEM) {
    throw new ApiError('系统内置词条不能删除，只能修改译文');
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query('DELETE FROM `language_value` WHERE `entry_id` = ?', [id]);
    await connection.query('DELETE FROM `language_entry` WHERE `id` = ?', [id]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/** 免登录接口用：只返回启用语言里非空译文，嵌套成 vue-i18n 能直接合并的对象。 */
export async function getRuntimeMessages(): Promise<Record<string, Record<string, unknown>>> {
  const pool = getPool();
  const [langRows] = await pool.query<Array<{ code: string } & RowDataPacket>>(
    'SELECT `code` FROM `language` WHERE `status` = 1',
  );
  const codes = langRows.map((row) => row.code);
  if (codes.length === 0) return {};

  const [rows] = await pool.query<MessageRow[]>(
    `SELECT e.\`key\`, v.\`lang_code\`, v.\`value\`
       FROM \`language_value\` v
       INNER JOIN \`language_entry\` e ON e.\`id\` = v.\`entry_id\`
      WHERE v.\`lang_code\` IN (?) AND v.\`value\` IS NOT NULL AND v.\`value\` <> ''`,
    [codes],
  );

  const messages: Record<string, Record<string, unknown>> = {};
  for (const code of codes) messages[code] = {};
  for (const row of rows) {
    const target = messages[row.lang_code];
    if (target) setNested(target, row.key, row.value);
  }
  return messages;
}

/** 右上角语言切换器用的最小语言信息：不含译文完成度等后台统计字段。 */
export interface RuntimeLocaleItem {
  code: string;
  name: string;
  nativeName: string;
  weigh: number;
  isDefault: boolean;
}

/**
 * 免登录接口用：只返回**启用**的语言。
 *
 * 语言管理里把某个语言停用后，这个接口立刻不再返回它，右上角切换器随之消失 ——
 * 「后台停用」和「前台可选」是同一份数据，不存在两处各配一遍的可能。
 */
export async function listEnabledLanguages(): Promise<{
  defaultLocale: string;
  locales: RuntimeLocaleItem[];
}> {
  const pool = getPool();
  const [rows] = await pool.query<LanguageRow[]>(
    'SELECT `id`,`code`,`name`,`native_name`,`weigh`,`status` FROM `language` WHERE `status` = 1 ORDER BY `weigh` DESC, `id` ASC',
  );
  return {
    defaultLocale: DEFAULT_LANGUAGE_CODE,
    locales: rows.map((row) => ({
      code: row.code,
      name: row.name,
      nativeName: row.native_name,
      weigh: Number(row.weigh ?? 0),
      isDefault: row.code === DEFAULT_LANGUAGE_CODE,
    })),
  };
}

/** 写词条时用来校验语言 code 白名单，比 listLanguages() 少三次统计查询。 */
export async function listLanguageCodes(): Promise<string[]> {
  const pool = getPool();
  const [rows] = await pool.query<Array<{ code: string } & RowDataPacket>>(
    'SELECT `code` FROM `language` ORDER BY `id` ASC',
  );
  return rows.map((row) => row.code);
}
