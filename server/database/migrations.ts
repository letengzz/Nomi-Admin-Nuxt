/**
 * 数据库迁移：两段式。
 *
 * ① `migrateLegacyTableNames()` —— 在**建表语句之前**执行。
 *    表改名必须赶在 `CREATE TABLE IF NOT EXISTS role ...` 之前，否则会先建出一张
 *    空的新表，再改名就撞名了。这一步天然幂等（源表在、目标表不在才动手），
 *    所以不需要记账。
 *
 * ② `runMigrations()` —— 在种子之后执行，用 `schema_migration` 记账。
 *    处理「删字段」「搬节点」「补授权」这类不能重复做的改动。
 *
 * 两段都失败即抛：半迁移的库比启动不了更难查。
 *
 * 注意：**新鲜安装的库也会跑一遍 ②**（schema_migration 是空的）。所以每个迁移
 * 都必须写成「已经在目标状态就什么都不做」，不能假设自己是唯一一次机会。
 */
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { verifyPassword } from '../utils/auth/password';
import { richHtmlLooksDangerous, sanitizeRichHtml } from '../utils/rich-html';
import { LANGUAGE_ENTRY_SEEDS } from './language-seed';
import { SEED_ADMINS, SEED_USERS, defaultConfigRows } from './seed';

interface NameRow extends RowDataPacket {
  name: string;
}

interface CountRow extends RowDataPacket {
  total: number;
}

interface IdRow extends RowDataPacket {
  id: number;
}

interface RoleRuleRow extends RowDataPacket {
  id: number;
  rules: string | null;
}

export interface MigrationReport {
  applied: string[];
}

async function tableExists(pool: Pool, table: string): Promise<boolean> {
  const [rows] = await pool.query<CountRow[]>(
    `SELECT COUNT(*) AS total
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table],
  );
  return Number(rows[0]?.total ?? 0) > 0;
}

async function hasColumn(pool: Pool, table: string, column: string): Promise<boolean> {
  const [rows] = await pool.query<CountRow[]>(
    `SELECT COUNT(*) AS total
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column],
  );
  return Number(rows[0]?.total ?? 0) > 0;
}

async function hasIndex(pool: Pool, table: string, index: string): Promise<boolean> {
  const [rows] = await pool.query<CountRow[]>(
    `SELECT COUNT(*) AS total
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, index],
  );
  return Number(rows[0]?.total ?? 0) > 0;
}

/**
 * 旧表名 → 新表名。
 *
 * 顺序不是随手写的：`*_access` 要先于 `*_group` 改名 —— 两者的老名字里都带
 * `group`，先改短的会把长的那个留成孤儿。
 */
const TABLE_RENAMES: ReadonlyArray<readonly [string, string]> = [
  ['admin', 'user'],
  ['admin_group_access', 'user_role'],
  ['user_group_access', 'user_role'],
  ['admin_group', 'role'],
  ['user_group', 'role'],
  ['admin_rule', 'permission_rule'],
  ['admin_log', 'operation_log'],
];

/** 外键列也跟着功能改，避免 `user_role` 上挂着 `group_id`。 */
const COLUMN_RENAMES = [
  { table: 'user_role', from: 'uid', to: 'user_id' },
  { table: 'user_role', from: 'group_id', to: 'role_id' },
  { table: 'operation_log', from: 'admin_id', to: 'user_id' },
] as const;

const INDEX_RENAMES = [
  { table: 'user_role', from: 'uk_uid_group', to: 'uk_user_role' },
  { table: 'user_role', from: 'uk_user_group', to: 'uk_user_role' },
  { table: 'user_role', from: 'idx_group', to: 'idx_role' },
  { table: 'operation_log', from: 'idx_admin', to: 'idx_user' },
] as const;

/**
 * 表名对齐功能：管理员不再单独成模块，账号表就不该继续叫 `admin`；
 * 「角色组」这个概念统一叫「角色」，表名也跟着叫 `role`。
 *
 * 在 SCHEMA_STATEMENTS 之前调用。全新库没有旧表 → 什么都不做。
 */
export async function migrateLegacyTableNames(pool: Pool): Promise<string[]> {
  const renamed: string[] = [];

  for (const [from, to] of TABLE_RENAMES) {
    if (!(await tableExists(pool, from))) continue;
    if (await tableExists(pool, to)) continue; // 已经改过（或用户手工建了同名表）
    await pool.query(`RENAME TABLE \`${from}\` TO \`${to}\``);
    renamed.push(`${from} → ${to}`);
  }

  for (const { table, from, to } of COLUMN_RENAMES) {
    if (!(await tableExists(pool, table))) continue;
    if (!(await hasColumn(pool, table, from))) continue;
    if (await hasColumn(pool, table, to)) continue;
    await pool.query(
      `ALTER TABLE \`${table}\` CHANGE \`${from}\` \`${to}\` ${columnType(table, from)}`,
    );
    renamed.push(`${table}.${from} → ${table}.${to}`);
  }

  for (const { table, from, to } of INDEX_RENAMES) {
    if (!(await tableExists(pool, table))) continue;
    if (!(await hasIndex(pool, table, from))) continue;
    if (await hasIndex(pool, table, to)) continue;
    await pool.query(`ALTER TABLE \`${table}\` RENAME INDEX \`${from}\` TO \`${to}\``);
  }

  if (renamed.length > 0) {
    console.info(`[db] 表名已对齐功能：${renamed.join(', ')}`);
  }
  return renamed;
}

/** CHANGE 需要重复一遍列定义；这几列的定义很固定，直接查一次表结构最稳。 */
function columnType(table: string, column: string): string {
  const map: Record<string, string> = {
    'user_role.uid': "int unsigned NOT NULL COMMENT 'user.id'",
    'user_role.group_id': "int unsigned NOT NULL COMMENT 'role.id'",
    'operation_log.admin_id': 'int unsigned NOT NULL DEFAULT 0',
  };
  const type = map[`${table}.${column}`];
  if (!type) throw new Error(`缺少列定义：${table}.${column}`);
  return type;
}

function parseRuleIds(raw: string): number[] {
  return raw
    .split(',')
    .map((item) => Number.parseInt(item.trim(), 10))
    .filter((id) => Number.isFinite(id) && id > 0);
}

/** 一次性迁移里反复要用的「按名字找节点 id」。 */
async function ruleIdByName(pool: Pool, name: string): Promise<number> {
  const [rows] = await pool.query<IdRow[]>(
    'SELECT `id` FROM `permission_rule` WHERE `name` = ? LIMIT 1',
    [name],
  );
  return rows[0]?.id ?? 0;
}

/**
 * 保证一组按钮节点存在（挂在 `parentName` 下），返回 name → id。
 * 已存在的节点不重建，id 沿用库里的 —— 授权串里引用的就是这些 id。
 */
async function ensureRuleNodes(
  pool: Pool,
  parentName: string,
  nodes: ReadonlyArray<{ name: string; title: string }>,
): Promise<Map<string, number>> {
  const parentId = await ruleIdByName(pool, parentName);
  const result = new Map<string, number>();
  if (!parentId) return result;

  const ts = Math.floor(Date.now() / 1000);
  for (const node of nodes) {
    const existing = await ruleIdByName(pool, node.name);
    if (existing) {
      result.set(node.name, existing);
      continue;
    }
    const [inserted] = await pool.query<ResultSetHeader>(
      "INSERT INTO `permission_rule` (`pid`,`type`,`title`,`name`,`path`,`icon`,`weigh`,`status`,`create_time`,`update_time`) VALUES (?, 'button', ?, ?, '', '', 0, 1, ?, ?)",
      [parentId, node.title, node.name, ts, ts],
    );
    if (inserted.insertId) result.set(node.name, inserted.insertId);
  }
  return result;
}

/**
 * 把一批节点补进「已经拥有 `anchorName` 的角色」。
 *
 * 用「是否拥有锚点节点」而不是「是否叫管理员」来挑角色：角色名可以改，
 * 权限集合才是事实。超级管理员（`'*'`）不用补，它天生拥有全部节点。
 */
async function grantRulesToRolesWith(
  pool: Pool,
  anchorName: string,
  ids: readonly number[],
): Promise<void> {
  if (ids.length === 0) return;
  const anchorId = await ruleIdByName(pool, anchorName);
  if (!anchorId) return;

  const [roles] = await pool.query<RoleRuleRow[]>('SELECT `id`,`rules` FROM `role`');
  for (const role of roles) {
    const raw = (role.rules ?? '').trim();
    if (!raw || raw === '*') continue; // 超管用 '*'，不需要补
    const current = parseRuleIds(raw);
    if (!current.includes(anchorId)) continue; // 本来就没这个能力，别借着迁移提权
    const missing = ids.filter((id) => !current.includes(id));
    if (missing.length === 0) continue;
    await pool.query('UPDATE `role` SET `rules` = ?, `update_time` = ? WHERE `id` = ?', [
      [...current, ...missing].join(','),
      Math.floor(Date.now() / 1000),
      role.id,
    ]);
  }
}

/** 1) 删掉「账号类型」字段。一个人和后台的关系只由「他有哪些角色」表达。 */
async function dropUserType(pool: Pool): Promise<void> {
  if (!(await tableExists(pool, 'user'))) return;
  if (await hasIndex(pool, 'user', 'idx_type')) {
    await pool.query('ALTER TABLE `user` DROP KEY `idx_type`');
  }
  if (await hasColumn(pool, 'user', 'user_type')) {
    await pool.query('ALTER TABLE `user` DROP COLUMN `user_type`');
  }
}

/** 2) 账号表加 `department_id`，并把演示账号落到各自的部门。 */
async function addUserDepartment(pool: Pool): Promise<void> {
  if (!(await hasColumn(pool, 'user', 'department_id'))) {
    await pool.query(
      "ALTER TABLE `user` ADD COLUMN `department_id` int unsigned NOT NULL DEFAULT 0 COMMENT '所属部门 department.id，0 = 未分配' AFTER `username`",
    );
  }
  if (!(await hasIndex(pool, 'user', 'idx_department'))) {
    await pool.query('ALTER TABLE `user` ADD KEY `idx_department` (`department_id`)');
  }

  // 只在 department 表真的有对应 id 时才写：用户可能已经把默认部门删了。
  const fallback = new Map<string, number>();
  for (const admin of SEED_ADMINS) fallback.set(admin.username, admin.departmentId);
  for (const user of SEED_USERS) fallback.set(user.username, user.departmentId);

  for (const [username, departmentId] of fallback) {
    const [dept] = await pool.query<CountRow[]>(
      'SELECT COUNT(*) AS total FROM `department` WHERE `id` = ?',
      [departmentId],
    );
    if (Number(dept[0]?.total ?? 0) === 0) continue;
    await pool.query(
      'UPDATE `user` SET `department_id` = ? WHERE `username` = ? AND `department_id` = 0',
      [departmentId, username],
    );
  }
}

/**
 * 3) 「角色组」统一叫「角色」；普通用户也是角色。
 *
 * 前端的入口也从「权限管理」改成「角色管理」，路由跟着改成 /admin/system/roles ——
 * 页面讲的是什么，路径就该叫什么，否则收藏夹里永远躺着一个会误导人的 URL。
 */
async function renameRoles(pool: Pool): Promise<void> {
  const ts = Math.floor(Date.now() / 1000);

  // 页面讲的是「角色」，管理里的目录也就该叫「角色管理」。名字只改一次，
  // 之后再改由用户自己决定（所以这里按旧名匹配，不是无条件覆盖）。
  await pool.query("UPDATE `role` SET `name` = '超级管理员' WHERE `name` = '超级管理组'");
  await pool.query("UPDATE `role` SET `name` = '普通用户' WHERE `name` = '只读访客'");

  // 普通用户 = 最小权限：仪表盘 + 个人中心。之前「只读访客」能看到大半个后台，
  // 那更像「只读管理员」，和「普通用户」不是一回事。
  const dashboard = await ruleIdByName(pool, 'dashboard');
  const profile = await ruleIdByName(pool, 'system/profile');
  const profileIndex = await ruleIdByName(pool, 'system/profile/index');
  const profileEdit = await ruleIdByName(pool, 'system/profile/edit');
  const minimal = [dashboard, profile, profileIndex, profileEdit].filter((id) => id > 0);
  await pool.query(
    "UPDATE `role` SET `rules` = ?, `update_time` = ? WHERE `name` = '普通用户' AND `rules` NOT LIKE '%*%'",
    [minimal.join(','), ts],
  );

  await pool.query(
    "UPDATE `permission_rule` SET `title` = 'layout.menu.roles', `icon` = 'role', `path` = '/admin/system/roles', `update_time` = ? WHERE `name` = 'system/role'",
    [ts],
  );
}

/** 4) 部门管理：补菜单节点 + 给「能管人」的角色补授权。 */
async function addDepartmentMenu(pool: Pool): Promise<void> {
  const ts = Math.floor(Date.now() / 1000);
  const systemDir = await ruleIdByName(pool, 'system');
  if (!systemDir) return;

  const menuId = await ruleIdByName(pool, 'system/department');
  let targetId = menuId;
  if (!targetId) {
    const [inserted] = await pool.query<ResultSetHeader>(
      "INSERT INTO `permission_rule` (`pid`,`type`,`title`,`name`,`path`,`icon`,`weigh`,`status`,`create_time`,`update_time`) VALUES (?, 'menu', 'layout.menu.departments', 'system/department', '/admin/system/departments', 'department', 50, 1, ?, ?)",
      [systemDir, ts, ts],
    );
    targetId = inserted.insertId;
  }
  if (!targetId) return;

  const actions = await ensureRuleNodes(pool, 'system/department', [
    { name: 'system/department/index', title: 'auth.action.view' },
    { name: 'system/department/add', title: 'auth.action.add' },
    { name: 'system/department/edit', title: 'auth.action.edit' },
    { name: 'system/department/del', title: 'auth.action.delete' },
  ]);

  // 以「能看用户列表」为锚点：能管人的角色，自然也该能维护部门树。
  await grantRulesToRolesWith(pool, 'system/user/index', [targetId, ...actions.values()]);
}

/**
 * 5) 操作日志改成「所有账号的日志」。
 *
 * 之前非超管只能看自己的日志，日志页对普通管理员形同虚设。现在日志是团队
 * 级的审计视图：能进日志页就能看全部，接口不再按登录人裁剪。相应地，
 * 「能看用户列表」的角色补上日志节点，否则这个改动对他们没有意义。
 */
async function openOperationLog(pool: Pool): Promise<void> {
  const logMenu = await ruleIdByName(pool, 'system/log');
  if (!logMenu) return;
  const actions = await ensureRuleNodes(pool, 'system/log', [
    { name: 'system/log/index', title: 'auth.action.view' },
  ]);
  await grantRulesToRolesWith(pool, 'system/user/index', [logMenu, ...actions.values()]);
}

/** 6) 没有角色的账号补「普通用户」：删了类型字段之后，没人能靠字段登录了。 */
async function assignDefaultRole(pool: Pool): Promise<void> {
  const [role] = await pool.query<IdRow[]>(
    "SELECT `id` FROM `role` WHERE `name` = '普通用户' ORDER BY `id` ASC LIMIT 1",
  );
  const roleId = role[0]?.id;
  if (!roleId) return;

  await pool.query(
    'INSERT IGNORE INTO `user_role` (`user_id`,`role_id`) SELECT u.`id`, ? FROM `user` u LEFT JOIN `user_role` ur ON ur.`user_id` = u.`id` WHERE ur.`user_id` IS NULL',
    [roleId],
  );
}

/** 7) 让「部门管理」在菜单里排在「用户管理」之后（老库里新节点默认 weigh=0 会掉到底部）。 */
async function tidyMenuWeights(pool: Pool): Promise<void> {
  const weights: ReadonlyArray<readonly [string, number]> = [
    ['system/user', 60],
    ['system/department', 50],
    ['system/role', 40],
    ['system/rule', 30],
    ['system/log', 20],
    ['system/settings', 10],
  ];
  for (const [name, weigh] of weights) {
    await pool.query('UPDATE `permission_rule` SET `weigh` = ? WHERE `name` = ? AND `weigh` <> ?', [
      weigh,
      name,
      weigh,
    ]);
  }
}

interface ColumnTypeRow extends RowDataPacket {
  COLUMN_TYPE: string;
}

/**
 * 富文本正文扩容：公告内容改为富文本 HTML 后可能超过 text 的 64KB。
 * 按 information_schema 的实际类型判断，只有仍是 text 时才 ALTER；
 * mediumtext/longtext 一律跳过，重复执行不会反复改表。
 */
async function widenNoticeContent(pool: Pool): Promise<void> {
  if (!(await tableExists(pool, 'announcement'))) return;
  const [rows] = await pool.query<ColumnTypeRow[]>(
    `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'announcement' AND COLUMN_NAME = 'content'
       LIMIT 1`,
  );
  const type = rows[0]?.COLUMN_TYPE ?? '';
  if (type === 'mediumtext' || type === 'longtext') return;
  await pool.query(
    "ALTER TABLE `announcement` MODIFY COLUMN `content` mediumtext COMMENT '正文内容（富文本 HTML）'",
  );
}

interface Migration {
  name: string;
  run: (pool: Pool) => Promise<void>;
}

/** 8) 角色加 `code`（编码）：名字可以随便改，代码里引用的标识不该跟着改名。 */
async function addRoleCode(pool: Pool): Promise<void> {
  if (!(await tableExists(pool, 'role'))) return;
  if (!(await hasColumn(pool, 'role', 'code'))) {
    await pool.query(
      "ALTER TABLE `role` ADD COLUMN `code` varchar(50) NOT NULL DEFAULT '' COMMENT '角色编码：代码/接口里引用的稳定标识' AFTER `name`",
    );
  }

  // 三个种子角色按名字补编码（幂等：只在 code 还是空的时候写）。
  // 名字是弱匹配 —— 已被改过名的角色跳过即可，编码本来就该人工维护。
  const known: ReadonlyArray<readonly [string, string]> = [
    ['超级管理员', 'super'],
    ['管理员', 'admin'],
    ['普通用户', 'member'],
  ];
  for (const [name, code] of known) {
    await pool.query("UPDATE `role` SET `code` = ? WHERE `name` = ? AND `code` = ''", [code, name]);
  }
}

/**
 * 8) 语言管理菜单：把 system/language 及四个按钮补进已有安装。
 *
 * 全新库由 SEED_RULES 写入，这里按 name 查得到就跳过，所以两边不会打架。
 * 授权锚点仍用「能看用户列表」，与部门/日志菜单保持一致。
 */
async function addLanguageMenu(pool: Pool): Promise<void> {
  const ts = Math.floor(Date.now() / 1000);
  const systemDir = await ruleIdByName(pool, 'system');
  if (!systemDir) return;

  let menuId = await ruleIdByName(pool, 'system/language');
  if (!menuId) {
    const [inserted] = await pool.query<ResultSetHeader>(
      "INSERT INTO `permission_rule` (`pid`,`type`,`title`,`name`,`path`,`icon`,`weigh`,`status`,`create_time`,`update_time`) VALUES (?, 'menu', 'layout.menu.languages', 'system/language', '/admin/system/languages', 'language', 15, 1, ?, ?)",
      [systemDir, ts, ts],
    );
    menuId = inserted.insertId;
  }
  if (!menuId) return;

  const actions = await ensureRuleNodes(pool, 'system/language', [
    { name: 'system/language/index', title: 'auth.action.view' },
    { name: 'system/language/add', title: 'auth.action.add' },
    { name: 'system/language/edit', title: 'auth.action.edit' },
    { name: 'system/language/del', title: 'auth.action.delete' },
  ]);
  await grantRulesToRolesWith(pool, 'system/user/index', [menuId, ...actions.values()]);
}

interface EntryIdRow extends RowDataPacket {
  id: number;
  key: string;
}

/**
 * 9.5) 词条分「系统 / 自定义」两类。
 *
 * 系统词条 = 从项目内置 zh/en.json 导入的那批（key 在 LANGUAGE_ENTRY_SEEDS 里）。
 * 它们是页面文案的兜底：允许改译文，但不允许删 —— 删掉之后界面会自动回退到
 * 内置文案，列表里那条记录就成了「删了却还在用」的幽灵。
 * 其余（后台手填的 key）一律 custom，可以随便删。
 *
 * 顺带把种子表里的新 key 补进来（INSERT IGNORE，管理员改过的译文不会被覆盖）。
 * 类型以种子表为唯一事实来源：先全部归一成 custom，再按 key 标 system，
 * 所以这个迁移重复执行也不会漂。
 */
async function addLanguageEntryType(pool: Pool): Promise<void> {
  if (!(await tableExists(pool, 'language_entry'))) return;
  if (!(await hasColumn(pool, 'language_entry', 'type'))) {
    await pool.query(
      "ALTER TABLE `language_entry` ADD COLUMN `type` varchar(16) NOT NULL DEFAULT 'custom' COMMENT 'system = 内置语言文件导入 / custom = 后台新增' AFTER `module`",
    );
  }
  if (!(await hasIndex(pool, 'language_entry', 'idx_type'))) {
    await pool.query('ALTER TABLE `language_entry` ADD KEY `idx_type` (`type`)');
  }

  await importLanguageEntries(pool);
  await markSeedEntriesAsSystem(pool);
}

/**
 * 按种子表校正词条类型：先全部归一成 custom，再把种子里的 key 标 system。
 * 种子表是「哪些 key 属于系统」的唯一事实来源，所以这里可以重复执行。
 */
async function markSeedEntriesAsSystem(pool: Pool): Promise<void> {
  await pool.query("UPDATE `language_entry` SET `type` = 'custom' WHERE `type` <> 'custom'");
  const keys = LANGUAGE_ENTRY_SEEDS.map((seed) => seed.key);
  for (let i = 0; i < keys.length; i += 500) {
    await pool.query("UPDATE `language_entry` SET `type` = 'system' WHERE `key` IN (?)", [
      keys.slice(i, i + 500),
    ]);
  }
}

/**
 * 9.6) 界面文案增补后，把新 key 补成系统词条。
 *
 * 上一批导入已经记账、不会重跑，而 `pnpm lang:sync` 生成的种子表会随 zh/en.json
 * 增长 —— 没有这一步，语言管理里会永远缺最近新增的那些文案。
 * INSERT IGNORE：只补缺失的 key，管理员改过的译文一条都不动。
 */
async function syncLanguageSeedEntries(pool: Pool): Promise<void> {
  if (!(await tableExists(pool, 'language_entry'))) return;
  await importLanguageEntries(pool);
  await markSeedEntriesAsSystem(pool);
}

/**
 * 9) 把项目内置语言文件的全部词条导入数据库。
 *
 * 数据是 `scripts/sync-language-seed.mjs` 从 zh/en.json 生成的 TS 常量：
 * 生产构建的 .output 里不一定还有 i18n 目录，运行时读文件不可靠。
 * 全用 INSERT IGNORE —— 管理员改过的译文不会被种子覆盖，只补齐缺失的 key。
 */
async function importLanguageEntries(pool: Pool): Promise<void> {
  const ts = Math.floor(Date.now() / 1000);

  // 语言定义由 seedIfEmpty 写入，这里再兜一次（老库可能没有这两行）。
  await pool.query(
    "INSERT IGNORE INTO `language` (`code`,`name`,`native_name`,`weigh`,`status`,`create_time`,`update_time`) VALUES ('zh','简体中文','简体中文',100,1,?,?),('en','English','English',90,1,?,?)",
    [ts, ts, ts, ts],
  );

  // `type` 是后加的列（见 addLanguageEntryType）。这个函数在若干迁移里被复用，
  // 执行顺序不保证列已经存在，所以按实际表结构拼 SQL 而不是假设它有。
  const hasType = await hasColumn(pool, 'language_entry', 'type');
  const entryRows = LANGUAGE_ENTRY_SEEDS.map((seed) =>
    hasType ? [seed.key, seed.module, 'system', ts, ts] : [seed.key, seed.module, ts, ts],
  );
  const columns = hasType
    ? '(`key`,`module`,`type`,`create_time`,`update_time`)'
    : '(`key`,`module`,`create_time`,`update_time`)';
  for (let i = 0; i < entryRows.length; i += 200) {
    await pool.query(`INSERT IGNORE INTO \`language_entry\` ${columns} VALUES ?`, [
      entryRows.slice(i, i + 200),
    ]);
  }

  const [entries] = await pool.query<EntryIdRow[]>('SELECT `id`,`key` FROM `language_entry`');
  const idByKey = new Map(entries.map((row) => [row.key, Number(row.id)]));
  const valueRows: unknown[][] = [];
  for (const seed of LANGUAGE_ENTRY_SEEDS) {
    const entryId = idByKey.get(seed.key);
    if (!entryId) continue;
    for (const [code, value] of Object.entries(seed as unknown as Record<string, unknown>)) {
      if (code === 'key' || code === 'module') continue;
      valueRows.push([entryId, code, String(value ?? ''), ts]);
    }
  }
  for (let i = 0; i < valueRows.length; i += 200) {
    await pool.query(
      'INSERT IGNORE INTO `language_value` (`entry_id`,`lang_code`,`value`,`update_time`) VALUES ?',
      [valueRows.slice(i, i + 200)],
    );
  }
}

/**
 * 按「旧值匹配」刷新译文：只覆盖还留着旧种子文案的行。
 *
 * 为什么 WHERE 里要带原值：管理员在语言管理里改过的内容绝不能被迁移冲掉，
 * 所以只有「当前值恰好等于旧种子文案」的行才更新，其余一律放过。
 */
type LanguageOverride = readonly [
  key: string,
  langCode: string,
  oldValue: string,
  newValue: string,
];

async function applyLanguageOverrides(
  pool: Pool,
  overrides: readonly LanguageOverride[],
): Promise<void> {
  const ts = Math.floor(Date.now() / 1000);
  for (const [key, lang, oldValue, newValue] of overrides) {
    await pool.query(
      `UPDATE \`language_value\` lv
          INNER JOIN \`language_entry\` le ON le.\`id\` = lv.\`entry_id\`
          SET lv.\`value\` = ?, lv.\`update_time\` = ?
        WHERE le.\`key\` = ? AND lv.\`lang_code\` = ? AND lv.\`value\` = ?`,
      [newValue, ts, key, lang, oldValue],
    );
  }
}

/**
 * 10) 部门数据范围上线后，几条「部门不参与权限」的旧提示要换成新口径。
 *
 * 词条本身由 importLanguageEntries 用 INSERT IGNORE 补齐（新 key）。
 * 已经存在的 key 交给 applyLanguageOverrides 按旧值匹配刷新。
 */
async function refreshScopeLanguageEntries(pool: Pool): Promise<void> {
  await importLanguageEntries(pool);

  await applyLanguageOverrides(pool, [
    [
      'auth.user.departmentHint',
      'zh',
      '部门只用于归档与筛选，不参与权限判定',
      '部门决定可见的数据范围：本部门及下级部门',
    ],
    [
      'auth.user.departmentHint',
      'en',
      'Departments are for grouping and filtering only, not for permissions',
      'Departments define visible data: your department and its sub-departments',
    ],
    [
      'auth.user.assignDepartmentHint',
      'zh',
      '部门只用于归档与筛选，不参与权限判定',
      '只能把账号分配到本部门及下级部门',
    ],
    [
      'auth.user.assignDepartmentHint',
      'en',
      'Departments are for grouping only, not for permissions',
      'You can only assign accounts to your department or its sub-departments',
    ],
  ]);
}

/**
 * 11) 「语言代码」的提示换了口径。
 *
 * 旧文案让用户去改 nuxt.config.ts，而现在新增语言完全不需要动配置 ——
 * 这句提示现在直接挂在字段标签的圆形问号上，点开就是它，留着旧说法
 * 等于在界面上教错方法。
 */
async function refreshLanguageCodeHint(pool: Pool): Promise<void> {
  await applyLanguageOverrides(pool, [
    [
      'auth.language.codeHint',
      'zh',
      '需与 nuxt.config.ts 的 i18n.locales.code 一致；新增语言还要在那里注册才能在界面切换',
      '小写字母开头，如 ja、ko；新增后无需改代码，右上角语言切换器立即出现，停用即消失',
    ],
    [
      'auth.language.codeHint',
      'en',
      'Must match nuxt.config.ts i18n.locales.code; register it there to enable switching',
      'Lowercase letters first, e.g. ja, ko. No code change needed: the header switcher picks it up immediately and drops it when disabled.',
    ],
  ]);
}

/**
 * 12) 顶栏品牌并入 `app.title`。
 *
 * 侧栏标题、顶栏品牌、浏览器标签页、水印现在都读同一个词条 —— 品牌名只该有
 * 一个来源，否则「语言管理」里能改的只是其中一处，改完看着没生效。
 * `layout.header.brand` 因此没有消费方了，留着的话在语言管理里就多一条
 * 「改了没反应」的词条，干脆连值一起删掉。
 */
async function dropHeaderBrandEntry(pool: Pool): Promise<void> {
  await pool.query(
    `DELETE lv FROM \`language_value\` lv
        INNER JOIN \`language_entry\` le ON le.\`id\` = lv.\`entry_id\`
      WHERE le.\`key\` = ?`,
    ['layout.header.brand'],
  );
  await pool.query('DELETE FROM `language_entry` WHERE `key` = ?', ['layout.header.brand']);
}

/** 删掉一整组词条（值 + 词条行）：页面改版后不再使用的标签不该留在语言管理里。 */
async function dropLanguageEntries(pool: Pool, keys: readonly string[]): Promise<void> {
  for (const key of keys) {
    await pool.query(
      `DELETE lv FROM \`language_value\` lv
          INNER JOIN \`language_entry\` le ON le.\`id\` = lv.\`entry_id\`
        WHERE le.\`key\` = ?`,
      [key],
    );
    await pool.query('DELETE FROM `language_entry` WHERE `key` = ?', [key]);
  }
}

/**
 * 操作日志详情改版：行内展开 → 右侧抽屉 + 报文按钮组。
 *
 * 三件事：
 *   ① 新文案（报文内容 / 复制 / 已复制 / 复制失败）入库；
 *   ② 两条改了说法的旧文案按旧值刷成新值（INSERT IGNORE 不会覆盖已存在的行列）；
 *   ③ 抽屉里不再有「响应消息 / 请求信息」两个分区标题，对应词条删掉，
 *      免得语言管理页留着一堆页面上根本找不到的键。
 */
async function syncOperationLogDrawerEntries(pool: Pool): Promise<void> {
  await importLanguageEntries(pool);

  await applyLanguageOverrides(pool, [
    ['monitor.logs.expandHint', 'zh', '点击操作时间可展开日志详情', '点击操作时间可在右侧查看详情'],
    [
      'monitor.logs.expandHint',
      'en',
      'Click the operation time to expand details',
      'Click the operation time to view details on the right',
    ],
    [
      'monitor.online.kickConfirm',
      'zh',
      '确定强制该会话下线吗？该用户的所有令牌将立即失效。',
      '确定强制该会话下线吗？该用户的所有令牌将立即失效，并会被跳转到登录页。',
    ],
    [
      'monitor.online.kickConfirm',
      'en',
      'Force this session offline? All of its tokens will be revoked immediately.',
      'Force this session offline? All of its tokens will be revoked immediately and the user will be sent back to the sign-in page.',
    ],
  ]);

  await dropLanguageEntries(pool, ['monitor.logs.response', 'monitor.logs.request']);
}

/**
 * 操作日志抽屉再次调整：报文从四块共用一个按钮组拆成「请求信息 / 响应信息」两块。
 *
 * 旧库里这两个键可能还留着上一版的「响应消息」文案，而「报文内容」已经没人用了。
 * 先删掉再按种子重新导入，保证 db 里的译文和 i18n 文件一致。
 */
async function syncSplitPayloadSectionEntries(pool: Pool): Promise<void> {
  await dropLanguageEntries(pool, [
    'monitor.logs.request',
    'monitor.logs.response',
    'monitor.logs.payload',
  ]);
  await syncLanguageSeedEntries(pool);
}

/**
 * 系统配置页：五个区块的新词条入库；「基础设置」菜单改名「系统配置」。
 * INSERT IGNORE 不覆盖老值，所以菜单标题要用 applyLanguageOverrides 按旧值刷一次。
 */
async function syncSystemConfigEntries(pool: Pool): Promise<void> {
  await syncLanguageSeedEntries(pool);
  await applyLanguageOverrides(pool, [
    ['layout.menu.systemSettings', 'zh', '基础设置', '系统配置'],
    ['layout.menu.systemSettings', 'en', 'Settings', 'System Config'],
  ]);
}

/** 系统配置新增维护模式 / 开放注册：新词条入库。 */
async function syncAccessConfigEntries(pool: Pool): Promise<void> {
  await syncLanguageSeedEntries(pool);
}

/**
 * 系统名称的真相改到「系统配置 → 网站配置」，语言管理里的 app.title 退场。
 *
 * 先同步再删：种子里已经没有这个 key，但老库可能还留着系统词条；
 * 顺序反过来的话，这次同步会把它重新插回来。
 */
async function dropAppTitleEntry(pool: Pool): Promise<void> {
  await syncLanguageSeedEntries(pool);
  await dropLanguageEntries(pool, ['app.title']);
}

/**
 * 网站配置改成点击预览图上传后，「请输入图片地址 / 预览」这些旧文案没人用了。
 * 同上：先同步新种子，再删旧键，最后按旧值刷新 logoHint 的说法。
 */
async function cleanupSiteImageLanguageEntries(pool: Pool): Promise<void> {
  await syncLanguageSeedEntries(pool);
  await dropLanguageEntries(pool, [
    'layout.systemConfig.site.logoPlaceholder',
    'layout.systemConfig.site.faviconPlaceholder',
    'layout.systemConfig.site.preview',
  ]);
  await applyLanguageOverrides(pool, [
    [
      'layout.systemConfig.site.logoHint',
      'zh',
      '填写图片 URL，预览区会实时显示',
      '侧栏、顶栏与授权页展示的站点主标识',
    ],
    [
      'layout.systemConfig.site.logoHint',
      'en',
      'Enter an image URL; the preview updates immediately',
      'Main mark shown in the sidebar, header and sign-in pages',
    ],
  ]);
}

/**
 * 系统监控 ①：结构。
 *
 * 全新库由 schema.ts 建表时就已经带上全部新列，这里用 hasColumn / hasIndex
 * 逐个补齐「已经跑过的旧库」；DDL 用 CREATE TABLE IF NOT EXISTS 所以新库重跑也无副作用。
 */
async function addMonitorSchema(pool: Pool): Promise<void> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS \`login_log\` (
      \`id\` bigint unsigned NOT NULL AUTO_INCREMENT,
      \`user_id\` int unsigned NOT NULL DEFAULT 0,
      \`username\` varchar(50) NOT NULL DEFAULT '',
      \`nickname\` varchar(50) NOT NULL DEFAULT '',
      \`behavior\` varchar(20) NOT NULL DEFAULT 'login',
      \`status\` tinyint(1) NOT NULL DEFAULT 1,
      \`message\` varchar(255) NOT NULL DEFAULT '',
      \`ip\` varchar(50) NOT NULL DEFAULT '',
      \`ip_location\` varchar(120) NOT NULL DEFAULT '',
      \`browser\` varchar(60) NOT NULL DEFAULT '',
      \`os\` varchar(60) NOT NULL DEFAULT '',
      \`useragent\` varchar(255) NOT NULL DEFAULT '',
      \`create_time\` bigint NOT NULL DEFAULT 0,
      PRIMARY KEY (\`id\`),
      KEY \`idx_user\` (\`user_id\`),
      KEY \`idx_time\` (\`create_time\`),
      KEY \`idx_behavior\` (\`behavior\`),
      KEY \`idx_status\` (\`status\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='登录日志表'`,
  );

  const operationColumns: ReadonlyArray<readonly [string, string]> = [
    ['module', "varchar(50) NOT NULL DEFAULT ''"],
    ['trace_id', "varchar(40) NOT NULL DEFAULT ''"],
    ['status', "varchar(16) NOT NULL DEFAULT 'success'"],
    ['duration', 'int unsigned NOT NULL DEFAULT 0'],
    ['error_msg', "varchar(255) NOT NULL DEFAULT ''"],
    ['request_headers', 'text'],
    ['response_headers', 'text'],
    ['response_body', 'text'],
    ['ip_location', "varchar(120) NOT NULL DEFAULT ''"],
    ['browser', "varchar(60) NOT NULL DEFAULT ''"],
    ['os', "varchar(60) NOT NULL DEFAULT ''"],
  ];
  for (const [name, definition] of operationColumns) {
    if (await hasColumn(pool, 'operation_log', name)) continue;
    await pool.query(`ALTER TABLE \`operation_log\` ADD COLUMN \`${name}\` ${definition}`);
  }
  const operationIndexes: ReadonlyArray<readonly [string, string]> = [
    ['idx_trace', 'trace_id'],
    ['idx_status', 'status'],
    ['idx_module', 'module'],
  ];
  for (const [name, column] of operationIndexes) {
    if (await hasIndex(pool, 'operation_log', name)) continue;
    await pool.query(`ALTER TABLE \`operation_log\` ADD KEY \`${name}\` (\`${column}\`)`);
  }

  const tokenColumns: ReadonlyArray<readonly [string, string]> = [
    ['session_id', "varchar(40) NOT NULL DEFAULT ''"],
    ['last_active_time', 'bigint NOT NULL DEFAULT 0'],
    ['last_refresh_time', 'bigint NOT NULL DEFAULT 0'],
    ['ip', "varchar(50) NOT NULL DEFAULT ''"],
    ['ip_location', "varchar(120) NOT NULL DEFAULT ''"],
    ['browser', "varchar(60) NOT NULL DEFAULT ''"],
    ['os', "varchar(60) NOT NULL DEFAULT ''"],
    ['useragent', "varchar(255) NOT NULL DEFAULT ''"],
  ];
  for (const [name, definition] of tokenColumns) {
    if (await hasColumn(pool, 'token', name)) continue;
    await pool.query(`ALTER TABLE \`token\` ADD COLUMN \`${name}\` ${definition}`);
  }
  const tokenIndexes: ReadonlyArray<readonly [string, string]> = [
    ['idx_session', 'session_id'],
    ['idx_active', 'last_active_time'],
  ];
  for (const [name, column] of tokenIndexes) {
    if (await hasIndex(pool, 'token', name)) continue;
    await pool.query(`ALTER TABLE \`token\` ADD KEY \`${name}\` (\`${column}\`)`);
  }

  // 旧会话没有 session_id：先按摘要给每行一个稳定值，再把 refresh 行对齐到
  // 同用户、同登录时刻的 access 行 —— 否则续期/强退会配不上对。
  await pool.query("UPDATE `token` SET `session_id` = LEFT(`token`, 32) WHERE `session_id` = ''");
  await pool.query(
    `UPDATE \`token\` r
        JOIN \`token\` a
          ON a.\`user_id\` = r.\`user_id\`
         AND a.\`create_time\` = r.\`create_time\`
         AND a.\`type\` = 'admin'
         SET r.\`session_id\` = a.\`session_id\`
       WHERE r.\`type\` = 'admin_refresh' AND r.\`session_id\` <> a.\`session_id\``,
  );
  await pool.query(
    'UPDATE `token` SET `last_active_time` = `create_time` WHERE `last_active_time` = 0',
  );
}

/**
 * 系统监控 ②：菜单。
 *
 * 「系统日志」不新建第二个日志菜单 —— 把原来的 system/log 节点（id 35）搬到新目录下，
 * 改名、改路径，权限标识保持不变，这样已有角色授权和接口验权都不用动。
 */
async function addSystemMonitorMenu(pool: Pool): Promise<void> {
  const ts = Math.floor(Date.now() / 1000);

  let dirId = await ruleIdByName(pool, 'monitor');
  if (!dirId) {
    const [inserted] = await pool.query<ResultSetHeader>(
      "INSERT INTO `permission_rule` (`pid`,`type`,`title`,`name`,`path`,`icon`,`weigh`,`status`,`create_time`,`update_time`) VALUES (0, 'menu_dir', 'layout.menu.monitor', 'monitor', '#group-monitor', 'monitor', 65, 1, ?, ?)",
      [ts, ts],
    );
    dirId = inserted.insertId;
  }
  if (!dirId) return;

  let onlineId = await ruleIdByName(pool, 'monitor/online');
  if (!onlineId) {
    const [inserted] = await pool.query<ResultSetHeader>(
      "INSERT INTO `permission_rule` (`pid`,`type`,`title`,`name`,`path`,`icon`,`weigh`,`status`,`create_time`,`update_time`) VALUES (?, 'menu', 'layout.menu.onlineUsers', 'monitor/online', '/admin/monitor/online', 'monitor', 60, 1, ?, ?)",
      [dirId, ts, ts],
    );
    onlineId = inserted.insertId;
  }

  // 只搬「还停在旧路径」的节点：管理员在菜单管理里改过的标题不会被迁移覆盖。
  await pool.query(
    "UPDATE `permission_rule` SET `pid` = ?, `path` = '/admin/monitor/logs', `title` = 'layout.menu.systemLogs', `icon` = 'file', `weigh` = 50 WHERE `name` = 'system/log' AND `path` = '/admin/system/logs'",
    [dirId],
  );

  const actions = await ensureRuleNodes(pool, 'monitor/online', [
    { name: 'monitor/online/index', title: 'auth.action.view' },
    { name: 'monitor/online/kick', title: 'monitor.online.kick' },
  ]);
  await grantRulesToRolesWith(pool, 'system/user/index', [dirId, onlineId, ...actions.values()]);
}

/**
 * 13) 系统配置补一份初始行。
 *
 * 全新库由 seedIfEmpty 整份写入；**已经跑过初始化的老库**在这里补齐 —— 之前
 * `system_config` 只有管理员实际改过的键，其余键读的时候回落到 DEFAULT_CONFIG。
 * 现在把默认值也落库，让「打开表就能看到系统有哪些配置项」对所有安装都成立。
 *
 * 只入不改（INSERT IGNORE + `uk_section_key`），管理员动过的值一条都不会被覆盖。
 * 做成一次性迁移而不是每次启动都补：`恢复默认` 删掉的行不该在重启后又被写回来，
 * 读取时回落默认值本来就够用。
 */
async function backfillSystemConfig(pool: Pool): Promise<void> {
  if (!(await tableExists(pool, 'system_config'))) return;
  await pool.query(
    'INSERT IGNORE INTO `system_config` (`section`,`config_key`,`config_value`,`update_time`) VALUES ?',
    [defaultConfigRows(Math.floor(Date.now() / 1000))],
  );
}

/**
 * 会话表新增「登录所选部门」：作为本次会话的数据范围根。
 *
 * 登录页让用户在其部门子树里选一块（技术中心 → 前端组），选中的部门必须
 * 记进会话，后续所有列表接口才能按它裁剪。老会话没有这一列时按 0 处理，
 * 由部门范围逻辑回落成「按账号所属部门」，行为与改造前一致。
 */
async function addTokenScopeDepartment(pool: Pool): Promise<void> {
  if (!(await tableExists(pool, 'token'))) return;
  if (!(await hasColumn(pool, 'token', 'scope_department_id'))) {
    await pool.query(
      "ALTER TABLE `token` ADD COLUMN `scope_department_id` int unsigned NOT NULL DEFAULT 0 COMMENT '登录所选部门，作为本次会话的数据范围根；0 = 按账号所属部门' AFTER `useragent`",
    );
  }
}

const MIGRATIONS: readonly Migration[] = [
  { name: '2026-11-15-drop-user-type', run: dropUserType },
  { name: '2026-11-15-add-user-department', run: addUserDepartment },
  { name: '2026-11-15-rename-roles', run: renameRoles },
  { name: '2026-11-15-add-department-menu', run: addDepartmentMenu },
  { name: '2026-11-15-open-operation-log', run: openOperationLog },
  { name: '2026-11-15-assign-default-role', run: assignDefaultRole },
  { name: '2026-11-15-tidy-menu-weights', run: tidyMenuWeights },
  { name: '2026-11-15-add-role-code', run: addRoleCode },
  { name: '2026-11-15-add-language-menu', run: addLanguageMenu },
  { name: '2026-11-15-import-language-entries', run: importLanguageEntries },
  { name: '2026-11-15-add-language-entry-type', run: addLanguageEntryType },
  { name: '2026-11-15-sync-language-seed-entries', run: syncLanguageSeedEntries },
  { name: '2026-11-15-refresh-scope-language-entries', run: refreshScopeLanguageEntries },
  // 语言管理页新增「同步说明 / 语言代码提示」两条文案，补进词条表后才能在这里翻译。
  { name: '2026-11-15-sync-language-tip-entries', run: syncLanguageSeedEntries },
  // 语言代码不再需要在 nuxt.config 里注册，旧提示的说法已经过时。
  { name: '2026-11-15-refresh-language-code-hint', run: refreshLanguageCodeHint },
  // 品牌名统一到 app.title，顶栏那条重复词条删掉。
  { name: '2026-11-16-drop-header-brand-entry', run: dropHeaderBrandEntry },
  // 系统监控：审计列 / 登录日志表 / 会话元数据 → 菜单与授权 → 新词条入库。
  // 顺序不能反：词条同步依赖结构迁移已建好的表，菜单节点标题也依赖词条就位。
  { name: '2026-11-16-add-monitor-schema', run: addMonitorSchema },
  { name: '2026-11-16-add-system-monitor-menu', run: addSystemMonitorMenu },
  { name: '2026-11-16-sync-monitor-language-entries', run: syncLanguageSeedEntries },
  // 个人中心改版：安全设置 / 第三方账号 / 基本信息的新文案入库，语言管理里才能改。
  { name: '2026-11-16-sync-profile-language-entries', run: syncLanguageSeedEntries },
  // 操作日志详情改为右侧抽屉 + 报文按钮组：补复制相关文案，清掉不再使用的分区标题。
  { name: '2026-11-18-sync-log-drawer-entries', run: syncOperationLogDrawerEntries },
  // 操作日志抽屉：请求 / 响应拆成两块，各自带切换按钮和复制按钮。
  { name: '2026-11-18-split-log-payload-sections', run: syncSplitPayloadSectionEntries },
  // 系统配置页：新词条 + 菜单标题「基础设置」→「系统配置」。
  { name: '2026-11-18-sync-system-config-entries', run: syncSystemConfigEntries },
  // 系统配置：维护模式 / 开放注册的开关文案与维护页词条。
  { name: '2026-11-18-sync-access-config-entries', run: syncAccessConfigEntries },
  // 品牌名统一到系统配置 site.name，语言管理里的 app.title 删除。
  { name: '2026-11-18-drop-app-title-entry', run: dropAppTitleEntry },
  // 网站配置改为图片上传，清掉旧的 URL 占位文案并刷新 LOGO 说明。
  { name: '2026-11-18-cleanup-site-image-entries', run: cleanupSiteImageLanguageEntries },
  // 邮件/存储配置上线，补词条并删除旧的占位文案。
  { name: '2026-11-19-sync-mail-storage-config-entries', run: syncMailStorageConfigEntries },
  { name: '2026-11-19-backfill-mail-storage-entries', run: backfillMailStorageConfigEntries },
  { name: '2026-11-19-sync-copyright-visible-entries', run: syncCopyrightVisibleEntries },
  // 通知公告：建表 + 菜单/按钮权限 + 词条同步。
  { name: '2026-11-19-add-notice-module', run: addNoticeModule },
  { name: '2026-11-19-sync-notice-entries', run: syncLanguageSeedEntries },
  // 补 titlePlaceholder：上面那条迁移已执行过的库需要再同步一次种子。
  { name: '2026-11-19-backfill-notice-title-placeholder', run: syncLanguageSeedEntries },
  // 顶部公告条的 prev/next 文案：同步种子即可，幂等（规避热重载旧产物漏词）。
  { name: '2026-11-19-sync-top-notice-entries', run: syncLanguageSeedEntries },
  // 系统配置新增「环境配置」「SEO 配置」两个区块：同步词条，语言管理里才能翻译。
  { name: '2026-11-20-sync-env-seo-entries', run: syncLanguageSeedEntries },
  // 公告正文升级富文本：text(64KB) 不够存 HTML，老库扩到 mediumtext。
  { name: '2026-11-20-widen-notice-content', run: widenNoticeContent },
  // 同步富文本编辑器与公告详情页的新词条。
  { name: '2026-11-20-sync-notice-detail-entries', run: syncLanguageSeedEntries },
  // 系统配置初始行落库：老库补齐默认值（只入不改），与全新安装保持一致。
  { name: '2026-11-21-backfill-system-config', run: backfillSystemConfig },
  // 用户管理新增导入 / 导出：同步抽屉、策略、预览与结果提示的新词条。
  { name: '2026-11-22-sync-user-import-entries', run: syncLanguageSeedEntries },
  // 登录所选部门记入会话：老 token 表补列，作为本次会话数据范围根。
  { name: '2026-11-22-add-token-scope-department', run: addTokenScopeDepartment },
  // 初始口令加固：补 must_change_password 列，并把仍在使用旧版默认口令的种子账号标记为必须改密。
  { name: '2026-11-22-harden-seeded-credentials', run: hardenSeededCredentials },
  // 强制改密引导用到的提示文案：同步种子，老库的语言管理里才有这几条可翻译。
  { name: '2026-11-22-sync-password-policy-entries', run: syncLanguageSeedEntries },
  // 找回密码支持「用户名或邮箱」+ 邮件配置自检按钮：同步新词条。
  { name: '2026-11-22-sync-password-reset-mail-entries', run: syncLanguageSeedEntries },
  // 公告富文本 XSS：存量正文按白名单重写（只改含危险结构的行）。
  { name: '2026-11-22-sanitize-announcement-html', run: sanitizeAnnouncementContent },
  // 公网 IP 归属地兜底文案：同步 monitor.location.public，语言管理里才能翻译。
  { name: '2026-11-23-sync-ip-location-public-entry', run: syncLanguageSeedEntries },
];

/**
 * 邮件/存储配置补成真实表单：同步新词条，并清掉不再使用的占位文案。
 */
async function syncMailStorageConfigEntries(pool: Pool): Promise<void> {
  await syncLanguageSeedEntries(pool);
  await dropLanguageEntries(pool, ['layout.systemConfig.placeholder']);
}

/**
 * 补导入邮件/存储词条。
 *
 * 上一条迁移执行时若 dev 热重载还拿着旧的种子编译产物，会只删旧键而没插入新键。
 * 这条再跑一次纯 INSERT IGNORE 的种子导入，幂等，正常部署也不会重复写入。
 */
async function backfillMailStorageConfigEntries(pool: Pool): Promise<void> {
  await syncLanguageSeedEntries(pool);
}

/** 新增「显示版权声明」开关词条：同步种子即可，幂等。 */
async function syncCopyrightVisibleEntries(pool: Pool): Promise<void> {
  await syncLanguageSeedEntries(pool);
}

/** 通知公告：建表 + 菜单/按钮权限 + 授权。DDL 与 schema.ts 保持一致。 */
async function addNoticeModule(pool: Pool): Promise<void> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS \`announcement\` (
      \`id\` bigint unsigned NOT NULL AUTO_INCREMENT,
      \`title\` varchar(200) NOT NULL DEFAULT '' COMMENT '公告标题',
      \`category\` varchar(20) NOT NULL DEFAULT 'notice' COMMENT '分类：notice 通知 / bulletin 公告 / activity 活动',
      \`content\` mediumtext COMMENT '正文内容（富文本 HTML）',
      \`publish_time\` bigint NOT NULL DEFAULT 0 COMMENT '定时发布时间（秒），0 或过去时间 = 立即发布',
      \`is_top\` tinyint(1) NOT NULL DEFAULT 0 COMMENT '1 置顶',
      \`notify_method\` varchar(20) NOT NULL DEFAULT 'internal' COMMENT '通知方式：internal 站内信 / email 邮件 / sms 短信',
      \`notify_scope\` varchar(20) NOT NULL DEFAULT 'all' COMMENT '通知范围：all 全部 / department 指定部门 / role 指定角色',
      \`scope_ids\` varchar(500) NOT NULL DEFAULT '' COMMENT '范围目标 id，逗号分隔；all 时为空',
      \`status\` tinyint(1) NOT NULL DEFAULT 1 COMMENT '1 启用 / 0 停用',
      \`creator_id\` int unsigned NOT NULL DEFAULT 0 COMMENT '发布人 id',
      \`creator_name\` varchar(50) NOT NULL DEFAULT '' COMMENT '发布人名称',
      \`create_time\` bigint NOT NULL DEFAULT 0,
      \`update_time\` bigint NOT NULL DEFAULT 0,
      PRIMARY KEY (\`id\`),
      KEY \`idx_publish_time\` (\`publish_time\`),
      KEY \`idx_category\` (\`category\`),
      KEY \`idx_status\` (\`status\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='通知公告表'`,
  );

  const ts = Math.floor(Date.now() / 1000);
  const systemDir = await ruleIdByName(pool, 'system');
  if (!systemDir) return;
  const existing = await ruleIdByName(pool, 'system/notice');
  let menuId = existing;
  if (!menuId) {
    const [inserted] = await pool.query<ResultSetHeader>(
      "INSERT INTO `permission_rule` (`pid`,`type`,`title`,`name`,`path`,`icon`,`weigh`,`status`,`create_time`,`update_time`) VALUES (?, 'menu', 'layout.menu.notices', 'system/notice', '/admin/system/notices', 'notice', 55, 1, ?, ?)",
      [systemDir, ts, ts],
    );
    menuId = inserted.insertId;
  }
  if (!menuId) return;
  const actions = await ensureRuleNodes(pool, 'system/notice', [
    { name: 'system/notice/index', title: 'auth.action.view' },
    { name: 'system/notice/add', title: 'auth.action.add' },
    { name: 'system/notice/edit', title: 'auth.action.edit' },
    { name: 'system/notice/del', title: 'auth.action.delete' },
  ]);
  // 以「能看用户列表」为锚点：能管人的角色，自然也该能维护公告。
  await grantRulesToRolesWith(pool, 'system/user/index', [menuId, ...actions.values()]);
}

/**
 * 初始口令加固。
 *
 * 解决的是**存量实例**的问题：新版本已经不再写死口令，但升级上来的库里
 * `super / 123456` 还躺着，且没有任何机制要求改掉。两步：
 *
 *   ① 补 `must_change_password` 列（新库由 schema.ts 直接带，老库在这里补）；
 *   ② 把「口令不是 scrypt 哈希」或「仍然等于旧版默认口令 123456」的种子账号
 *      标记为必须改密。口令是哈希，没法反推强弱，只能拿已知的默认值逐个试 ——
 *      11 个账号 × 1 个候选 ≈ 0.7s，一次性迁移可以接受。
 *
 * 只标记、不重置：改别人的密码属于数据变更，交给人（登录后改密）来做。
 */
/**
 * 存量公告正文按白名单重写一遍。
 *
 * 为什么要动历史数据：净化只在「写入时」生效，库里已经躺着的 `<svg/onload>` 不会因为
 * 代码改了而消失 —— 打开那条公告的人照样中招。审计时提交的载荷已经手工删掉，
 * 但别人的库不一定。
 *
 * 判定用 `richHtmlLooksDangerous`（净化前后字符串是否相同）：相同说明本来就干净，
 * 一条 UPDATE 都不发；不同才回写。上线后第一次启动会把受影响的公告数打到日志里，
 * 运维据此确认「有没有被打过」。
 */
async function sanitizeAnnouncementContent(pool: Pool): Promise<void> {
  if (!(await tableExists(pool, 'announcement'))) return;

  interface NoticeRow extends RowDataPacket {
    id: number;
    content: string | null;
  }

  const [rows] = await pool.query<NoticeRow[]>('SELECT `id`,`content` FROM `announcement`');
  const repaired: number[] = [];
  for (const row of rows) {
    const raw = row.content ?? '';
    if (!richHtmlLooksDangerous(raw)) continue;
    await pool.query('UPDATE `announcement` SET `content` = ? WHERE `id` = ?', [
      sanitizeRichHtml(raw),
      row.id,
    ]);
    repaired.push(Number(row.id));
  }

  if (repaired.length > 0) {
    console.warn(
      `[security] 以下公告正文含会被浏览器执行的标记，已按白名单重写：#${repaired.join(', #')}`,
    );
  }
}

async function hardenSeededCredentials(pool: Pool): Promise<void> {
  if (!(await hasColumn(pool, 'user', 'must_change_password'))) {
    await pool.query(
      "ALTER TABLE `user` ADD COLUMN `must_change_password` tinyint(1) NOT NULL DEFAULT 0 COMMENT '1 = 首次登录必须改密（初始/重置口令）'",
    );
  }

  // 旧版种子写死的唯一口令。不要往这里加「猜测」：这张表只该包含**确定发布过**的值。
  const legacyDefault = '123456';
  const usernames = [...new Set([...SEED_ADMINS, ...SEED_USERS].map((item) => item.username))];

  interface CredentialRow extends RowDataPacket {
    id: number;
    username: string;
    password: string;
    must_change_password: number;
  }

  const [rows] = await pool.query<CredentialRow[]>(
    'SELECT `id`,`username`,`password`,`must_change_password` FROM `user` WHERE `username` IN (?)',
    [usernames],
  );

  const flagged: string[] = [];
  for (const row of rows) {
    if (Number(row.must_change_password) === 1) continue;

    const stored = String(row.password ?? '');
    // 非 scrypt 前缀 = 早期明文口令（见 verifyPassword 的兼容分支），必须换掉。
    const weak = !stored.startsWith('scrypt$') || (await verifyPassword(legacyDefault, stored));
    if (!weak) continue;

    await pool.query('UPDATE `user` SET `must_change_password` = 1 WHERE `id` = ?', [row.id]);
    flagged.push(row.username);
  }

  if (flagged.length > 0) {
    console.warn(
      `[security] 以下种子账号仍在使用旧版默认口令，已标记为「首次登录必须改密」：${flagged.join(', ')}`,
    );
  }
}

/**
 * 跑完所有未执行的迁移。失败直接抛，让启动失败 —— 半迁移的库比启动不了更难查。
 * 记录用 INSERT IGNORE：多进程同时启动时只有一个能写进去，另一个视为已完成。
 */
export async function runMigrations(pool: Pool): Promise<MigrationReport> {
  const [rows] = await pool.query<NameRow[]>('SELECT `name` FROM `schema_migration`');
  const done = new Set(rows.map((row) => row.name));
  const applied: string[] = [];

  for (const migration of MIGRATIONS) {
    if (done.has(migration.name)) continue;
    await migration.run(pool);
    await pool.query('INSERT IGNORE INTO `schema_migration` (`name`,`applied_time`) VALUES (?,?)', [
      migration.name,
      Math.floor(Date.now() / 1000),
    ]);
    applied.push(migration.name);
  }

  if (applied.length > 0) {
    console.info(`[db] 已执行一次性迁移：${applied.join(', ')}`);
  }

  return { applied };
}
