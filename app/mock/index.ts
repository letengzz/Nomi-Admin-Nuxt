/**
 * 演示站的接口实现（内存版）。
 *
 * 静态站（GitHub Pages）上既没有 Nitro 也没有数据库，`/api/**` 全部 404。
 * 这里在**请求器一层**把 URL 拦下来，返回与真实后端同形状的 `{ code, msg, data }`：
 *   · 页面代码一行都不用改，它们看到的仍然是 `apiFetch` 包装过的 data；
 *   · 新增/编辑/删除改的是 `demoState` 里的数组，刷新页面即复原；
 *   · 分页、筛选、排序、`published` 这类派生字段都在这里算，和真机行为尽量一致。
 *
 * 没实现的接口会返回 `code: 404`，请求器会把它抛成 `ApiRequestError` 并带上
 * 「演示环境未实现该接口」—— 看到这句就说明该补一条路由，而不是让人对着空白页猜。
 */
import type {
  AdminInfo,
  AdminLogItem,
  AdminRule,
  ApiEnvelope,
  DepartmentItem,
  InitPayload,
  NoticeItem,
  RoleItem,
  UserItem,
  UserListResult,
} from '../types/permission';
import type { LanguageEntryResult, LanguageOverview } from '../types/language';
import type {
  ListResult,
  LoginLogItem,
  OnlineListResult,
  OnlineSession,
  OperationLogItem,
} from '../types/monitor';
import type { SelfProfile } from '../services/profile';
import type { SystemConfig } from '../services/system-config';
import {
  ago,
  buildAuthNode,
  buildConfig,
  buildMenuTree,
  buildOperationDetail,
  buildProfile,
  buildRuleTree,
  currentUser,
  demoState,
  departmentSubtree,
  now,
} from './data';

type Query = Record<string, unknown>;
type Body = Record<string, unknown>;

interface Ctx {
  path: string;
  params: Record<string, string>;
  query: Query;
  body: Body;
}

type Handler = (ctx: Ctx) => ApiEnvelope<unknown>;

interface Route {
  method: 'GET' | 'POST';
  /** `:id` 占位，按顺序匹配到的值塞进 ctx.params */
  path: string;
  handler: Handler;
}

/** 演示环境里所有上传都返回这张 1×1 的透明图，避免静态站上出现破图。 */
const DEMO_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

const ok = <T>(data: T): ApiEnvelope<T> => ({ code: 200, msg: 'ok', data });
const fail = (msg: string, code = 400): ApiEnvelope<never> => ({ code, msg, data: undefined as never });

/**
 * 演示站是**只读**的。
 *
 * 点开演示站的人只是来看界面的。任何一次「保存」如果真在内存里生效，他会以为
 * 数据被改了，而刷新之后又全回来 —— 那比直接拒绝更容易误解，所以写操作一律
 * 回一句「演示环境，不允许操作」。页面本来就在 catch 里弹 error.message，
 * 不需要每个页面各写一遍提示逻辑。
 *
 * 放行的只有「进得来、待得住」必需的几个写接口：登录、退出、换发 token。
 * 其余写处理器仍留在下面的路由表里 —— 它们与真实接口一一对应，将来想放开
 * 某个操作（例如允许体验「新增用户」），往这个集合里加一条就行。
 */
const DEMO_WRITE_ALLOWED = new Set([
  'POST /api/auth/login',
  'POST /api/admin/login',
  'POST /api/admin/logout',
  'POST /api/admin/refresh-token',
]);

/**
 * 只读提示的语言跟 `<html lang>` 走：mock 不在组件上下文里，拿不到
 * `useI18n()` 的 composer；而 @nuxtjs/i18n 在服务端渲染和切换语言时都会写这个属性。
 */
function demoReadonlyMessage(): string {
  const lang = import.meta.client ? document.documentElement.lang : '';
  return lang.toLowerCase().startsWith('en')
    ? 'Demo environment: data is read-only.'
    : '演示环境，不允许操作';
}

// --- 入参取值 --------------------------------------------------------------

function str(query: Query, key: string): string {
  const value = query[key];
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
}

function num(query: Query, key: string, fallback: number): number {
  const value = Number(query[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function bodyStr(body: Body, key: string): string {
  const value = body[key];
  return typeof value === 'string' ? value : '';
}

function bodyNum(body: Body, key: string): number {
  const value = Number(body[key]);
  return Number.isFinite(value) ? value : 0;
}

function bodyList(body: Body, key: string): number[] {
  const value = body[key];
  if (!Array.isArray(value)) return [];
  return value.map((item) => Number(item)).filter((item) => Number.isFinite(item));
}

function paginate<T>(list: readonly T[], page: number, limit: number): { rows: T[]; page: number; limit: number } {
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const start = (page - 1) * safeLimit;
  return { rows: list.slice(start, start + safeLimit), page, limit: safeLimit };
}

// --- 派生数据 --------------------------------------------------------------

/** 当前登录人可见的规则 id（超管 = 全部；其余按角色并集）。 */
function grantedRules(): AdminRule[] {
  const user = currentUser();
  if (user?.isSuper) return demoState.rules;
  const ids = new Set<number>();
  for (const role of user?.roles ?? []) {
    const found = demoState.roles.find((item) => item.id === role.id);
    for (const id of found?.rules ?? []) ids.add(id);
  }
  return demoState.rules.filter((rule) => ids.has(rule.id));
}

function adminInfo(): AdminInfo {
  const user = currentUser();
  const rules = grantedRules();
  return {
    id: user?.id ?? 1,
    username: user?.username ?? 'super',
    nickname: user?.nickname ?? '超级管理员',
    avatar: user?.avatar ?? '',
    email: user?.email ?? '',
    mobile: user?.mobile ?? '',
    motto: user?.motto ?? '',
    status: user?.status ?? 'enable',
    lastLoginTime: user?.lastLoginTime ?? 0,
    lastLoginIp: user?.lastLoginIp ?? '',
    super: Boolean(user?.isSuper),
    // 演示站不模拟「初始口令未改」：否则一点登录就被送去改密页。
    mustChangePassword: false,
    departmentId: user?.departmentId ?? 0,
    rules: rules.map((rule) => String(rule.id)),
    roles: (user?.roles ?? []).map((role) => ({ id: role.id, name: role.name })),
  };
}

function initPayload(): InitPayload {
  const rules = grantedRules();
  return {
    adminInfo: adminInfo(),
    menus: buildMenuTree(rules),
    authNode: buildAuthNode(rules),
    authNames: rules.map((rule) => rule.name),
  };
}

/** 用户列表里 `self` 跟着「谁登录了」走，登录页换账号后列表标记才对得上。 */
function markSelf(users: readonly UserItem[]): UserItem[] {
  const me = currentUser();
  return users.map((user) => ({ ...user, self: user.id === me?.id, operable: user.id !== me?.id }));
}

function sortedNotices(): NoticeItem[] {
  return [...demoState.notices].sort(
    (a, b) => b.isTop - a.isTop || b.createTime - a.createTime || b.id - a.id,
  );
}

function visibleNotices(): NoticeItem[] {
  const ts = now();
  return sortedNotices().filter(
    (item) => item.status === 1 && (item.publishTime === 0 || item.publishTime <= ts),
  );
}

/** 点分 key 展开成 vue-i18n 需要的嵌套结构。 */
function nestMessages(flat: ReadonlyArray<[string, string]>): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const [key, value] of flat) {
    const parts = key.split('.');
    let cursor = root;
    for (const part of parts.slice(0, -1)) {
      const next = cursor[part];
      if (!next || typeof next !== 'object') cursor[part] = {};
      cursor = cursor[part] as Record<string, unknown>;
    }
    const last = parts[parts.length - 1];
    if (last) cursor[last] = value;
  }
  return root;
}

function languageOverview(): LanguageOverview {
  const modules = [...new Set(demoState.entries.map((entry) => entry.module))];
  return {
    languages: demoState.languages,
    modules,
    total: demoState.entries.length,
    entryCounts: {
      system: demoState.entries.filter((entry) => entry.type === 'system').length,
      custom: demoState.entries.filter((entry) => entry.type === 'custom').length,
    },
  };
}

function deleteById<T extends { id: number }>(list: T[], id: number): boolean {
  const index = list.findIndex((item) => item.id === id);
  if (index < 0) return false;
  list.splice(index, 1);
  return true;
}

/**
 * 登录：演示环境不校验密码，任何密码都能进 —— 点开演示站的人不该先猜密码。
 * 登录名 / 手机号 / 邮箱都能匹配；认不出来时退回超管，保证「随便填一个也能看到完整界面」。
 */
function loginResponse(body: Body): ApiEnvelope<unknown> {
  const identifier = bodyStr(body, 'userName').trim().toLowerCase();
  const user =
    demoState.users.find(
      (item) =>
        item.username.toLowerCase() === identifier ||
        (Boolean(item.mobile) && item.mobile.toLowerCase() === identifier) ||
        (Boolean(item.email) && item.email.toLowerCase() === identifier),
    ) ?? demoState.users[0];
  if (!user) return fail('演示数据缺失');
  demoState.currentUsername = user.username;
  user.lastLoginTime = now();
  demoState.profile = buildProfile(user);
  return ok({
    token: 'demo-token',
    refreshToken: 'demo-refresh-token',
    expireTime: now() + 7200,
    refreshExpireTime: now() + 7 * 86_400,
    adminInfo: adminInfo(),
  });
}

// --- 路由表 ----------------------------------------------------------------

const routes: Route[] = [
  // 身份
  { method: 'POST', path: '/api/auth/login', handler: ({ body }) => loginResponse(body) },
  { method: 'POST', path: '/api/admin/login', handler: ({ body }) => loginResponse(body) },
  {
    method: 'POST',
    path: '/api/admin/logout',
    handler: () => {
      demoState.currentUsername = '';
      return ok(true);
    },
  },
  {
    method: 'POST',
    path: '/api/admin/refresh-token',
    handler: () => ok({ token: 'demo-token', refreshToken: 'demo-refresh-token' }),
  },
  { method: 'GET', path: '/api/admin/init', handler: () => ok(initPayload()) },
  {
    method: 'GET',
    path: '/api/admin/session/ping',
    handler: () => ok({ userId: currentUser()?.id ?? 1, serverTime: now() }),
  },

  // 公开接口（登录页 / 注册页 / 忘记密码）
  { method: 'GET', path: '/api/auth/login-config', handler: () => ok(demoState.config.login) },
  {
    method: 'GET',
    path: '/api/auth/departments',
    handler: () =>
      ok({
        list: demoState.departments.map(({ id, pid, name }) => ({ id, pid, name })),
      }),
  },
  {
    method: 'POST',
    path: '/api/auth/register',
    handler: ({ body }) => {
      const userName = bodyStr(body, 'userName') || 'demo';
      return ok({ userId: String(Date.now()), userName });
    },
  },
  {
    method: 'POST',
    path: '/api/auth/password-code',
    handler: ({ body }) => {
      // 与真实接口同口径：登录名 / 邮箱都能找人，没绑邮箱或未绑定用户要明说。
      const account = bodyStr(body, 'account').trim().toLowerCase();
      const isEmail = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(account);
      const user = demoState.users.find(
        (item) =>
          item.username.toLowerCase() === account ||
          (Boolean(item.email) && item.email.toLowerCase() === account),
      );
      if (!user) {
        return fail(
          isEmail ? '该邮箱未绑定用户，请检查后重试' : '该账号不存在，请检查后重试',
          isEmail ? 441 : 404,
        );
      }
      if (!user.email) {
        return fail('该账号未绑定邮箱，无法发送验证码，请联系管理员', 440);
      }
      return ok({ expiresIn: 300, cooldown: 60, delivery: 'email' });
    },
  },
  {
    method: 'POST',
    path: '/api/auth/password-reset',
    handler: ({ body }) => ok({ userName: bodyStr(body, 'account') || 'super' }),
  },

  // 站点配置 / 运行期语言
  {
    method: 'GET',
    path: '/api/site',
    handler: () => {
      const { site, environment, seo } = demoState.config;
      return ok({ ...site, environment: { ...environment }, seo: { ...seo } });
    },
  },
  {
    method: 'GET',
    path: '/api/i18n/locales',
    handler: () => {
      const enabled = demoState.languages.filter((item) => item.status === 1);
      return ok({
        defaultLocale: enabled.find((item) => item.isDefault)?.code ?? 'zh',
        locales: enabled
          .slice()
          .sort((a, b) => b.weigh - a.weigh)
          .map((item) => ({
            code: item.code,
            name: item.name,
            nativeName: item.nativeName,
            weigh: item.weigh,
            isDefault: item.isDefault,
          })),
      });
    },
  },
  {
    method: 'GET',
    path: '/api/i18n/messages',
    handler: () => {
      const enabled = demoState.languages.filter((item) => item.status === 1);
      const messages: Record<string, Record<string, unknown>> = {};
      for (const language of enabled) {
        messages[language.code] = nestMessages(
          demoState.entries.map((entry) => [entry.key, entry.values[language.code] ?? '']),
        );
      }
      return ok({ messages });
    },
  },

  // 账号
  {
    method: 'GET',
    path: '/api/admin/users/list',
    handler: ({ query }): ApiEnvelope<UserListResult> => {
      const keyword = str(query, 'keyword').trim().toLowerCase();
      const status = str(query, 'status');
      const gender = str(query, 'gender');
      const departmentId = num(query, 'departmentId', 0);
      const roleId = num(query, 'roleId', 0);
      const excludeRoleId = num(query, 'excludeRoleId', 0);
      const excludeSelf = query.excludeSelf === true || query.excludeSelf === 'true';

      let list = markSelf(demoState.users);
      if (departmentId) {
        const scope = departmentSubtree(departmentId);
        list = list.filter((user) => scope.has(user.departmentId));
      }
      if (keyword) {
        list = list.filter((user) =>
          [user.username, user.nickname, user.email, user.mobile].some((value) =>
            value.toLowerCase().includes(keyword),
          ),
        );
      }
      if (status) list = list.filter((user) => user.status === status);
      if (gender) list = list.filter((user) => user.gender === gender);
      if (roleId) list = list.filter((user) => user.roles.some((role) => role.id === roleId));
      if (excludeRoleId) {
        list = list.filter((user) => !user.roles.some((role) => role.id === excludeRoleId));
      }
      if (excludeSelf) {
        const me = currentUser();
        list = list.filter((user) => user.id !== me?.id);
      }

      const { rows, page, limit } = paginate(list, num(query, 'page', 1), num(query, 'limit', 10));
      return ok({ list: rows, total: list.length, allTotal: demoState.users.length, page, limit });
    },
  },
  {
    method: 'POST',
    path: '/api/admin/users/add',
    handler: ({ body }) => {
      const id = demoState.seq.user++;
      const roleIds = bodyList(body, 'roles');
      const departmentId = bodyNum(body, 'departmentId');
      const department = demoState.departments.find((item) => item.id === departmentId);
      demoState.users.push({
        id,
        username: bodyStr(body, 'username') || `demo${id}`,
        departmentId,
        departmentName: department?.name ?? '未分配',
        nickname: bodyStr(body, 'nickname') || `演示账号${id}`,
        avatar: '',
        email: bodyStr(body, 'email'),
        mobile: bodyStr(body, 'mobile'),
        motto: bodyStr(body, 'motto'),
        gender: bodyStr(body, 'gender') || 'unknown',
        status: bodyStr(body, 'status') || 'enable',
        loginFailure: 0,
        lastLoginTime: 0,
        lastLoginIp: '',
        createTime: now(),
        roles: roleIds.map((roleId) => ({
          id: roleId,
          name: demoState.roles.find((role) => role.id === roleId)?.name ?? '普通用户',
        })),
        isSuper: roleIds.includes(1),
        operable: true,
        self: false,
      });
      refreshRoleCounts();
      return ok({ id });
    },
  },
  {
    method: 'POST',
    path: '/api/admin/users/edit',
    handler: ({ body }) => {
      const id = bodyNum(body, 'id');
      const user = demoState.users.find((item) => item.id === id);
      if (!user) return fail('账号不存在');
      const departmentId = bodyNum(body, 'departmentId');
      const roleIds = bodyList(body, 'roles');
      user.username = bodyStr(body, 'username') || user.username;
      user.nickname = bodyStr(body, 'nickname') || user.nickname;
      user.email = bodyStr(body, 'email');
      user.mobile = bodyStr(body, 'mobile');
      user.motto = bodyStr(body, 'motto');
      user.gender = bodyStr(body, 'gender') || user.gender;
      user.status = bodyStr(body, 'status') || user.status;
      user.departmentId = departmentId;
      user.departmentName =
        demoState.departments.find((item) => item.id === departmentId)?.name ?? '未分配';
      if (roleIds.length > 0) {
        user.roles = roleIds.map((roleId) => ({
          id: roleId,
          name: demoState.roles.find((role) => role.id === roleId)?.name ?? '普通用户',
        }));
        user.isSuper = roleIds.includes(1);
      }
      refreshRoleCounts();
      return ok({ id });
    },
  },
  {
    method: 'POST',
    path: '/api/admin/users/del',
    handler: ({ body }) => {
      const ids = bodyList(body, 'ids');
      const before = demoState.users.length;
      demoState.users = demoState.users.filter((user) => !ids.includes(user.id));
      refreshRoleCounts();
      return ok({ deleted: before - demoState.users.length });
    },
  },
  {
    method: 'POST',
    path: '/api/admin/users/status',
    handler: ({ body }) => {
      const ids = bodyList(body, 'ids');
      const status = bodyStr(body, 'status') === 'disable' ? 'disable' : 'enable';
      let updated = 0;
      for (const user of demoState.users) {
        if (!ids.includes(user.id)) continue;
        user.status = status;
        updated += 1;
      }
      return ok({ updated });
    },
  },
  {
    method: 'POST',
    path: '/api/admin/users/reset-password',
    handler: ({ body }) => ok({ id: bodyNum(body, 'id') }),
  },
  // 导入 / 导出在静态站上没有意义：拉不到库也写不进去，给一句人话比 404 好。
  {
    method: 'GET',
    path: '/api/admin/users/export',
    handler: () => fail('演示环境不支持导出，请部署后再使用'),
  },
  {
    method: 'GET',
    path: '/api/admin/users/import-template',
    handler: () => fail('演示环境不支持下载导入模板，请部署后再使用'),
  },
  {
    method: 'POST',
    path: '/api/admin/users/import',
    handler: () => fail('演示环境不支持导入账号，请部署后再使用'),
  },

  // 角色
  {
    method: 'GET',
    path: '/api/admin/roles/list',
    handler: () => {
      refreshRoleCounts();
      return ok({ list: demoState.roles, total: demoState.roles.length, super: true });
    },
  },
  {
    method: 'POST',
    path: '/api/admin/roles/add',
    handler: ({ body }) => {
      const id = demoState.seq.role++;
      const role: RoleItem = {
        id,
        pid: bodyNum(body, 'pid'),
        name: bodyStr(body, 'name') || `演示角色${id}`,
        code: bodyStr(body, 'code') || `demo_${id}`,
        rules: bodyList(body, 'rules'),
        isSuper: false,
        status: bodyNum(body, 'status') || 1,
        memberCount: 0,
        assignable: true,
        createTime: now(),
        updateTime: now(),
      };
      demoState.roles.push(role);
      return ok({ id });
    },
  },
  {
    method: 'POST',
    path: '/api/admin/roles/edit',
    handler: ({ body }) => {
      const id = bodyNum(body, 'id');
      const role = demoState.roles.find((item) => item.id === id);
      if (!role) return fail('角色不存在');
      role.name = bodyStr(body, 'name') || role.name;
      role.code = bodyStr(body, 'code') || role.code;
      role.pid = bodyNum(body, 'pid');
      role.status = bodyNum(body, 'status') || role.status;
      role.rules = bodyList(body, 'rules');
      role.updateTime = now();
      return ok({ id });
    },
  },
  {
    method: 'POST',
    path: '/api/admin/roles/del',
    handler: ({ body }) => {
      const id = bodyNum(body, 'id');
      if (!deleteById(demoState.roles, id)) return fail('角色不存在');
      return ok({ id });
    },
  },
  {
    method: 'POST',
    path: '/api/admin/roles/users',
    handler: ({ body }) => {
      const roleId = bodyNum(body, 'id');
      const userIds = bodyList(body, 'userIds');
      const action = bodyStr(body, 'action');
      const role = demoState.roles.find((item) => item.id === roleId);
      if (!role) return fail('角色不存在');
      let affected = 0;
      for (const user of demoState.users) {
        if (!userIds.includes(user.id)) continue;
        const joined = user.roles.some((item) => item.id === roleId);
        if (action === 'add' && !joined) {
          user.roles.push({ id: role.id, name: role.name });
          affected += 1;
        }
        if (action === 'remove' && joined) {
          user.roles = user.roles.filter((item) => item.id !== roleId);
          affected += 1;
        }
      }
      refreshRoleCounts();
      return ok({ affected });
    },
  },

  // 权限节点
  {
    method: 'GET',
    path: '/api/admin/rules/list',
    handler: () => {
      const rules = demoState.rules;
      return ok({
        list: rules,
        tree: buildRuleTree(rules),
        total: rules.length,
        super: Boolean(currentUser()?.isSuper),
        enabled: rules.filter((rule) => rule.status === 1),
      });
    },
  },
  {
    method: 'POST',
    path: '/api/admin/rules/add',
    handler: ({ body }) => {
      const id = demoState.seq.rule++;
      demoState.rules.push({
        id,
        pid: bodyNum(body, 'pid'),
        name: bodyStr(body, 'name') || `demo/rule${id}`,
        title: bodyStr(body, 'title') || '演示节点',
        path: bodyStr(body, 'path'),
        icon: bodyStr(body, 'icon'),
        type: (bodyStr(body, 'type') || 'menu') as AdminRule['type'],
        keepalive: bodyNum(body, 'keepalive'),
        menu_type: bodyStr(body, 'menu_type') || 'menu',
        url: bodyStr(body, 'url'),
        component: bodyStr(body, 'component'),
        extend: '',
        remark: bodyStr(body, 'remark'),
        weigh: bodyNum(body, 'weigh'),
        status: bodyNum(body, 'status') || 1,
        children: [],
      });
      return ok({ id });
    },
  },
  {
    method: 'POST',
    path: '/api/admin/rules/edit',
    handler: ({ body }) => {
      const id = bodyNum(body, 'id');
      const rule = demoState.rules.find((item) => item.id === id);
      if (!rule) return fail('节点不存在');
      rule.pid = bodyNum(body, 'pid');
      rule.name = bodyStr(body, 'name') || rule.name;
      rule.title = bodyStr(body, 'title') || rule.title;
      rule.path = bodyStr(body, 'path');
      rule.icon = bodyStr(body, 'icon');
      rule.type = (bodyStr(body, 'type') || rule.type) as AdminRule['type'];
      rule.weigh = bodyNum(body, 'weigh');
      rule.status = bodyNum(body, 'status') || rule.status;
      rule.remark = bodyStr(body, 'remark');
      return ok({ id });
    },
  },
  {
    method: 'POST',
    path: '/api/admin/rules/del',
    handler: ({ body }) => {
      const id = bodyNum(body, 'id');
      if (!deleteById(demoState.rules, id)) return fail('节点不存在');
      // 子节点跟着删，避免菜单里留下一批孤儿
      demoState.rules = demoState.rules.filter((rule) => rule.pid !== id);
      return ok({ id });
    },
  },
  {
    method: 'POST',
    path: '/api/admin/rules/sortable',
    handler: ({ body }) => {
      const weights = body.weights;
      let updated = 0;
      if (Array.isArray(weights)) {
        for (const item of weights) {
          const row = item as { id?: number; weigh?: number };
          const rule = demoState.rules.find((entry) => entry.id === Number(row.id));
          if (!rule) continue;
          rule.weigh = Number(row.weigh ?? rule.weigh);
          updated += 1;
        }
      }
      return ok({ updated });
    },
  },

  // 部门
  {
    method: 'GET',
    path: '/api/admin/departments/list',
    handler: () => {
      refreshDepartmentCounts();
      return ok({ list: demoState.departments, total: demoState.departments.length });
    },
  },
  {
    method: 'POST',
    path: '/api/admin/departments/add',
    handler: ({ body }) => {
      const id = demoState.seq.department++;
      const dept: DepartmentItem = {
        id,
        pid: bodyNum(body, 'pid'),
        name: bodyStr(body, 'name') || `新部门${id}`,
        leader: bodyStr(body, 'leader'),
        phone: bodyStr(body, 'phone'),
        weigh: bodyNum(body, 'weigh'),
        status: bodyNum(body, 'status') || 1,
        userCount: 0,
        createTime: now(),
        updateTime: now(),
      };
      demoState.departments.push(dept);
      return ok({ id });
    },
  },
  {
    method: 'POST',
    path: '/api/admin/departments/edit',
    handler: ({ body }) => {
      const id = bodyNum(body, 'id');
      const dept = demoState.departments.find((item) => item.id === id);
      if (!dept) return fail('部门不存在');
      dept.pid = bodyNum(body, 'pid');
      dept.name = bodyStr(body, 'name') || dept.name;
      dept.leader = bodyStr(body, 'leader');
      dept.phone = bodyStr(body, 'phone');
      dept.weigh = bodyNum(body, 'weigh');
      dept.status = bodyNum(body, 'status') || dept.status;
      dept.updateTime = now();
      return ok({ id });
    },
  },
  {
    method: 'POST',
    path: '/api/admin/departments/del',
    handler: ({ body }) => {
      const id = bodyNum(body, 'id');
      if (!deleteById(demoState.departments, id)) return fail('部门不存在');
      return ok({ id });
    },
  },

  // 通知公告
  {
    method: 'GET',
    path: '/api/admin/notices/list',
    handler: ({ query }) => {
      const keyword = str(query, 'keyword').trim().toLowerCase();
      const category = str(query, 'category');
      const status = str(query, 'status');
      const published = str(query, 'published');

      let list = sortedNotices();
      if (keyword) list = list.filter((item) => item.title.toLowerCase().includes(keyword));
      if (category) list = list.filter((item) => item.category === category);
      if (status) list = list.filter((item) => String(item.status) === status);
      if (published === 'true') list = list.filter((item) => item.published);
      if (published === 'false') list = list.filter((item) => !item.published);
      return ok({ list, total: list.length });
    },
  },
  {
    method: 'GET',
    path: '/api/admin/notices/:id',
    handler: ({ params }) => {
      const id = Number(params.id);
      const notice = demoState.notices.find((item) => item.id === id);
      return notice ? ok(notice) : fail('公告不存在', 404);
    },
  },
  {
    method: 'POST',
    path: '/api/admin/notices/add',
    handler: ({ body }) => {
      const id = demoState.seq.notice++;
      const publishTime = bodyNum(body, 'publishTime');
      demoState.notices.push({
        id,
        title: bodyStr(body, 'title') || '未命名公告',
        category: (bodyStr(body, 'category') || 'notice') as NoticeItem['category'],
        content: bodyStr(body, 'content'),
        publishTime,
        isTop: bodyNum(body, 'isTop'),
        notifyMethod: (bodyStr(body, 'notifyMethod') || 'internal') as NoticeItem['notifyMethod'],
        notifyScope: (bodyStr(body, 'notifyScope') || 'all') as NoticeItem['notifyScope'],
        scopeIds: bodyList(body, 'scopeIds'),
        status: bodyNum(body, 'status') || 1,
        creatorId: currentUser()?.id ?? 1,
        creatorName: currentUser()?.nickname ?? '超级管理员',
        createTime: now(),
        updateTime: now(),
        published: publishTime === 0 || publishTime <= now(),
      });
      return ok({ id });
    },
  },
  {
    method: 'POST',
    path: '/api/admin/notices/edit',
    handler: ({ body }) => {
      const id = bodyNum(body, 'id');
      const notice = demoState.notices.find((item) => item.id === id);
      if (!notice) return fail('公告不存在');
      const publishTime = bodyNum(body, 'publishTime');
      notice.title = bodyStr(body, 'title') || notice.title;
      notice.category = (bodyStr(body, 'category') || notice.category) as NoticeItem['category'];
      notice.content = bodyStr(body, 'content');
      notice.publishTime = publishTime;
      notice.isTop = bodyNum(body, 'isTop');
      notice.notifyMethod = (bodyStr(body, 'notifyMethod') || notice.notifyMethod) as NoticeItem['notifyMethod'];
      notice.notifyScope = (bodyStr(body, 'notifyScope') || notice.notifyScope) as NoticeItem['notifyScope'];
      notice.scopeIds = bodyList(body, 'scopeIds');
      notice.status = bodyNum(body, 'status') || notice.status;
      notice.updateTime = now();
      notice.published = publishTime === 0 || publishTime <= now();
      return ok({ id });
    },
  },
  {
    method: 'POST',
    path: '/api/admin/notices/del',
    handler: ({ body }) => {
      const id = bodyNum(body, 'id');
      if (!deleteById(demoState.notices, id)) return fail('公告不存在');
      return ok({ id });
    },
  },
  {
    method: 'POST',
    path: '/api/admin/notices/upload',
    handler: () => ok({ url: DEMO_IMAGE }),
  },
  {
    method: 'GET',
    path: '/api/notices',
    handler: () => {
      const list = visibleNotices();
      return ok({ list, total: list.length });
    },
  },
  {
    method: 'GET',
    path: '/api/notices/:id',
    handler: ({ params }) => {
      const id = Number(params.id);
      const notice = visibleNotices().find((item) => item.id === id);
      return notice ? ok(notice) : fail('公告不存在或未发布', 404);
    },
  },

  // 操作日志（用户详情抽屉 + 系统日志页共用）
  {
    method: 'GET',
    path: '/api/admin/logs/list',
    handler: ({ query }): ApiEnvelope<ListResult<AdminLogItem>> => {
      const keyword = str(query, 'keyword').toLowerCase();
      const userId = num(query, 'userId', 0);
      let list = demoState.logs;
      if (userId) list = list.filter((item) => item.user_id === userId);
      if (keyword) {
        list = list.filter((item) =>
          [item.username, item.title, item.url].some((value) => value.toLowerCase().includes(keyword)),
        );
      }
      const { rows, page, limit } = paginate(list, num(query, 'page', 1), num(query, 'limit', 10));
      return ok({ list: rows, total: list.length, page, limit });
    },
  },

  // 系统监控
  {
    method: 'GET',
    path: '/api/admin/monitor/online/list',
    handler: ({ query }): ApiEnvelope<OnlineListResult> => {
      const keyword = str(query, 'keyword').toLowerCase();
      const status = str(query, 'status');
      let list: OnlineSession[] = demoState.sessions;
      if (keyword) {
        list = list.filter((item) =>
          [item.username ?? '', item.nickname ?? '', item.ip].some((value) =>
            value.toLowerCase().includes(keyword),
          ),
        );
      }
      if (status) list = list.filter((item) => item.status === status);
      const { rows, page, limit } = paginate(list, num(query, 'page', 1), num(query, 'limit', 10));
      return ok({ list: rows, total: list.length, page, limit, serverTime: now() });
    },
  },
  {
    method: 'POST',
    path: '/api/admin/monitor/online/kick',
    handler: ({ body }) => {
      const sessionId = bodyStr(body, 'sessionId');
      const before = demoState.sessions.length;
      demoState.sessions = demoState.sessions.filter((item) => item.session_id !== sessionId);
      return ok({ revoked: before - demoState.sessions.length });
    },
  },
  {
    method: 'GET',
    path: '/api/admin/monitor/login-logs/list',
    handler: ({ query }): ApiEnvelope<ListResult<LoginLogItem>> => {
      const keyword = str(query, 'keyword').toLowerCase();
      const behavior = str(query, 'behavior');
      const status = str(query, 'status');
      let list = demoState.loginLogs;
      if (keyword) {
        list = list.filter((item) =>
          [item.username, item.nickname, item.ip].some((value) => value.toLowerCase().includes(keyword)),
        );
      }
      if (behavior) list = list.filter((item) => item.behavior === behavior);
      if (status) list = list.filter((item) => String(item.status) === status);
      const { rows, page, limit } = paginate(list, num(query, 'page', 1), num(query, 'limit', 10));
      return ok({ list: rows, total: list.length, page, limit });
    },
  },
  {
    method: 'GET',
    path: '/api/admin/monitor/logs/list',
    handler: ({ query }): ApiEnvelope<ListResult<OperationLogItem>> => {
      const keyword = str(query, 'keyword').toLowerCase();
      const status = str(query, 'status');
      const module = str(query, 'module');
      let list = demoState.operationLogs;
      if (keyword) {
        list = list.filter((item) =>
          [item.username, item.title, item.url].some((value) => value.toLowerCase().includes(keyword)),
        );
      }
      if (status) list = list.filter((item) => item.status === status);
      if (module) list = list.filter((item) => item.module === module);
      const { rows, page, limit } = paginate(list, num(query, 'page', 1), num(query, 'limit', 10));
      return ok({ list: rows, total: list.length, page, limit });
    },
  },
  {
    method: 'GET',
    path: '/api/admin/logs/detail',
    handler: ({ query }) => {
      const id = num(query, 'id', 0);
      const item = demoState.operationLogs.find((log) => log.id === id);
      return item ? ok(buildOperationDetail(item)) : fail('日志不存在', 404);
    },
  },

  // 系统配置
  { method: 'GET', path: '/api/admin/settings', handler: () => ok(demoState.config) },
  {
    method: 'POST',
    path: '/api/admin/settings/save',
    handler: ({ body }) => {
      const section = bodyStr(body, 'section');
      const values = body.values;
      const target = demoState.config[section as keyof SystemConfig];
      if (!target) return fail('配置区块不存在');
      if (values && typeof values === 'object') {
        Object.assign(target as unknown as Record<string, unknown>, values);
      }
      return ok(demoState.config);
    },
  },
  {
    method: 'POST',
    path: '/api/admin/settings/reset',
    handler: ({ body }) => {
      const section = bodyStr(body, 'section') as keyof SystemConfig;
      const defaults = buildConfig();
      if (!demoState.config[section]) return fail('配置区块不存在');
      Object.assign(
        demoState.config[section] as unknown as Record<string, unknown>,
        defaults[section] as unknown as Record<string, unknown>,
      );
      return ok(demoState.config);
    },
  },
  {
    method: 'POST',
    path: '/api/admin/settings/upload',
    handler: () => ok({ url: DEMO_IMAGE }),
  },

  // 个人中心
  { method: 'GET', path: '/api/admin/profile', handler: () => ok(demoState.profile) },
  {
    method: 'POST',
    path: '/api/admin/profile/contact',
    handler: ({ body }) => {
      const field = bodyStr(body, 'field');
      const value = bodyStr(body, 'value');
      if (field !== 'mobile' && field !== 'email') return fail('字段不支持');
      const profile: SelfProfile = demoState.profile;
      if (field === 'mobile') profile.mobile = value;
      else profile.email = value;
      const user = demoState.users.find((item) => item.id === profile.id);
      if (user) {
        if (field === 'mobile') user.mobile = value;
        else user.email = value;
      }
      return ok({ field, value });
    },
  },
  {
    method: 'POST',
    path: '/api/admin/profile/password',
    handler: ({ body }) => (bodyStr(body, 'newPassword') ? ok(true) : fail('新密码不能为空')),
  },

  // 语言管理
  { method: 'GET', path: '/api/admin/languages/list', handler: () => ok(languageOverview()) },
  {
    method: 'GET',
    path: '/api/admin/languages/entries',
    handler: ({ query }): ApiEnvelope<LanguageEntryResult> => {
      const keyword = str(query, 'keyword').toLowerCase();
      const module = str(query, 'module');
      const type = str(query, 'type');
      let list = demoState.entries;
      if (keyword) {
        list = list.filter((entry) =>
          [entry.key, ...Object.values(entry.values)].some((value) =>
            value.toLowerCase().includes(keyword),
          ),
        );
      }
      if (module) list = list.filter((entry) => entry.module === module);
      if (type === 'system' || type === 'custom') list = list.filter((entry) => entry.type === type);
      const { rows, page, limit } = paginate(list, num(query, 'page', 1), num(query, 'limit', 10));
      return ok({ list: rows, total: list.length, page, limit });
    },
  },
  {
    method: 'POST',
    path: '/api/admin/languages/save',
    handler: ({ body }) => {
      const id = bodyNum(body, 'id');
      const exist = demoState.languages.find((item) => item.id === id);
      if (exist) {
        exist.code = bodyStr(body, 'code') || exist.code;
        exist.name = bodyStr(body, 'name') || exist.name;
        exist.nativeName = bodyStr(body, 'nativeName') || exist.nativeName;
        exist.weigh = bodyNum(body, 'weigh') || exist.weigh;
        exist.status = bodyNum(body, 'status') || exist.status;
        return ok({ id });
      }
      const nextId = demoState.seq.language++;
      demoState.languages.push({
        id: nextId,
        code: bodyStr(body, 'code') || `l${nextId}`,
        name: bodyStr(body, 'name') || '新语言',
        nativeName: bodyStr(body, 'nativeName') || 'New',
        weigh: bodyNum(body, 'weigh'),
        status: bodyNum(body, 'status') || 1,
        translated: 0,
        isDefault: false,
      });
      return ok({ id: nextId });
    },
  },
  {
    method: 'POST',
    path: '/api/admin/languages/del',
    handler: ({ body }) => {
      const id = bodyNum(body, 'id');
      if (!deleteById(demoState.languages, id)) return fail('语言不存在');
      return ok({ id });
    },
  },
  {
    method: 'POST',
    path: '/api/admin/languages/entry',
    handler: ({ body }) => {
      const id = bodyNum(body, 'id');
      const values = (body.values ?? {}) as Record<string, string>;
      const exist = demoState.entries.find((item) => item.id === id);
      if (exist) {
        exist.values = { ...exist.values, ...values };
        exist.remark = bodyStr(body, 'remark') || exist.remark;
        return ok({ id });
      }
      const nextId = demoState.seq.entry++;
      demoState.entries.push({
        id: nextId,
        key: bodyStr(body, 'key') || `custom.key${nextId}`,
        module: 'custom',
        type: 'custom',
        remark: bodyStr(body, 'remark'),
        values,
      });
      return ok({ id: nextId });
    },
  },
  {
    method: 'POST',
    path: '/api/admin/languages/entry-del',
    handler: ({ body }) => {
      const id = bodyNum(body, 'id');
      if (!deleteById(demoState.entries, id)) return fail('词条不存在');
      return ok({ id });
    },
  },
];

// --- 计数维护 --------------------------------------------------------------

/** 角色成员数、部门人数是派生值：改完账号立刻重算，页面上不会出现「刚加的人没算进去」。 */
function refreshRoleCounts(): void {
  for (const role of demoState.roles) {
    role.memberCount = demoState.users.filter((user) =>
      user.roles.some((item) => item.id === role.id),
    ).length;
  }
}

function refreshDepartmentCounts(): void {
  for (const dept of demoState.departments) {
    dept.userCount = demoState.users.filter((user) => user.departmentId === dept.id).length;
  }
}

// --- 匹配与导出 ------------------------------------------------------------

function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  const patternParts = pattern.split('/');
  const pathParts = pathname.split('/');
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < patternParts.length; index += 1) {
    const expected = patternParts[index] ?? '';
    const actual = pathParts[index] ?? '';
    if (expected.startsWith(':')) params[expected.slice(1)] = decodeURIComponent(actual);
    else if (expected !== actual) return null;
  }
  return params;
}

export interface MockRequest {
  method?: string;
  body?: unknown;
  query?: Record<string, unknown>;
}

/**
 * 拦截点：`apiFetch` 在演示模式下不调 `$fetch`，改调这里。
 * 返回值仍是原始信封，业务码处理（409 续期、303 跳登录）留给请求器，两边行为一致。
 */
export async function mockEnvelope<T>(
  url: string,
  options: MockRequest = {},
): Promise<ApiEnvelope<T>> {
  const method = (options.method ?? 'GET').toUpperCase();
  const pathname = url.split('?')[0] ?? url;
  const query = options.query ?? {};

  // 只读闸门：除登录/退出/续期外，所有写操作直接拒绝（见 DEMO_WRITE_ALLOWED）。
  // 放在最前面，写处理器即便留着也不会被走到。
  if (method !== 'GET' && !DEMO_WRITE_ALLOWED.has(`${method} ${pathname}`)) {
    return { code: 403, msg: demoReadonlyMessage(), data: undefined as T };
  }
  // 上传接口的 body 是 FormData，不是普通对象；这里只取普通对象的键值。
  const rawBody = options.body;
  const body: Body =
    rawBody && typeof rawBody === 'object' && !(rawBody instanceof FormData)
      ? (rawBody as Body)
      : {};

  // 首次进入演示站时补一次派生计数，避免种子与后续 CRUD 的中间状态不一致。
  refreshRoleCounts();
  refreshDepartmentCounts();

  for (const route of routes) {
    if (route.method !== method) continue;
    const params = matchPath(route.path, pathname);
    if (!params) continue;
    return route.handler({ path: pathname, params, query, body }) as ApiEnvelope<T>;
  }

  return {
    code: 404,
    msg: `演示环境未实现该接口：${method} ${pathname}`,
    data: undefined as T,
  };
}

/** 演示站「最近一次活跃时间」，页脚可以拿它显示数据新鲜度（当前未使用，保留导出以便调试）。 */
export const demoBuildStamp = ago(0);
