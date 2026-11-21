/**
 * 菜单/权限节点（`permission_rule`）的读写。
 *
 * 三条与文档 7.3 对应的规则：
 *   · `name` 唯一，是接口验权的标识，大小写不敏感；
 *   · 新增节点时，**已拥有父节点的角色自动获得新节点**（autoAssignPermission）——
 *     否则每加一个按钮，都要人工去给 N 个角色补授权；
 *   · 删除节点时从所有角色的 rules 串里剔除它的 id（补偿逻辑），
 *     否则角色会残留指向不存在节点的 id。
 */
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { getPool } from '../../database/pool';
import { ApiError } from '../http';
import { parseRules, ruleIdsToNumbers, type AdminContext, type RuleRow } from './rbac';
import { stripRuleIdsFromRoles } from './role-service';
import { nowSeconds } from './token';

export const RULE_TYPES = ['menu_dir', 'menu', 'button'] as const;
export type RuleTypeInput = (typeof RULE_TYPES)[number];

export interface RuleInput {
  pid: number;
  type: RuleTypeInput;
  title: string;
  name: string;
  path: string;
  icon: string;
  menuType: string;
  url: string;
  component: string;
  keepalive: number;
  remark: string;
  weigh: number;
  status: number;
}

const NAME_PATTERN = /^[A-Za-z0-9_\-/]+$/;

/** 名字里不允许空格和 `?`：前者会让规则名前后不一致，后者是文档里 url 模式的保留语法。 */
function assertName(name: string): void {
  if (!name) throw new ApiError('权限标识不能为空');
  if (!NAME_PATTERN.test(name)) throw new ApiError('权限标识只允许字母、数字、下划线、短横线与斜杠');
  if (name.length > 100) throw new ApiError('权限标识过长（最多 100 字符）');
}

export async function normalizeRuleInput(
  context: AdminContext,
  raw: unknown,
  options: { id?: number } = {},
): Promise<RuleInput> {
  const body = (raw ?? {}) as Record<string, unknown>;
  const type = (typeof body.type === 'string' ? body.type : 'menu') as RuleTypeInput;
  if (!RULE_TYPES.includes(type)) throw new ApiError('节点类型不合法');

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  assertName(name);

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) throw new ApiError('节点名称不能为空');

  const pid = Number(body.pid ?? 0);
  const safePid = Number.isInteger(pid) && pid > 0 ? pid : 0;
  if (options.id && safePid === options.id) throw new ApiError('上级节点不能是自己');
  if (safePid > 0) {
    const parent = await getRuleById(safePid);
    if (!parent) throw new ApiError('上级节点不存在');
    // 非超管只能在「自己有权」的节点下建子节点，避免凭空造出一个顶级菜单
    if (!context.isSuper && !ruleIdsToNumbers(context.ruleIds).includes(safePid)) {
      throw new ApiError('不能在无权访问的节点下创建子节点');
    }
    if (options.id && (await isDescendant(safePid, options.id))) {
      throw new ApiError('上级节点不能是自己的子节点');
    }
  } else if (!context.isSuper) {
    throw new ApiError('只有超级管理员可以创建顶级节点');
  }

  const path = typeof body.path === 'string' ? body.path.trim() : '';
  if (type !== 'button' && !path) throw new ApiError('菜单/目录必须填写路由 path');
  if (path && !path.startsWith('/') && !path.startsWith('#')) {
    throw new ApiError('路由 path 必须以 / 或 # 开头');
  }

  // 同名节点会让 check() 无法区分是哪一个，唯一约束必须前置成可读的错误。
  const pool = getPool();
  const [duplicated] = await pool.query<Array<{ id: number } & RowDataPacket>>(
    'SELECT `id` FROM `permission_rule` WHERE `name` = ? AND `id` <> ? LIMIT 1',
    [name, options.id ?? 0],
  );
  if (duplicated.length > 0) throw new ApiError('该权限标识已被其他节点占用');

  return {
    pid: safePid,
    type,
    title,
    name,
    path: type === 'button' ? '' : path,
    icon: typeof body.icon === 'string' ? body.icon.trim() : '',
    menuType: typeof body.menu_type === 'string' ? body.menu_type : '',
    url: typeof body.url === 'string' ? body.url.trim() : '',
    component: typeof body.component === 'string' ? body.component : '',
    keepalive: body.keepalive === 0 || body.keepalive === false ? 0 : 1,
    remark: typeof body.remark === 'string' ? body.remark : '',
    weigh: Number.isFinite(Number(body.weigh)) ? Number(body.weigh) : 0,
    status: body.status === 0 || body.status === false ? 0 : 1,
  };
}

export async function getRuleById(id: number): Promise<RuleRow | undefined> {
  const pool = getPool();
  const [rows] = await pool.query<RuleRow[]>('SELECT * FROM `permission_rule` WHERE `id` = ? LIMIT 1', [id]);
  return rows[0];
}

async function isDescendant(candidateId: number, ancestorId: number): Promise<boolean> {
  let cursor = candidateId;
  const pool = getPool();
  // 树深是人为维护的，最多十几层；加一个循环上限防止数据被改坏后死循环。
  for (let depth = 0; depth < 64 && cursor > 0; depth += 1) {
    if (cursor === ancestorId) return true;
    const [rows] = await pool.query<Array<{ pid: number } & RowDataPacket>>(
      'SELECT `pid` FROM `permission_rule` WHERE `id` = ? LIMIT 1',
      [cursor],
    );
    const pid = rows[0]?.pid;
    if (!pid) return false;
    cursor = pid;
  }
  return false;
}

export async function createRule(input: RuleInput): Promise<number> {
  const pool = getPool();
  const ts = nowSeconds();
  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO \`permission_rule\`
      (\`pid\`,\`type\`,\`title\`,\`name\`,\`path\`,\`icon\`,\`menu_type\`,\`url\`,\`component\`,\`keepalive\`,\`extend\`,\`remark\`,\`weigh\`,\`status\`,\`create_time\`,\`update_time\`)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      input.pid,
      input.type,
      input.title,
      input.name,
      input.path,
      input.icon,
      input.menuType,
      input.url,
      input.component,
      input.keepalive,
      'none',
      input.remark,
      input.weigh,
      input.status,
      ts,
      ts,
    ],
  );

  const id = result.insertId;

  // autoAssignPermission：拥有父节点的角色自动获得新节点（超管角色是 '*'，不用动）
  if (input.pid > 0) {
    await pool.query(
      'UPDATE `role` SET `rules` = CONCAT(`rules`, \',\', ?), `update_time` = ? WHERE `rules` <> \'*\' AND FIND_IN_SET(?, `rules`)',
      [id, ts, input.pid],
    );
  }

  return id;
}

export async function updateRule(id: number, input: RuleInput): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE \`permission_rule\` SET \`pid\`=?,\`type\`=?,\`title\`=?,\`name\`=?,\`path\`=?,\`icon\`=?,\`menu_type\`=?,\`url\`=?,\`component\`=?,\`keepalive\`=?,\`remark\`=?,\`weigh\`=?,\`status\`=?,\`update_time\`=? WHERE \`id\`=?`,
    [
      input.pid,
      input.type,
      input.title,
      input.name,
      input.path,
      input.icon,
      input.menuType,
      input.url,
      input.component,
      input.keepalive,
      input.remark,
      input.weigh,
      input.status,
      nowSeconds(),
      id,
    ],
  );
}

/**
 * 删除节点：有子节点先拒绝；然后从所有角色的 rules 里剔除它。
 * 级联删除会让「撤销一个菜单」变成一次不可预期的批量操作，这里选择让操作者显式分步。
 */
export async function deleteRule(id: number): Promise<void> {
  const pool = getPool();
  const [children] = await pool.query<Array<{ id: number } & RowDataPacket>>(
    'SELECT `id` FROM `permission_rule` WHERE `pid` = ? LIMIT 1',
    [id],
  );
  if (children.length > 0) throw new ApiError('该节点下还有子节点，请先删除子节点');

  await pool.query('DELETE FROM `permission_rule` WHERE `id` = ?', [id]);
  await stripRuleIdsFromRoles([id]);
}

/** 供前端提示「这个角色有多少节点」用；`'*'` 返回 -1 表示全部。 */
export function ruleCountOf(roleRules: string | null): number {
  const ids = parseRules(roleRules);
  return ids.includes('*') ? -1 : ruleIdsToNumbers(ids).length;
}
