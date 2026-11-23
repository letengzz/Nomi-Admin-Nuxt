/**
 * 账号批量导入 / 导出。
 *
 * 一条铁律：**解析和写入都发生在服务端**。浏览器只负责把文件原样传上来、
 * 再把预览结果画出来 —— 前端算出来的「这行能不能导」永远只是提示，
 * 真正生效的是这里。
 *
 * 导入分成三步，分别对应三个纯函数边界：
 *   1. `parseUserImportFile`  —— 只读 Excel，不碰库：字节 → 原始单元格；
 *   2. `prepareUserImport`    —— 校验 + 解析冲突：原始单元格 → 带结论的行；
 *   3. `applyUserImport`      —— 一个事务写库，按策略处理冲突。
 *
 * 为什么冲突判定要在写入前一次性算完：策略是「遇到冲突怎么办」，
 * 而「有没有冲突」必须先在整张表里查一遍（含文件内互相重复），
 * 否则同一份文件里两行写同一个账号，第二行会在写库时才发现。
 *
 * 事务语义：整批导入共用一个事务。「停止导入」= 回滚全部，
 * 不会出现「导了一半」这种既不能重试也不好排查的中间状态。
 */
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import * as XLSX from 'xlsx';
import { getPool } from '../../database/pool';
import { ApiError } from '../http';
import { isDepartmentVisible, resolveDepartmentScope } from './department-scope';
import { canOperateRole, listRoleRows } from './role-service';
import { hashPassword, PASSWORD_MIN_LENGTH } from './password';
import { inspectUsersForImport, type Gender, type UserExportRow } from './user-service';
import { nowSeconds, TOKEN_TYPE_ADMIN, TOKEN_TYPE_ADMIN_REFRESH } from './token';
import type { AdminContext } from './rbac';
import { assertSpreadsheetReadable, clampCellText } from '../spreadsheet-guard';

/** 一次最多导入的行数：再多就该走「数据迁移」，而不是在浏览器里点一下。 */
export const MAX_IMPORT_ROWS = 500;
/** 文件大小上限，和 Nginx 默认的 1MB 相比留足余量，又不至于让解析占满内存。 */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
/** 列数上限：模板只有 9 列，留到 64 列给「自己加了备注列」的人。 */
export const MAX_IMPORT_COLUMNS = 64;
/**
 * 交给解析器的行数上限。
 *
 * 比 `MAX_IMPORT_ROWS` 多留一截，是为了**还能检测出「行数超了」**：
 * 解析器只读前这么多行，读满了我们才能判断「不止这些」，从而给出明确报错；
 * 如果正好卡在 500，超一行的文件会读成「刚好 500 行」而被静默截断。
 */
const PARSE_ROW_LIMIT = MAX_IMPORT_ROWS + 20;

const USERNAME_MIN = 3;
const USERNAME_MAX = 20;
const USERNAME_PATTERN = /^[A-Za-z0-9_-]+$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE_PATTERN = /^[0-9+\-() ]{5,20}$/;

// --- 列定义 ------------------------------------------------------------------

export const IMPORT_FIELDS = [
  'username',
  'password',
  'nickname',
  'email',
  'mobile',
  'gender',
  'department',
  'roles',
  'status',
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number];

/** 模板里的表头文案（带 * 表示必填，解析时会去掉）。 */
const COLUMN_TITLES: Record<ImportField, string> = {
  username: '账号*',
  password: '密码*',
  nickname: '昵称',
  email: '邮箱',
  mobile: '手机号',
  gender: '性别',
  department: '部门',
  roles: '角色*',
  status: '状态',
};

/**
 * 表头别名。人工填表时表头几乎不会和模板一字不差，
 * 这里认几种常见写法，认不出来才报「表头缺失」。
 */
const HEADER_ALIASES: Record<ImportField, readonly string[]> = {
  username: ['账号', '用户名', '登录账号', '登录名', 'username', 'account'],
  password: ['密码', '初始密码', '登录密码', 'password', 'pwd'],
  nickname: ['昵称', '姓名', '名称', 'nickname', 'name'],
  email: ['邮箱', '电子邮箱', '邮件', 'email', 'mail'],
  mobile: ['手机号', '手机', '手机号码', '电话', '联系电话', 'mobile', 'phone'],
  gender: ['性别', 'gender', 'sex'],
  department: ['部门', '所属部门', '部门名称', 'department', 'dept'],
  roles: ['角色', '用户角色', '角色名称', 'role', 'roles'],
  status: ['状态', 'status'],
};

/** `账号*` / `账号（必填）` / `Username ` 统一收成 `账号` / `username`。 */
function normalizeHeader(value: string): string {
  return value
    .replace(/[*＊]/g, '')
    .replace(/[（(][^)）]*[)）]/g, '')
    .replace(/[\s\u3000]/g, '')
    .toLowerCase();
}

const HEADER_LOOKUP = new Map<string, ImportField>();
for (const field of IMPORT_FIELDS) {
  for (const alias of HEADER_ALIASES[field]) HEADER_LOOKUP.set(normalizeHeader(alias), field);
}

// --- 类型 --------------------------------------------------------------------

export type UsernameStrategy = 'update' | 'skip' | 'abort';
export type ConflictStrategy = 'skip' | 'abort';

export interface UserImportStrategies {
  /** 账号已存在：修改数据 / 跳过该行 / 停止导入 */
  onUsername: UsernameStrategy;
  /** 邮箱已存在：跳过该行 / 停止导入 */
  onEmail: ConflictStrategy;
  /** 手机已存在：跳过该行 / 停止导入 */
  onMobile: ConflictStrategy;
  /** 状态列留空时使用的状态 */
  defaultStatus: 'enable' | 'disable';
}

export const DEFAULT_IMPORT_STRATEGIES: UserImportStrategies = {
  onUsername: 'skip',
  onEmail: 'skip',
  onMobile: 'skip',
  defaultStatus: 'enable',
};

/** 表单值 → 策略。认不出来的值退回默认，不让一个空字段把请求打挂。 */
export function normalizeImportStrategies(raw: unknown): UserImportStrategies {
  const value = (raw ?? {}) as Record<string, unknown>;
  const pick = <T extends string>(input: unknown, allowed: readonly T[], fallback: T): T =>
    typeof input === 'string' && (allowed as readonly string[]).includes(input) ? (input as T) : fallback;

  return {
    onUsername: pick(value.onUsername, ['update', 'skip', 'abort'] as const, 'skip'),
    onEmail: pick(value.onEmail, ['skip', 'abort'] as const, 'skip'),
    onMobile: pick(value.onMobile, ['skip', 'abort'] as const, 'skip'),
    defaultStatus: pick(value.defaultStatus, ['enable', 'disable'] as const, 'enable'),
  };
}

export interface ImportRawRow {
  /** 表格里的真实行号（表头是第 1 行，数据从第 2 行开始） */
  line: number;
  cells: Record<ImportField, string>;
}

export interface ImportPreviewRow {
  line: number;
  username: string;
  nickname: string;
  email: string;
  mobile: string;
  gender: string;
  departmentName: string;
  roleNames: string;
  status: string;
  /** 与库里已有账号的冲突标记（前端据此解释「为什么跳过/更新」） */
  conflicts: { username: boolean; email: boolean; mobile: boolean };
  /** 阻断性问题：这一行一定会失败，与策略无关 */
  errors: string[];
}

export interface ImportPreviewSummary {
  total: number;
  /** 没有任何问题、可以直接新增的行 */
  create: number;
  /** 账号已存在的行（按「用户已存在」策略处理） */
  username: number;
  /** 邮箱属于另一个账号的行 */
  email: number;
  /** 手机号属于另一个账号的行 */
  mobile: number;
  /** 有阻断性问题的行 */
  error: number;
}

export interface ImportPreview {
  total: number;
  summary: ImportPreviewSummary;
  rows: ImportPreviewRow[];
  /** 预览只回前 N 条，这里是被截掉的条数 */
  truncated: number;
}

export interface PreparedImportRow {
  line: number;
  username: string;
  password: string;
  nickname: string;
  email: string;
  mobile: string;
  gender: Gender;
  departmentId: number;
  departmentName: string;
  roleIds: number[];
  roleNames: string;
  status: 'enable' | 'disable';
  errors: string[];
  /** 同名账号的 id，0 = 没有 */
  existingId: number;
  existingEmailId: number;
  existingMobileId: number;
}

export interface ImportOutcome {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  aborted: boolean;
  abortedLine: number;
  abortedReason: string;
  failures: Array<{ line: number; reason: string }>;
}

/** 预览最多回这么多行：抽屉里只是让人扫一眼「大概长什么样」。 */
const PREVIEW_LIMIT = 100;

// --- ① 解析 ------------------------------------------------------------------

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return clampCellText(value.trim());
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return clampCellText(String(value).trim());
}

/**
 * 读第一张工作表 → 行数组。
 *
 * 顺序上先过「网络边界」再过「解析器」：容器认不出来（不是 ZIP / OLE2）或解压后
 * 大得离谱的文件，在这里就被挡掉，解析器只处理结构合理、规模有界的输入。
 * 解析器本身是第三方代码，我们没法保证它面对任意字节都体面 ——
 * 能做的是不让它见到那些字节。
 *
 * `raw: false` 让单元格走「显示值」：手机号存成数字时不会变成 1.38E+10，
 * 日期也不会变成一个序号。代价是格式化的开销，对几百行可以忽略。
 */
export function parseUserImportFile(buffer: Buffer): ImportRawRow[] {
  assertSpreadsheetReadable(buffer);

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, {
      type: 'buffer',
      // 只解析第一张表：工作簿里的其它表对导入没有意义，越少解析越少暴露面。
      sheets: 0,
      // 行数封顶：几十万行的表格不会整本读进内存。
      sheetRows: PARSE_ROW_LIMIT,
      // 下面这些都是「用不到就不解析」的开关：公式不求值、单元格 HTML 不生成、
      // 样式与 VBA 工程不装载。少解析一类结构，就少一类结构上的开销与隐患。
      cellFormula: false,
      cellHTML: false,
      cellStyles: false,
      bookVBA: false,
    });
  } catch {
    throw new ApiError('文件解析失败，请确认是有效的 Excel 文件');
  }

  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!sheet || !sheet['!ref']) throw new ApiError('文件里没有可读取的数据');

  const range = XLSX.utils.decode_range(sheet['!ref']);
  // `!ref` 是可以被随手写成 `A1:XFD1048576` 的，而 `sheet_to_json` 会按这个矩形
  // 铺满数组 —— 先按列宽拦一道，比事后看内存曲线便宜得多。
  const width = range.e.c - range.s.c + 1;
  if (width > MAX_IMPORT_COLUMNS) {
    throw new ApiError(`表格列数过多（${width} 列），请只保留模板中的列后再导入`);
  }
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: true,
  });

  // 表头不一定在第一行：模板被人删掉标题行是常事，往下找前三行。
  let headerIndex = -1;
  let columns: Partial<Record<ImportField, number>> = {};
  const scanLimit = Math.min(matrix.length, 5);
  for (let i = 0; i < scanLimit; i += 1) {
    const row = matrix[i] ?? [];
    const found: Partial<Record<ImportField, number>> = {};
    for (let c = 0; c < row.length; c += 1) {
      const field = HEADER_LOOKUP.get(normalizeHeader(cellText(row[c])));
      if (field && found[field] === undefined) found[field] = c;
    }
    // 注意用 !== undefined 而不是真值判断：账号列在第 0 列时下标是 0，真值判断会漏掉它。
    if (found.username !== undefined && Object.keys(found).length >= 2) {
      headerIndex = i;
      columns = found;
      break;
    }
  }

  if (headerIndex < 0) {
    throw new ApiError('没有找到「账号」表头，请先下载模板再填写');
  }

  const rows: ImportRawRow[] = [];
  for (let i = headerIndex + 1; i < matrix.length; i += 1) {
    const source = matrix[i] ?? [];
    const cells = {} as Record<ImportField, string>;
    let hasValue = false;
    for (const field of IMPORT_FIELDS) {
      const column = columns[field];
      const text = column === undefined ? '' : cellText(source[column]);
      cells[field] = text;
      if (text) hasValue = true;
    }
    if (!hasValue) continue; // 整行空白：不算数据行，也不算错误
    rows.push({ line: range.s.r + i + 1, cells });
  }

  if (rows.length === 0) throw new ApiError('表格里没有数据行');
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new ApiError(`一次最多导入 ${MAX_IMPORT_ROWS} 行，请拆分文件后重试`);
  }
  return rows;
}

// --- ② 校验与冲突 ------------------------------------------------------------

function parseGender(text: string): Gender | null {
  if (!text) return null;
  const value = text.toLowerCase();
  if (['男', 'male', 'm', '1'].includes(value)) return 'male';
  if (['女', 'female', 'f', '2'].includes(value)) return 'female';
  if (['保密', '未知', 'unknown', '0', '-'].includes(value)) return 'unknown';
  return null;
}

function parseStatus(text: string): 'enable' | 'disable' | null {
  if (!text) return null;
  const value = text.toLowerCase();
  if (['启用', '正常', 'enable', 'enabled', '1', '是'].includes(value)) return 'enable';
  if (['停用', '禁用', 'disable', 'disabled', '0', '否'].includes(value)) return 'disable';
  return null;
}

function splitRoleNames(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[,，、;；|]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

interface UserLookupRow extends RowDataPacket {
  id: number;
  username: string;
  email: string;
  mobile: string;
  department_id: number;
}

interface DepartmentLookupRow extends RowDataPacket {
  id: number;
  pid: number;
  name: string;
  status: number;
}

export interface PreparedImport {
  preview: ImportPreview;
  rows: PreparedImportRow[];
}

/**
 * 校验 + 冲突检查。这一层只读库，不写任何东西。
 *
 * 查询是「按需批量」：文件里出现的账号 / 邮箱 / 手机各查一次，
 * 而不是每行三次 —— 500 行就是 1500 次往返，慢到让人以为卡住了。
 */
export async function prepareUserImport(
  context: AdminContext,
  rawRows: readonly ImportRawRow[],
  strategies: UserImportStrategies,
): Promise<PreparedImport> {
  const pool = getPool();
  const usernames = [...new Set(rawRows.map((row) => row.cells.username).filter(Boolean))];
  const emails = [...new Set(rawRows.map((row) => row.cells.email).filter(Boolean))];
  const mobiles = [...new Set(rawRows.map((row) => row.cells.mobile).filter(Boolean))];

  const [departments, roleRows, userRows] = await Promise.all([
    pool.query<DepartmentLookupRow[]>(
      'SELECT `id`,`pid`,`name`,`status` FROM `department` ORDER BY `weigh` DESC, `id` ASC',
    ).then(([rows]) => rows),
    listRoleRows(),
    loadExistingUsers(pool, usernames, emails, mobiles),
  ]);

  const scope = await resolveDepartmentScope(context);
  const visibleDepartmentIds = scope.departmentIds
    ? new Set(scope.departmentIds)
    : new Set(departments.map((row) => Number(row.id)));
  const departmentByName = new Map<string, DepartmentLookupRow[]>();
  for (const row of departments) {
    const key = String(row.name ?? '').trim().toLowerCase();
    if (!key) continue;
    const list = departmentByName.get(key) ?? [];
    list.push(row);
    departmentByName.set(key, list);
  }
  const departmentById = new Map(departments.map((row) => [Number(row.id), row]));
  // 「技术部/前端组」这种带层级的写法也认：同名的子部门挂在不同的父部门下很常见。
  const departmentByPath = new Map<string, DepartmentLookupRow>();
  const pathOf = (id: number, depth = 0): string => {
    const row = departmentById.get(id);
    if (!row || depth > 8) return '';
    const parent = Number(row.pid) > 0 ? pathOf(Number(row.pid), depth + 1) : '';
    return parent ? `${parent}/${row.name}` : String(row.name);
  };
  for (const row of departments) {
    const path = pathOf(Number(row.id)).toLowerCase();
    if (path && !departmentByPath.has(path)) departmentByPath.set(path, row);
  }

  const roleByName = new Map<string, (typeof roleRows)[number]>();
  for (const role of roleRows) {
    roleByName.set(String(role.name ?? '').trim().toLowerCase(), role);
  }

  const byUsername = new Map<string, UserLookupRow>();
  const byEmail = new Map<string, UserLookupRow>();
  const byMobile = new Map<string, UserLookupRow>();
  for (const row of userRows) {
    if (row.username) byUsername.set(row.username.toLowerCase(), row);
    if (row.email) byEmail.set(row.email.toLowerCase(), row);
    if (row.mobile) byMobile.set(row.mobile, row);
  }

  const existingIds = [...new Set(userRows.map((row) => Number(row.id)))];
  const guards = await inspectExistingUsers(context, existingIds);

  const seenUsername = new Map<string, number>();
  const seenEmail = new Map<string, number>();
  const seenMobile = new Map<string, number>();

  const prepared: PreparedImportRow[] = [];

  for (const raw of rawRows) {
    const cells = raw.cells;
    const errors: string[] = [];
    const username = cells.username;
    const email = cells.email;
    const mobile = cells.mobile;

    if (!username) errors.push('账号不能为空');
    else if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) {
      errors.push(`账号长度需在 ${USERNAME_MIN}-${USERNAME_MAX} 个字符之间`);
    } else if (!USERNAME_PATTERN.test(username)) {
      errors.push('账号只能包含字母、数字、下划线和短横线');
    }

    const usernameKey = username.toLowerCase();
    const emailKey = email.toLowerCase();

    const ownerByUsername = usernameKey ? byUsername.get(usernameKey) : undefined;
    const ownerByEmail = emailKey ? byEmail.get(emailKey) : undefined;
    const ownerByMobile = mobile ? byMobile.get(mobile) : undefined;

    // 文件内重复：Excel 里复制粘贴很容易带出两行一样的账号，
    // 早点拦住比写库时报 ER_DUP_ENTRY 更好解释。
    const duplicateReasons: string[] = [];
    if (usernameKey) {
      const seen = seenUsername.get(usernameKey);
      if (seen) duplicateReasons.push(`账号与第 ${seen} 行重复`);
      else seenUsername.set(usernameKey, raw.line);
    }
    if (emailKey) {
      const seen = seenEmail.get(emailKey);
      if (seen) duplicateReasons.push(`邮箱与第 ${seen} 行重复`);
      else seenEmail.set(emailKey, raw.line);
    }
    if (mobile) {
      const seen = seenMobile.get(mobile);
      if (seen) duplicateReasons.push(`手机号与第 ${seen} 行重复`);
      else seenMobile.set(mobile, raw.line);
    }
    errors.push(...duplicateReasons);

    if (email && (!EMAIL_PATTERN.test(email) || email.length > 100)) {
      errors.push('邮箱格式不正确');
    }
    if (mobile && !MOBILE_PATTERN.test(mobile)) {
      errors.push('手机号格式不正确');
    }

    const nickname = cells.nickname.slice(0, 50);
    if (cells.nickname.length > 50) errors.push('昵称不能超过 50 个字符');

    const gender = parseGender(cells.gender);
    if (gender === null && cells.gender) errors.push('性别只能填男 / 女 / 保密');

    const parsedStatus = parseStatus(cells.status);
    if (cells.status && parsedStatus === null) errors.push('状态只能填启用 / 停用');
    const status = parsedStatus ?? strategies.defaultStatus;

    // 部门：留空时落到操作人自己的部门（超管允许「未分配」）。
    let departmentId = 0;
    let departmentName = '';
    if (!cells.department) {
      if (scope.departmentIds === null) {
        departmentId = 0;
      } else {
        departmentId = Number(context.admin.department_id ?? 0) || 0;
        if (departmentId === 0) errors.push('请填写部门');
      }
    } else {
      const key = cells.department.trim().toLowerCase().replace(/\\/g, '/');
      const byPath = departmentByPath.get(key);
      const candidates = byPath ? [byPath] : (departmentByName.get(key.split('/').pop() ?? key) ?? []);
      const target =
        candidates.find((row) => Number(row.status) === 1 && visibleDepartmentIds.has(Number(row.id))) ??
        candidates.find((row) => visibleDepartmentIds.has(Number(row.id)));
      if (candidates.length === 0) errors.push(`部门不存在：${cells.department}`);
      else if (!target) errors.push(`只能导入到本部门及下级部门：${cells.department}`);
      else if (Number(target.status) !== 1) errors.push(`部门已停用：${cells.department}`);
      else departmentId = Number(target.id);
    }
    if (departmentId > 0) {
      departmentName = departmentById.get(departmentId)?.name ?? String(departmentId);
    }
    // 有部门就顺手确认它还在可见范围里：留空落到自己部门时也走这条。
    if (departmentId > 0 && !isDepartmentVisible(scope, departmentId)) {
      errors.push('只能导入到本部门及下级部门');
    }

    // 角色：名称 → id，且必须「我能分配」。
    const roleNames = splitRoleNames(cells.roles);
    const roleIds: number[] = [];
    if (roleNames.length === 0) {
      errors.push('至少填写一个角色');
    }
    for (const name of roleNames) {
      const role = roleByName.get(name.toLowerCase());
      if (!role) {
        errors.push(`角色不存在：${name}`);
        continue;
      }
      if (Number(role.status) !== 1) {
        errors.push(`角色已停用：${name}`);
        continue;
      }
      if (!canOperateRole(context, role)) {
        errors.push(`不能分配角色「${name}」：它的权限超出你的范围`);
        continue;
      }
      roleIds.push(Number(role.id));
    }

    // 密码：新建必填；「修改数据」时可以留空表示不改。
    const password = cells.password;
    const existingId = ownerByUsername ? Number(ownerByUsername.id) : 0;
    if (!password && !existingId) {
      errors.push('密码不能为空');
    } else if (password && password.length < PASSWORD_MIN_LENGTH) {
      errors.push(`密码至少 ${PASSWORD_MIN_LENGTH} 位`);
    }

    // 已存在账号的修改权限：看不见 / 动不了 / 是自己，都不允许通过导入改。
    if (existingId > 0) {
      const guard = guards.get(existingId);
      if (!guard) errors.push('目标账号已不存在，请刷新后重试');
      else if (guard.self) errors.push('不能通过导入修改自己的账号');
      else if (!guard.visible) errors.push('只能导入到本部门及下级部门');
      else if (!guard.operable) errors.push('无权修改该账号（对方权限不低于你）');
    }

    prepared.push({
      line: raw.line,
      username,
      password,
      nickname,
      email,
      mobile,
      gender: gender ?? 'unknown',
      departmentId,
      departmentName,
      roleIds: [...new Set(roleIds)],
      roleNames: roleNames.join('、'),
      status,
      errors,
      existingId,
      existingEmailId: ownerByEmail ? Number(ownerByEmail.id) : 0,
      existingMobileId: ownerByMobile ? Number(ownerByMobile.id) : 0,
    });
  }

  return { preview: toPreview(prepared), rows: prepared };
}

function toPreview(rows: readonly PreparedImportRow[]): ImportPreview {
  const summary: ImportPreviewSummary = {
    total: rows.length,
    create: 0,
    username: 0,
    email: 0,
    mobile: 0,
    error: 0,
  };

  const preview: ImportPreviewRow[] = [];
  for (const row of rows) {
    const emailConflict = row.existingEmailId > 0 && row.existingEmailId !== row.existingId;
    const mobileConflict = row.existingMobileId > 0 && row.existingMobileId !== row.existingId;
    const usernameConflict = row.existingId > 0;

    // 汇总只做「分类计数」，四类相加必须等于总行数，否则一排 chip 加不出「共 N 行」，
    // 看的人会怀疑是不是算错了。有阻断性错误的行只会被跳过，归「异常」，
    // 不再同时记进「账号已存在 / 邮箱已存在 / 手机已存在」——那些策略对它不起作用。
    if (row.errors.length > 0) {
      summary.error += 1;
    } else {
      if (usernameConflict) summary.username += 1;
      if (emailConflict) summary.email += 1;
      if (mobileConflict) summary.mobile += 1;
      if (!usernameConflict && !emailConflict && !mobileConflict) summary.create += 1;
    }

    if (preview.length >= PREVIEW_LIMIT) continue;
    preview.push({
      line: row.line,
      username: row.username,
      nickname: row.nickname,
      email: row.email,
      mobile: row.mobile,
      gender: row.gender,
      departmentName: row.departmentName,
      roleNames: row.roleNames,
      status: row.status,
      conflicts: { username: usernameConflict, email: emailConflict, mobile: mobileConflict },
      errors: row.errors,
    });
  }

  return { total: rows.length, summary, rows: preview, truncated: Math.max(0, rows.length - PREVIEW_LIMIT) };
}

/**
 * 三张「按列查一次」的查询。
 *
 * 分开查而不是一条 OR：任一列都可能为空数组，拼在一起还要处理 `IN ()` 的语法问题，
 * 分开写既不会出错，也更容易看出每一列的命中来源。
 */
async function loadExistingUsers(
  pool: Pool,
  usernames: readonly string[],
  emails: readonly string[],
  mobiles: readonly string[],
): Promise<UserLookupRow[]> {
  const select = 'SELECT `id`,`username`,`email`,`mobile`,`department_id` FROM `user` WHERE ';
  const tasks: Array<Promise<void>> = [];
  const merged = new Map<number, UserLookupRow>();

  const collect = (sql: string, params: unknown[]): Promise<void> =>
    pool.query<UserLookupRow[]>(sql, params).then(([rows]) => {
      for (const row of rows) merged.set(Number(row.id), row);
    });

  if (usernames.length > 0) tasks.push(collect(`${select}\`username\` IN (?)`, [usernames]));
  if (emails.length > 0) tasks.push(collect(`${select}\`email\` IN (?)`, [emails]));
  if (mobiles.length > 0) tasks.push(collect(`${select}\`mobile\` IN (?)`, [mobiles]));

  await Promise.all(tasks);
  return [...merged.values()];
}

interface ImportGuard {
  departmentId: number;
  visible: boolean;
  operable: boolean;
  self: boolean;
}

/**
 * 已有账号「能不能通过导入被修改」。
 *
 * 判据与单条编辑完全一致（部门范围 + 权限不低于自己），只是这里不抛错 ——
 * 导入需要的是「这一行有问题」而不是「整批请求失败」。
 */
async function inspectExistingUsers(
  context: AdminContext,
  ids: readonly number[],
): Promise<Map<number, ImportGuard>> {
  const map = new Map<number, ImportGuard>();
  if (ids.length === 0) return map;

  const inspected = await inspectUsersForImport(context, ids);
  for (const [id, guard] of inspected) map.set(id, guard);
  return map;
}

// --- ③ 写库 ------------------------------------------------------------------

/** 内部信号：命中「停止导入」策略。用异常是为了从循环里直接跳出并统一回滚。 */
class ImportAbort extends Error {
  constructor(
    readonly line: number,
    readonly reason: string,
  ) {
    super(reason);
    this.name = 'ImportAbort';
  }
}

function emptyOutcome(): ImportOutcome {
  return {
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    aborted: false,
    abortedLine: 0,
    abortedReason: '',
    failures: [],
  };
}

async function insertRoles(
  connection: PoolConnection,
  userId: number,
  roleIds: readonly number[],
): Promise<void> {
  if (roleIds.length === 0) return;
  await connection.query('INSERT INTO `user_role` (`user_id`,`role_id`) VALUES ?', [
    roleIds.map((id) => [userId, id]),
  ]);
}

/**
 * 按策略落库。password 先把不同的值各哈希一次：scrypt 一次几十毫秒，
 * 一千行里往往只有一两个密码在重复，缓存能省掉绝大部分开销。
 */
export async function applyUserImport(
  rows: readonly PreparedImportRow[],
  strategies: UserImportStrategies,
): Promise<ImportOutcome> {
  const outcome = emptyOutcome();

  const hashes = new Map<string, string>();
  for (const row of rows) {
    if (!row.password || hashes.has(row.password)) continue;
    hashes.set(row.password, await hashPassword(row.password));
  }

  const pool = getPool();
  const connection = await pool.getConnection();
  const revoke: number[] = [];

  try {
    await connection.beginTransaction();

    for (const row of rows) {
      if (row.errors.length > 0) {
        outcome.failed += 1;
        outcome.failures.push({ line: row.line, reason: row.errors.join('；') });
        continue;
      }

      // 邮箱 / 手机被别人占用（不是这一行要更新的那个账号）：
      // 这是「换人」而不是「改自己」，只能跳过或整体停止。
      if (row.existingEmailId > 0 && row.existingEmailId !== row.existingId) {
        if (strategies.onEmail === 'abort') throw new ImportAbort(row.line, '邮箱已存在');
        outcome.skipped += 1;
        continue;
      }
      if (row.existingMobileId > 0 && row.existingMobileId !== row.existingId) {
        if (strategies.onMobile === 'abort') throw new ImportAbort(row.line, '手机已存在');
        outcome.skipped += 1;
        continue;
      }

      if (row.existingId > 0) {
        if (strategies.onUsername === 'abort') throw new ImportAbort(row.line, '用户已存在');
        if (strategies.onUsername === 'skip') {
          outcome.skipped += 1;
          continue;
        }
        await updateImportedUser(connection, row, hashes, revoke);
        outcome.updated += 1;
        continue;
      }

      await createImportedUser(connection, row, hashes);
      outcome.created += 1;
    }

    if (revoke.length > 0) {
      await connection.query('DELETE FROM `token` WHERE `type` IN (?,?) AND `user_id` IN (?)', [
        TOKEN_TYPE_ADMIN,
        TOKEN_TYPE_ADMIN_REFRESH,
        [...new Set(revoke)],
      ]);
    }

    await connection.commit();
    return outcome;
  } catch (error) {
    await connection.rollback();
    if (error instanceof ImportAbort) {
      // 回滚之后计数已经没有意义：明确告诉调用方「一条都没写」。
      return {
        ...emptyOutcome(),
        aborted: true,
        abortedLine: error.line,
        abortedReason: error.reason,
      };
    }
    throw error;
  } finally {
    connection.release();
  }
}

async function createImportedUser(
  connection: PoolConnection,
  row: PreparedImportRow,
  hashes: Map<string, string>,
): Promise<void> {
  const ts = nowSeconds();
  const password = hashes.get(row.password) ?? '';
  const [result] = await connection.query<ResultSetHeader>(
    'INSERT INTO `user` (`username`,`department_id`,`nickname`,`email`,`mobile`,`motto`,`gender`,`password`,`status`,`create_time`,`update_time`) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [
      row.username,
      row.departmentId,
      row.nickname || row.username,
      row.email,
      row.mobile,
      '',
      row.gender,
      password,
      row.status,
      ts,
      ts,
    ],
  );
  await insertRoles(connection, result.insertId, row.roleIds);
}

async function updateImportedUser(
  connection: PoolConnection,
  row: PreparedImportRow,
  hashes: Map<string, string>,
  revoke: number[],
): Promise<void> {
  const params: unknown[] = [
    row.departmentId,
    row.nickname || row.username,
    row.email,
    row.mobile,
    row.gender,
    row.status,
  ];
  let sql =
    'UPDATE `user` SET `department_id`=?,`nickname`=?,`email`=?,`mobile`=?,`gender`=?,`status`=?,';

  if (row.password) {
    // 与单条编辑保持一致：改密码顺手清掉失败计数，否则旧的锁定记录还会继续锁人。
    sql += '`password`=?,`login_failure`=0,';
    params.push(hashes.get(row.password) ?? '');
  }
  sql += '`update_time`=? WHERE `id`=?';
  params.push(nowSeconds(), row.existingId);

  await connection.query(sql, params);
  await connection.query('DELETE FROM `user_role` WHERE `user_id` = ?', [row.existingId]);
  await insertRoles(connection, row.existingId, row.roleIds);

  // 停用或改密必须让旧 token 失效，否则「导入完还是登录着的」。
  if (row.status === 'disable' || row.password) revoke.push(row.existingId);
}

// --- 模板与导出 --------------------------------------------------------------

const pad = (value: number): string => String(value).padStart(2, '0');

function formatSeconds(seconds: number | undefined | null): string {
  if (!seconds) return '';
  const date = new Date(Number(seconds) * 1000);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function writeWorkbook(workbook: XLSX.WorkBook): Buffer {
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/** 下载模板：一张数据表 + 一张填写说明。示例行让人一眼看懂「角色要写名字」。 */
export function buildUserImportTemplate(): Buffer {
  const header = IMPORT_FIELDS.map((field) => COLUMN_TITLES[field]);
  const sample = ['zhangsan', '123456', '张三', 'zhangsan@example.com', '13800138000', '男', '技术部', '普通用户', '启用'];

  const dataSheet = XLSX.utils.aoa_to_sheet([header, sample]);
  dataSheet['!cols'] = [
    { wch: 16 },
    { wch: 12 },
    { wch: 14 },
    { wch: 26 },
    { wch: 16 },
    { wch: 8 },
    { wch: 16 },
    { wch: 20 },
    { wch: 10 },
  ];

  const guideSheet = XLSX.utils.aoa_to_sheet([
    ['字段', '是否必填', '填写说明'],
    ['账号', '必填', '3-20 位字母、数字、下划线或短横线，不能与已有账号重复'],
    ['密码', '必填', '至少 6 位；「用户已存在」选择「修改数据」时，留空表示不改密码'],
    ['昵称', '选填', '留空时与账号相同，最多 50 个字符'],
    ['邮箱', '选填', '不能与其他账号重复'],
    ['手机号', '选填', '5-20 位数字，可含 + - ( ) 和空格'],
    ['性别', '选填', '男 / 女 / 保密，留空按保密处理'],
    ['部门', '选填', '填写部门名称（含上级时用 / 分隔，如 技术部/前端组）；留空则使用你自己的部门'],
    ['角色', '必填', '多个角色用英文逗号分隔，如 运营,客服；角色名必须与系统里一致'],
    ['状态', '选填', '启用 / 停用，留空时使用「默认状态」'],
  ]);
  guideSheet['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 62 }];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, dataSheet, '用户数据');
  XLSX.utils.book_append_sheet(workbook, guideSheet, '填写说明');
  return writeWorkbook(workbook);
}


const GENDER_TEXT: Record<Gender, string> = { unknown: '保密', male: '男', female: '女' };

/**
 * 导出文件。
 *
 * 列的顺序与模板前 9 列一致，但**不含密码** —— 导出的是资料，
 * 哈希串放进去对谁都没用，明文更不可能有。后面几列是只读的运营信息，
 * 再导入时会被忽略（解析只认模板表头）。
 */
export function buildUserExportFile(rows: readonly UserExportRow[]): Buffer {
  const header = [
    '账号',
    '昵称',
    '邮箱',
    '手机号',
    '性别',
    '部门',
    '角色',
    '状态',
    '注册时间',
    '最近登录',
    '最近登录 IP',
  ];
  const body = rows.map((row) => [
    row.username,
    row.nickname,
    row.email,
    row.mobile,
    GENDER_TEXT[row.gender] ?? '保密',
    row.departmentName,
    row.roleNames,
    row.status === 'disable' ? '停用' : '启用',
    formatSeconds(row.createTime),
    formatSeconds(row.lastLoginTime),
    row.lastLoginIp,
  ]);

  const sheet = XLSX.utils.aoa_to_sheet([header, ...body]);
  sheet['!cols'] = [
    { wch: 16 },
    { wch: 14 },
    { wch: 26 },
    { wch: 16 },
    { wch: 8 },
    { wch: 16 },
    { wch: 20 },
    { wch: 10 },
    { wch: 20 },
    { wch: 20 },
    { wch: 16 },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, '用户数据');
  return writeWorkbook(workbook);
}

/** 文件名带日期：同一天导两次也能区分开，不用在文件名里塞随机串。 */
export function timestampedFileName(prefix: string): string {
  const now = new Date();
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `${prefix}-${stamp}.xlsx`;
}
