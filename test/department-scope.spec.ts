/**
 * 部门数据范围的单测（不连数据库）。
 *
 * 这条规则是安全边界：范围只能由服务端从登录账号的 department_id 推导。
 * 重点覆盖三种身份（超管 / 有部门 / 无部门）、子树递归、以及 SQL 条件的
 * 「空范围」分支 —— 那里最容易写出 `IN ()` 或者漏掉自己。
 */
import { describe, expect, it } from 'vitest';
import {
  assertDepartmentAssignable,
  assertDepartmentScopeAllows,
  buildDepartmentScope,
  collectDepartmentIds,
  departmentScopeCondition,
  isDepartmentVisible,
  isLoginDepartmentAllowed,
  isUserVisible,
  userScopeCondition,
  userScopeSubquery,
} from '../server/utils/auth/department-scope';

/** 与 SEED_DEPARTMENTS 同构：1 是唯一顶级，2/5/8/10 是一级中心。 */
const TREE = [
  { id: 1, pid: 0 },
  { id: 2, pid: 1 },
  { id: 3, pid: 2 },
  { id: 4, pid: 2 },
  { id: 5, pid: 1 },
  { id: 6, pid: 5 },
  { id: 7, pid: 5 },
  { id: 8, pid: 1 },
  { id: 9, pid: 8 },
  { id: 10, pid: 1 },
];

const superScope = buildDepartmentScope({ isSuper: true, adminId: 1, departmentId: 1 }, TREE);
const techScope = buildDepartmentScope({ isSuper: false, adminId: 2, departmentId: 2 }, TREE);
const marketScope = buildDepartmentScope({ isSuper: false, adminId: 3, departmentId: 8 }, TREE);
const noDeptScope = buildDepartmentScope({ isSuper: false, adminId: 4, departmentId: 0 }, TREE);

describe('collectDepartmentIds', () => {
  it('含自己与所有层级子部门', () => {
    expect(collectDepartmentIds(TREE, 2).sort((a, b) => a - b)).toEqual([2, 3, 4]);
    expect(collectDepartmentIds(TREE, 1).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(collectDepartmentIds(TREE, 3)).toEqual([3]);
  });

  it('0 / 负数 / 不存在的部门都是空范围，不能退化成看全部', () => {
    expect(collectDepartmentIds(TREE, 0)).toEqual([]);
    expect(collectDepartmentIds(TREE, -1)).toEqual([]);
    expect(collectDepartmentIds(TREE, 999)).toEqual([]);
  });

  it('脏数据成环也不会重复或死循环', () => {
    const cyclic = [
      { id: 1, pid: 2 },
      { id: 2, pid: 1 },
      { id: 3, pid: 1 },
    ];
    expect(collectDepartmentIds(cyclic, 1).sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });
});

describe('buildDepartmentScope', () => {
  it('超管不限范围，其他人只看本部门及子部门', () => {
    expect(superScope.departmentIds).toBeNull();
    expect(techScope.departmentIds?.sort((a, b) => a - b)).toEqual([2, 3, 4]);
    expect(marketScope.departmentIds?.sort((a, b) => a - b)).toEqual([8, 9]);
  });

  it('未分配部门 / 部门已被删除时收敛成「只看自己」', () => {
    expect(noDeptScope.departmentIds).toEqual([]);
    expect(
      buildDepartmentScope({ isSuper: false, adminId: 5, departmentId: 999 }, TREE).departmentIds,
    ).toEqual([]);
  });

  it('selfId 始终是当前登录账号', () => {
    expect(superScope.selfId).toBe(1);
    expect(techScope.selfId).toBe(2);
  });

  it('登录所选部门优先作为范围根：技术中心账号选前端组只看前端组', () => {
    // 账号属技术中心(2)，登录时选了前端组(3)：范围收窄到 3，看不到技术中心本级的 2/4。
    expect(
      buildDepartmentScope(
        { isSuper: false, adminId: 2, departmentId: 2, scopeDepartmentId: 3 },
        TREE,
      ).departmentIds,
    ).toEqual([3]);
    // 选回技术中心(2)：恢复看 2 及下级。
    expect(
      buildDepartmentScope(
        { isSuper: false, adminId: 2, departmentId: 2, scopeDepartmentId: 2 },
        TREE,
      ).departmentIds?.sort((a, b) => a - b),
    ).toEqual([2, 3, 4]);
    // 没选（0 / 缺省）：退回账号所属部门，兼容老会话与 API 直连。
    expect(
      buildDepartmentScope({ isSuper: false, adminId: 2, departmentId: 2, scopeDepartmentId: 0 }, TREE)
        .departmentIds?.sort((a, b) => a - b),
    ).toEqual([2, 3, 4]);
    expect(techScope.departmentIds?.sort((a, b) => a - b)).toEqual([2, 3, 4]);
  });
});

describe('可见性判定', () => {
  it('部门：超管全放行，非超管只放行子树', () => {
    expect(isDepartmentVisible(superScope, 999)).toBe(true);
    expect(isDepartmentVisible(techScope, 2)).toBe(true);
    expect(isDepartmentVisible(techScope, 4)).toBe(true);
    expect(isDepartmentVisible(techScope, 1)).toBe(false);
    expect(isDepartmentVisible(techScope, 8)).toBe(false);
  });

  it('账号：自己始终可见，范围外账号不可见', () => {
    expect(isUserVisible(techScope, { id: 2, departmentId: 99 })).toBe(true);
    expect(isUserVisible(techScope, { id: 9, departmentId: 3 })).toBe(true);
    expect(isUserVisible(techScope, { id: 9, departmentId: 8 })).toBe(false);
    expect(isUserVisible(noDeptScope, { id: 9, departmentId: 0 })).toBe(false);
    expect(isUserVisible(superScope, { id: 9, departmentId: 0 })).toBe(true);
  });

  it('写操作护栏：范围外部门直接拒绝', () => {
    expect(() => assertDepartmentScopeAllows(techScope, 3)).not.toThrow();
    expect(() => assertDepartmentScopeAllows(techScope, 1)).toThrow(/本部门及下级部门/);
    expect(() => assertDepartmentScopeAllows(superScope, 1)).not.toThrow();
  });
});

describe('isLoginDepartmentAllowed（登录部门闸门）', () => {
  it('所选必须在账号部门子树内：技术中心账号可选自己和下级小组', () => {
    // admin 属技术中心(2)：技术中心 / 前端组 / 后端组都能选。
    expect(isLoginDepartmentAllowed(2, 2, TREE)).toBe(true);
    expect(isLoginDepartmentAllowed(2, 3, TREE)).toBe(true);
    expect(isLoginDepartmentAllowed(2, 4, TREE)).toBe(true);
    // 总经办是上级、市场运营中心是旁支，都不能选 —— 选了等于放大可见范围。
    expect(isLoginDepartmentAllowed(2, 1, TREE)).toBe(false);
    expect(isLoginDepartmentAllowed(2, 8, TREE)).toBe(false);
    expect(isLoginDepartmentAllowed(2, 5, TREE)).toBe(false);
  });

  it('前端组账号只能选前端组，选技术中心/兄弟组都不行', () => {
    expect(isLoginDepartmentAllowed(3, 3, TREE)).toBe(true);
    expect(isLoginDepartmentAllowed(3, 2, TREE)).toBe(false);
    expect(isLoginDepartmentAllowed(3, 4, TREE)).toBe(false);
  });

  it('超管在总经办(1)：整棵树都能选', () => {
    expect(isLoginDepartmentAllowed(1, 8, TREE)).toBe(true);
    expect(isLoginDepartmentAllowed(1, 3, TREE)).toBe(true);
    expect(isLoginDepartmentAllowed(1, 1, TREE)).toBe(true);
  });

  it('未选部门 / 账号无部门 / 脏数据都不放行', () => {
    expect(isLoginDepartmentAllowed(2, 0, TREE)).toBe(false);
    expect(isLoginDepartmentAllowed(0, 2, TREE)).toBe(false);
    expect(isLoginDepartmentAllowed(2, 999, TREE)).toBe(false);
  });
});

describe('assertDepartmentAssignable', () => {
  it('超管可以留空，非超管新建账号必须选部门', () => {
    expect(() => assertDepartmentAssignable(superScope, 0)).not.toThrow();
    expect(() => assertDepartmentAssignable(techScope, 0)).toThrow(/请选择本部门或下级部门/);
    expect(() => assertDepartmentAssignable(noDeptScope, 0)).toThrow(/请选择本部门或下级部门/);
  });

  it('本来就无部门的本人改资料可以保留 0，别人不行', () => {
    expect(() =>
      assertDepartmentAssignable(noDeptScope, 0, { id: 4, departmentId: 0 }),
    ).not.toThrow();
    expect(() =>
      assertDepartmentAssignable(techScope, 0, { id: 9, departmentId: 0 }),
    ).toThrow(/请选择本部门或下级部门/);
  });

  it('有部门的人不能被改成未分配，也不能被调到范围外', () => {
    expect(() =>
      assertDepartmentAssignable(techScope, 0, { id: 2, departmentId: 2 }),
    ).toThrow(/请选择本部门或下级部门/);
    expect(() => assertDepartmentAssignable(techScope, 8)).toThrow(/本部门或下级部门/);
    expect(() => assertDepartmentAssignable(techScope, 1)).toThrow(/本部门或下级部门/);
  });

  it('范围内的部门可以分配', () => {
    expect(() => assertDepartmentAssignable(techScope, 3)).not.toThrow();
    expect(() => assertDepartmentAssignable(superScope, 8)).not.toThrow();
  });
});

describe('SQL 裁剪条件', () => {
  it('超管不加任何 where', () => {
    expect(userScopeCondition(superScope)).toBeNull();
    expect(departmentScopeCondition(superScope)).toBeNull();
    expect(userScopeSubquery(superScope)).toBeNull();
  });

  it('可见账号：部门在范围内或本人', () => {
    expect(userScopeCondition(techScope)).toEqual({
      clause: '(`department_id` IN (?) OR `id` = ?)',
      params: [[2, 3, 4], 2],
    });
    expect(userScopeCondition(techScope, { departmentField: 'dept', selfField: 'uid' }).clause).toBe(
      '(`dept` IN (?) OR `uid` = ?)',
    );
  });

  it('无部门时收敛成只看自己，不产生 IN ()', () => {
    expect(userScopeCondition(noDeptScope)).toEqual({ clause: '`id` = ?', params: [4] });
    expect(departmentScopeCondition(noDeptScope)).toEqual({ clause: '1 = 0', params: [] });
    expect(userScopeSubquery(noDeptScope)?.clause).toBe(
      '`user_id` IN (SELECT `id` FROM `user` WHERE `id` = ?)',
    );
  });

  it('统计条件只按部门，保证与部门树人数对得上', () => {
    expect(departmentScopeCondition(techScope)).toEqual({
      clause: '`department_id` IN (?)',
      params: [[2, 3, 4]],
    });
  });

  it('日志/角色成员用子查询圈账号', () => {
    expect(userScopeSubquery(techScope, 'operator_id')).toEqual({
      clause:
        '`operator_id` IN (SELECT `id` FROM `user` WHERE (`department_id` IN (?) OR `id` = ?))',
      params: [[2, 3, 4], 2],
    });
  });

  it('字段名白名单，拒绝拼进 SQL 的怪值', () => {
    expect(() => userScopeCondition(techScope, { selfField: 'id` OR 1=1' })).toThrow(/非法/);
    expect(() => userScopeSubquery(techScope, 'user_id; DROP TABLE')).toThrow(/非法/);
  });
});
