/**
 * 角色成员分配接口的入参归一化单测（不连数据库）。
 *
 * 动作白名单与账号 id 校验是「前端按钮挂了也还有一道闸」的那道闸；
 * 真正落库的加减成员、防提权与最后一个超管护栏在接口层验证。
 */
import { describe, expect, it } from 'vitest';
import {
  assertSuperRoleCanRemove,
  normalizeRoleUserAction,
} from '../server/utils/auth/role-user-service';

describe('normalizeRoleUserAction', () => {
  it('只认 add / remove', () => {
    expect(normalizeRoleUserAction('add')).toBe('add');
    expect(normalizeRoleUserAction('remove')).toBe('remove');
  });

  it('其它值一律拒绝，避免把未知动作当成删除或新增', () => {
    for (const bad of [undefined, null, '', 'delete', 1, {}, ['add']]) {
      expect(() => normalizeRoleUserAction(bad)).toThrow(/不支持的操作类型/);
    }
  });
});

describe('assertSuperRoleCanRemove', () => {
  it('超管角色只剩 0 / 1 个成员时拒绝取消分配', () => {
    expect(() => assertSuperRoleCanRemove(true, 0)).toThrow(/至少保留一个成员/);
    expect(() => assertSuperRoleCanRemove(true, 1)).toThrow(/至少保留一个成员/);
  });

  it('超管角色有 2 个及以上成员、或普通角色，都放行', () => {
    expect(() => assertSuperRoleCanRemove(true, 2)).not.toThrow();
    expect(() => assertSuperRoleCanRemove(false, 1)).not.toThrow();
    expect(() => assertSuperRoleCanRemove(false, 0)).not.toThrow();
  });
});
