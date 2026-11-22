/**
 * 权限内核单测（不连数据库）。
 *
 * 覆盖的是「逻辑一旦写错，权限就会错」的那几个纯函数：
 * 规则串解析、超管直通、菜单树裁剪、authNode、数据权限的集合比较、
 * 密码哈希与日志脱敏。
 *
 * 需要真实 MySQL 的部分（建表、登录、409 续期）不在这里测 —— 它们属于集成测试，
 * 见 docs/权限系统实现.md 第 11 节的验证步骤。
 */
import { describe, expect, it } from 'vitest';
import {
  buildAuthNode,
  buildMenuTree,
  check,
  parseRules,
  ruleIdsToNumbers,
  type AdminContext,
  type RuleRow,
} from '../server/utils/auth/rbac';
import { isRuleSubset, isStrictSubset } from '../server/utils/auth/data-scope';
import { hashPassword, verifyPassword } from '../server/utils/auth/password';
import { sanitizeForLog } from '../server/utils/auth/admin-log';

/** 造一个规则行：只关心权限相关的字段，其余给默认值。 */
function rule(partial: Partial<RuleRow> & Pick<RuleRow, 'id' | 'pid' | 'name'>): RuleRow {
  return {
    type: 'menu',
    title: partial.name,
    path: `/${partial.name}`,
    icon: '',
    menu_type: '',
    url: '',
    component: '',
    keepalive: 1,
    extend: 'none',
    remark: '',
    weigh: 0,
    status: 1,
    ...partial,
  } as unknown as RuleRow;
}

const CONTEXT_RULES: RuleRow[] = [
  rule({ id: 1, pid: 0, name: 'dashboard', type: 'menu', weigh: 100 }),
  rule({ id: 2, pid: 0, name: 'system', type: 'menu_dir', path: '#group-system', weigh: 50 }),
  rule({ id: 3, pid: 2, name: 'system/role', type: 'menu', weigh: 0 }),
  rule({ id: 4, pid: 3, name: 'system/role/add', type: 'button', path: '', weigh: 0 }),
  rule({ id: 5, pid: 3, name: 'system/role/del', type: 'button', path: '', weigh: 0 }),
  rule({ id: 6, pid: 0, name: 'empty-dir', type: 'menu_dir', path: '#empty', weigh: 10 }),
];

function context(overrides: Partial<AdminContext> = {}): AdminContext {
  const rules = overrides.rules ?? CONTEXT_RULES;
  const names = new Set(rules.map((item) => item.name.toLowerCase()));
  return {
    admin: { id: 1, username: 'tester', department_id: 0 } as unknown as AdminContext['admin'],
    token: 'token',
    roles: [],
    ruleIds: rules.map((item) => String(item.id)),
    isSuper: false,
    ruleNames: names,
    rules,
    scopeDepartmentId: 0,
    mustChangePassword: false,
    ...overrides,
  };
}

describe('规则串解析', () => {
  it('星号原样返回', () => {
    expect(parseRules('*')).toEqual(['*']);
  });

  it('逗号串会去空格并丢弃空项', () => {
    expect(parseRules('1, 21,,22,')).toEqual(['1', '21', '22']);
  });

  it('空值返回空数组', () => {
    expect(parseRules(null)).toEqual([]);
    expect(parseRules('   ')).toEqual([]);
  });

  it('id 转换会去掉星号、非数字与重复项', () => {
    expect(ruleIdsToNumbers(['*', '3', 'x', '3', '7'])).toEqual([3, 7]);
  });
});

describe('check()', () => {
  it('超管直通：任何节点都通过，包括未来新增的', () => {
    expect(check(context({ isSuper: true, ruleNames: new Set(['*']) }), 'nope/not/exist')).toBe(true);
  });

  it('命中节点名返回 true，大小写不敏感', () => {
    expect(check(context(), 'SYSTEM/role/add')).toBe(true);
  });

  it('未命中返回 false', () => {
    expect(check(context(), 'system/role/edit')).toBe(false);
  });

  it('逗号串按 or 判定，and 要求全部命中', () => {
    const ctx = context();
    expect(check(ctx, 'system/role/add,system/role/edit')).toBe(true);
    expect(check(ctx, 'system/role/add,system/role/edit', 'and')).toBe(false);
    expect(check(ctx, 'system/role/add,system/role/del', 'and')).toBe(true);
  });

  it('空节点名一律拒绝', () => {
    expect(check(context(), ' , ')).toBe(false);
  });
});

describe('菜单树', () => {
  it('按钮不参与菜单，只有 menu_dir 与 menu 出现', () => {
    const tree = buildMenuTree(CONTEXT_RULES);
    const names = JSON.stringify(tree);
    expect(names).not.toContain('system/role/add');
    expect(tree.map((node) => node.name)).toEqual(['dashboard', 'system']);
  });

  it('空目录会被裁掉（点进去是 404，不如不显示）', () => {
    const tree = buildMenuTree(CONTEXT_RULES);
    expect(tree.some((node) => node.name === 'empty-dir')).toBe(false);
  });

  it('按 weigh 倒序，子节点挂到正确父级', () => {
    const tree = buildMenuTree(CONTEXT_RULES);
    expect(tree[1]?.children.map((node) => node.name)).toEqual(['system/role']);
  });

  it('个人中心不进菜单树（入口只在用户下拉框）', () => {
    const rules: RuleRow[] = [
      rule({ id: 11, pid: 0, name: 'system/profile', path: '/admin/profile', weigh: 60 }),
      rule({ id: 12, pid: 11, name: 'system/profile/edit', type: 'button', path: '' }),
    ];
    expect(buildMenuTree(rules)).toEqual([]);
  });
});

describe('authNode', () => {
  it('父节点名 → 子按钮名，只包含 button', () => {
    const map = buildAuthNode(CONTEXT_RULES);
    expect(map['system/role']).toEqual(['system/role/add', 'system/role/del']);
    expect(map.dashboard).toBeUndefined();
  });
});

describe('数据权限的集合比较', () => {
  it('子集判定', () => {
    expect(isRuleSubset([1, 2], new Set([1, 2, 3]))).toBe(true);
    expect(isRuleSubset([1, 4], new Set([1, 2, 3]))).toBe(false);
    expect(isRuleSubset([], new Set([1]))).toBe(true);
  });

  it('严格子集要求对方还有额外权限', () => {
    expect(isStrictSubset([1, 2], new Set([1, 2, 3]))).toBe(true);
    expect(isStrictSubset([1, 2, 3], new Set([1, 2, 3]))).toBe(false);
  });
});

describe('密码哈希', () => {
  it('同一密码两次哈希结果不同（有随机盐），但都能验过', async () => {
    const a = await hashPassword('123456');
    const b = await hashPassword('123456');
    expect(a).not.toBe(b);
    expect(await verifyPassword('123456', a)).toBe(true);
    expect(await verifyPassword('123456', b)).toBe(true);
  });

  it('错误密码被拒绝', async () => {
    const hash = await hashPassword('123456');
    expect(await verifyPassword('654321', hash)).toBe(false);
  });

  it('损坏的哈希串返回 false 而不是抛错', async () => {
    expect(await verifyPassword('x', 'scrypt$bad')).toBe(false);
    expect(await verifyPassword('x', '')).toBe(false);
  });

  it('兼容历史明文密码', async () => {
    expect(await verifyPassword('123456', '123456')).toBe(true);
    expect(await verifyPassword('123456', '1234567')).toBe(false);
  });
});

describe('日志脱敏', () => {
  it('密码、token 类字段被替换，其他字段保留', () => {
    const result = sanitizeForLog({
      username: 'admin',
      password: 'secret',
      refreshToken: 'abc',
      nested: { newPassword: 'x', ok: 1 },
    }) as Record<string, unknown>;
    expect(result.username).toBe('admin');
    expect(result.password).toBe('******');
    expect(result.refreshToken).toBe('******');
    expect((result.nested as Record<string, unknown>).newPassword).toBe('******');
    expect((result.nested as Record<string, unknown>).ok).toBe(1);
  });

  it('超长字符串被截断', () => {
    const long = 'a'.repeat(800);
    const result = sanitizeForLog({ text: long }) as { text: string };
    expect(result.text.length).toBeLessThan(600);
    expect(result.text.endsWith('…')).toBe(true);
  });
});
