/**
 * 通知公告的读写与可见性判定。
 *
 * 三块职责：
 *   1. normalizeNoticeInput —— 新增/编辑的表单校验（枚举白名单、长度、定时时间）。
 *   2. listNotices / CRUD —— 管理端列表与增删改，全部按权限节点走。
 *   3. visibleNoticesFor —— 铃铛抽屉用：只返回「已发布 + 在通知范围内」的公告。
 *
 * 「定时发布」不依赖常驻调度：publishTime 是秒级时间戳，0 表示立即发布。
 * 查询时用 `publish_time = 0 OR publish_time <= now` 过滤，到点自然可见；
 * 列表接口不套这层过滤，管理员能提前看到定时中的内容。
 *
 * 「通知范围」在服务端按当前账号推导，前端传的 departmentId/roleId 一律不认：
 *   · all        —— 所有人
 *   · department —— 目标部门 id 命中账号所属部门或其祖先部门（含子部门树）
 *   · role       —— 目标角色 id 命中账号拥有的角色
 * 纯函数（isNoticeVisibleTo）单独抽出，便于不连库单测。
 */
import type { RowDataPacket } from 'mysql2/promise';
import { getPool } from '../database/pool';
import { ApiError } from './http';
import { collectDepartmentIds, type DepartmentScopeNode } from './auth/department-scope';
import type { AdminContext } from './auth/rbac';
import { sanitizeRichHtml } from './rich-html';
import { RICH_HTML_MAX_LENGTH } from '../../shared/constants/rich-html';

// --- 枚举（与前端、i18n 保持同一套值） ---------------------------------------

export const NOTICE_CATEGORIES = ['notice', 'bulletin', 'activity'] as const;
export const NOTICE_METHODS = ['internal', 'email', 'sms'] as const;
export const NOTICE_SCOPES = ['all', 'department', 'role'] as const;

export type NoticeCategory = (typeof NOTICE_CATEGORIES)[number];
export type NoticeMethod = (typeof NOTICE_METHODS)[number];
export type NoticeScope = (typeof NOTICE_SCOPES)[number];

export interface NoticeInput {
  title: string;
  category: NoticeCategory;
  content: string;
  publishTime: number;
  isTop: number;
  notifyMethod: NoticeMethod;
  notifyScope: NoticeScope;
  scopeIds: number[];
  status: number;
}

export interface NoticeItem {
  id: number;
  title: string;
  category: NoticeCategory;
  content: string;
  publishTime: number;
  isTop: number;
  notifyMethod: NoticeMethod;
  notifyScope: NoticeScope;
  scopeIds: number[];
  status: number;
  creatorId: number;
  creatorName: string;
  createTime: number;
  updateTime: number;
  /** 派生：是否已到发布时间 */
  published: boolean;
}

interface NoticeDbRow extends RowDataPacket {
  id: number;
  title: string;
  category: string;
  content: string | null;
  publish_time: number;
  is_top: number;
  notify_method: string;
  notify_scope: string;
  scope_ids: string;
  status: number;
  creator_id: number;
  creator_name: string;
  create_time: number;
  update_time: number;
}

const SELECT_COLUMNS =
  '`id`,`title`,`category`,`content`,`publish_time`,`is_top`,`notify_method`,`notify_scope`,`scope_ids`,`status`,`creator_id`,`creator_name`,`create_time`,`update_time`';

// --- 纯函数：校验 / 派生 / 可见性 ---------------------------------------------

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function toTimestamp(value: unknown): number {
  const raw = typeof value === 'string' || typeof value === 'number' ? value : 0;
  const n = Number(raw);
  // 前端日期控件可能给毫秒，统一收敛成秒。
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 1e11 ? Math.floor(n / 1000) : Math.floor(n);
}

/** `'1,2,3'` / `[1,2,3]` → 去重后的正整数数组。 */
export function parseScopeIds(raw: unknown): number[] {
  const parts = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
  return [
    ...new Set(
      parts
        .map((item) => Number(String(item).trim()))
        .filter((id) => Number.isInteger(id) && id > 0),
    ),
  ];
}

/**
 * 公告正文净化：转发到白名单实现（`server/utils/rich-html.ts`）。
 *
 * 这里曾经是四条黑名单正则（`<script>` / `on*=` / `javascript:`），
 * 已被证明可绕过（`<svg/onload=>`、`javas&#99;ript:`）。保留这个导出名有两个原因：
 * ① 调用点与单测不必跟着改名；② 「公告正文要净化」这件事在 service 里仍然一眼可见。
 */
export function sanitizeNoticeHtml(raw: string): string {
  return sanitizeRichHtml(raw);
}

/** HTML 正文转纯文本摘要：通知抽屉只展示文字，不把标签原样吐给用户。 */
export function noticeHtmlToText(raw: string): string {
  return sanitizeNoticeHtml(raw)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 表单校验：不合法值回落到默认，而不是直接抛——和项目里其它 normalize 一致。 */
export function normalizeNoticeInput(raw: unknown): NoticeInput {
  const body = (raw ?? {}) as Record<string, unknown>;
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) throw new ApiError('公告标题不能为空');
  if (title.length > 200) throw new ApiError('公告标题不能超过 200 字');

  // 长度先卡住再净化：净化器要解析整段 HTML，无上限时一个几 MB 的畸形正文
  // 能把单线程算到超时（ReDoS 的现实版本）。这个上限远高于正常公告。
  const rawContent = typeof body.content === 'string' ? body.content : '';
  if (rawContent.length > RICH_HTML_MAX_LENGTH) {
    throw new ApiError(`公告内容过长（上限 ${RICH_HTML_MAX_LENGTH / 10_000} 万字）`);
  }
  const content = sanitizeNoticeHtml(rawContent);
  if (!content) throw new ApiError('公告内容不能为空');

  const notifyScope = oneOf(body.notifyScope, NOTICE_SCOPES, 'all');
  const scopeIds = notifyScope === 'all' ? [] : parseScopeIds(body.scopeIds);
  if (notifyScope !== 'all' && scopeIds.length === 0) {
    throw new ApiError(notifyScope === 'department' ? '请选择通知部门' : '请选择通知角色');
  }

  return {
    title,
    category: oneOf(body.category, NOTICE_CATEGORIES, 'notice'),
    content,
    publishTime: toTimestamp(body.publishTime),
    isTop: body.isTop === 1 || body.isTop === true || body.isTop === '1' ? 1 : 0,
    notifyMethod: oneOf(body.notifyMethod, NOTICE_METHODS, 'internal'),
    notifyScope,
    scopeIds,
    status: body.status === 0 || body.status === false || body.status === '0' ? 0 : 1,
  };
}

/** 是否已发布：publishTime 为 0 或已到点。 */
export function isNoticePublished(publishTime: number, now: number): boolean {
  return !publishTime || publishTime <= now;
}

export interface NoticeVisibilityIdentity {
  isSuper: boolean;
  departmentId: number;
  roleIds: number[];
}

/**
 * 公告对某个账号是否可见（不含「是否已发布」，那是另一个维度）。
 * departments 用来把指定部门展开成子树：选中父部门时，子部门的人也要收到。
 */
export function isNoticeVisibleTo(
  notice: Pick<NoticeItem, 'notifyScope' | 'scopeIds'>,
  identity: NoticeVisibilityIdentity,
  departments: ReadonlyArray<DepartmentScopeNode>,
): boolean {
  if (identity.isSuper) return true;
  const targets = new Set(notice.scopeIds.map(Number));
  switch (notice.notifyScope) {
    case 'all':
      return true;
    case 'department': {
      // 每个目标部门展开成「自己 + 子部门」，命中任一即可。
      for (const target of targets) {
        if (collectDepartmentIds(departments, target).includes(Number(identity.departmentId))) {
          return true;
        }
      }
      return false;
    }
    case 'role':
      return identity.roleIds.some((id) => targets.has(Number(id)));
    default:
      return false;
  }
}

/** 从登录上下文取可见性身份（角色 id 来自已启用的角色）。 */
export function noticeIdentityFromContext(context: AdminContext): NoticeVisibilityIdentity {
  return {
    isSuper: context.isSuper,
    departmentId: Number(context.admin.department_id ?? 0),
    roleIds: context.roles.map((role) => Number(role.id)),
  };
}

// --- 行转换 ------------------------------------------------------------------

function toItem(row: NoticeDbRow, now: number): NoticeItem {
  return {
    id: Number(row.id),
    title: row.title,
    category: oneOf(row.category, NOTICE_CATEGORIES, 'notice'),
    content: row.content ?? '',
    publishTime: Number(row.publish_time),
    isTop: Number(row.is_top) ? 1 : 0,
    notifyMethod: oneOf(row.notify_method, NOTICE_METHODS, 'internal'),
    notifyScope: oneOf(row.notify_scope, NOTICE_SCOPES, 'all'),
    scopeIds: parseScopeIds(row.scope_ids),
    status: Number(row.status),
    creatorId: Number(row.creator_id),
    creatorName: row.creator_name ?? '',
    createTime: Number(row.create_time),
    updateTime: Number(row.update_time),
    published: isNoticePublished(Number(row.publish_time), now),
  };
}

async function allDepartmentNodes(): Promise<DepartmentScopeNode[]> {
  const pool = getPool();
  const [rows] = await pool.query<Array<{ id: number; pid: number } & RowDataPacket>>(
    'SELECT `id`,`pid` FROM `department`',
  );
  return rows.map((row) => ({ id: Number(row.id), pid: Number(row.pid) }));
}

// --- 管理端 CRUD --------------------------------------------------------------

export interface NoticeListQuery {
  keyword: string;
  category: string;
  status: number | null;
  published: boolean | null;
}

/** 列表查询条件归一化（供接口直接调用，逻辑集中在 service 便于单测）。 */
export function normalizeNoticeListQuery(raw: unknown): NoticeListQuery {
  const query = (raw ?? {}) as Record<string, unknown>;
  const keyword = typeof query.keyword === 'string' ? query.keyword.trim().slice(0, 100) : '';
  const category =
    typeof query.category === 'string' && (NOTICE_CATEGORIES as readonly string[]).includes(query.category)
      ? query.category
      : '';
  const statusRaw = query.status;
  const status = statusRaw === 0 || statusRaw === '0' || statusRaw === false || statusRaw === 'false'
    ? 0
    : statusRaw === 1 || statusRaw === '1' || statusRaw === true || statusRaw === 'true'
      ? 1
      : null;
  // URL query 传来的是字符串：'true'/'false'/'1'/'0' 都要认，不能只认布尔。
  const publishedRaw = query.published;
  const published = publishedRaw === true || publishedRaw === '1' || publishedRaw === 'true'
    ? true
    : publishedRaw === false || publishedRaw === '0' || publishedRaw === 'false'
      ? false
      : null;
  return { keyword, category, status, published };
}

/** 管理端列表：不过滤发布时间（管理员要能看到定时中的内容），支持关键字/分类/状态/发布态筛选。 */
export async function listNotices(query: NoticeListQuery): Promise<NoticeItem[]> {
  const where: string[] = ['1 = 1'];
  const params: unknown[] = [];
  if (query.keyword) {
    where.push('(`title` LIKE ? OR `content` LIKE ?)');
    const like = `%${query.keyword}%`;
    params.push(like, like);
  }
  if (query.category) {
    where.push('`category` = ?');
    params.push(query.category);
  }
  if (query.status !== null) {
    where.push('`status` = ?');
    params.push(query.status);
  }
  const now = Math.floor(Date.now() / 1000);
  if (query.published === true) where.push('(`publish_time` = 0 OR `publish_time` <= ?)');
  if (query.published === false) where.push('`publish_time` > 0 AND `publish_time` > ?');
  if (query.published !== null) params.push(now);

  const pool = getPool();
  const [rows] = await pool.query<NoticeDbRow[]>(
    `SELECT ${SELECT_COLUMNS} FROM \`announcement\` WHERE ${where.join(' AND ')} ORDER BY \`is_top\` DESC, \`publish_time\` DESC, \`id\` DESC`,
    params,
  );
  return rows.map((row) => toItem(row, now));
}

export async function getNoticeRow(id: number): Promise<NoticeDbRow | undefined> {
  const pool = getPool();
  const [rows] = await pool.query<NoticeDbRow[]>(
    `SELECT ${SELECT_COLUMNS} FROM \`announcement\` WHERE \`id\` = ? LIMIT 1`,
    [id],
  );
  return rows[0];
}

/** 管理端按 id 取单条：不做可见性过滤（管理员可编辑定时中/已下线的公告），供编辑页回填。 */
export async function getNoticeForAdmin(id: number): Promise<NoticeItem | null> {
  const row = await getNoticeRow(id);
  return row ? toItem(row, Math.floor(Date.now() / 1000)) : null;
}

export async function addNotice(input: NoticeInput, context: AdminContext): Promise<{ id: number }> {
  const pool = getPool();
  const ts = Math.floor(Date.now() / 1000);
  const [result] = await pool.query(
    `INSERT INTO \`announcement\`
       (\`title\`,\`category\`,\`content\`,\`publish_time\`,\`is_top\`,\`notify_method\`,\`notify_scope\`,\`scope_ids\`,\`status\`,\`creator_id\`,\`creator_name\`,\`create_time\`,\`update_time\`)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      input.title, input.category, input.content, input.publishTime, input.isTop,
      input.notifyMethod, input.notifyScope, input.scopeIds.join(','), input.status,
      Number(context.admin.id), context.admin.nickname || context.admin.username, ts, ts,
    ],
  );
  const insertId = Number((result as { insertId?: number }).insertId ?? 0);
  if (!insertId) throw new ApiError('创建公告失败');
  return { id: insertId };
}

export async function updateNotice(id: number, input: NoticeInput): Promise<void> {
  const existing = await getNoticeRow(id);
  if (!existing) throw new ApiError('公告不存在');
  const pool = getPool();
  await pool.query(
    `UPDATE \`announcement\` SET \`title\`=?,\`category\`=?,\`content\`=?,\`publish_time\`=?,\`is_top\`=?,\`notify_method\`=?,\`notify_scope\`=?,\`scope_ids\`=?,\`status\`=?,\`update_time\`=? WHERE \`id\`=?`,
    [
      input.title, input.category, input.content, input.publishTime, input.isTop,
      input.notifyMethod, input.notifyScope, input.scopeIds.join(','), input.status,
      Math.floor(Date.now() / 1000), id,
    ],
  );
}

export async function deleteNotice(id: number): Promise<void> {
  const existing = await getNoticeRow(id);
  if (!existing) throw new ApiError('公告不存在');
  const pool = getPool();
  await pool.query('DELETE FROM `announcement` WHERE `id` = ?', [id]);
}

// --- 铃铛可见公告 -------------------------------------------------------------

/**
 * 当前账号可见的「已发布」公告。
 * 超管也走范围判定（isSuper 在 isNoticeVisibleTo 里直接放行），但同样要求已发布。
 * 只启用状态（status=1）的公告才进铃铛。
 */
export async function visibleNoticesFor(context: AdminContext): Promise<NoticeItem[]> {
  const now = Math.floor(Date.now() / 1000);
  const pool = getPool();
  const [rows] = await pool.query<NoticeDbRow[]>(
    `SELECT ${SELECT_COLUMNS} FROM \`announcement\`
      WHERE \`status\` = 1 AND (\`publish_time\` = 0 OR \`publish_time\` <= ?)
      ORDER BY \`is_top\` DESC, \`publish_time\` DESC, \`id\` DESC
      LIMIT 50`,
    [now],
  );
  const identity = noticeIdentityFromContext(context);
  const departments = await allDepartmentNodes();
  return rows
    .filter((row) => isNoticeVisibleTo(toItem(row, now), identity, departments))
    .map((row) => toItem(row, now));
}

/**
 * 铃铛点进详情用：按 id 取一条「已发布 + 启用 + 在通知范围内」的公告。
 * 与 visibleNoticesFor 共用同一套可见性口径，越权/定时中/已停发的公告一律返回 undefined，
 * 由接口层转成「公告不存在」——不把「存在但没权限」这件事泄漏出去。
 */
export async function visibleNoticeById(
  context: AdminContext,
  id: number,
): Promise<NoticeItem | undefined> {
  const row = await getNoticeRow(id);
  if (!row || Number(row.status) !== 1) return undefined;
  const now = Math.floor(Date.now() / 1000);
  if (!isNoticePublished(Number(row.publish_time), now)) return undefined;
  const identity = noticeIdentityFromContext(context);
  const departments = await allDepartmentNodes();
  const item = toItem(row, now);
  return isNoticeVisibleTo(item, identity, departments) ? item : undefined;
}
