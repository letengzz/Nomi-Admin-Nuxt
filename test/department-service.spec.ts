/**
 * 顶级部门状态锁的单测（不连数据库）。
 *
 * 根节点停用会让整棵组织树从登录页/选择器里消失，所以这条规则必须钉死：
 * 子部门照常启停用，顶级部门一律启用，三种「绕道」也要挡住。
 */
import { describe, expect, it } from 'vitest';
import {
  assertRootDepartmentDeletable,
  lockRootDepartmentStatus,
} from '../server/utils/auth/department-service';

describe('lockRootDepartmentStatus', () => {
  it('普通子部门保持调用方给的状态', () => {
    expect(lockRootDepartmentStatus(1, 2, 2)).toBe(1);
    expect(lockRootDepartmentStatus(0, 2, 2)).toBe(0);
  });

  it('非法状态收敛成 1 / 0，不会写进脏值', () => {
    expect(lockRootDepartmentStatus(7, 2, 2)).toBe(1);
    expect(lockRootDepartmentStatus(NaN, 2, 2)).toBe(1);
  });

  it('新建顶级部门不能一出生就是停用', () => {
    expect(lockRootDepartmentStatus(1, 0)).toBe(1);
    expect(() => lockRootDepartmentStatus(0, 0)).toThrow(/顶级部门不能停用/);
  });

  it('把子部门提升成顶级时顺手停用也要拒绝', () => {
    expect(lockRootDepartmentStatus(1, 0, 2)).toBe(1);
    expect(() => lockRootDepartmentStatus(0, 0, 2)).toThrow(/顶级部门不能停用/);
  });

  it('原本是顶级的部门，改挂到别处并顺手停用同样拒绝', () => {
    expect(lockRootDepartmentStatus(1, 5, 0)).toBe(1);
    expect(() => lockRootDepartmentStatus(0, 5, 0)).toThrow(/顶级部门不能停用/);
  });

  it('顶级部门保持启用时，其余字段照常可编辑', () => {
    expect(lockRootDepartmentStatus(1, 0, 0)).toBe(1);
  });
});

describe('assertRootDepartmentDeletable', () => {
  it('顶级部门（pid=0）拒绝删除', () => {
    expect(() => assertRootDepartmentDeletable(0)).toThrow(/顶级部门不能删除/);
  });

  it('普通部门放行（后续还有子部门/成员的检查）', () => {
    expect(() => assertRootDepartmentDeletable(1)).not.toThrow();
    expect(() => assertRootDepartmentDeletable(99)).not.toThrow();
  });
});
