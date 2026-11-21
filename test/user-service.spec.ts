/**
 * 账号模块的入参校验单测（不连数据库）。
 *
 * 这些函数是「前端校验挂了也还有一道闸」的那道闸，所以边界必须钉死：
 * 账号字符集、密码长度、邮箱/手机格式、角色与部门的归一化、批量 id 的去重与上限。
 * 真正落库的分页、角色分配与防提权在集成验证里跑（docs/权限系统实现.md 第 11 节）。
 */
import { describe, expect, it } from 'vitest';
import {
  normalizeUserIds,
  normalizeUserListQuery,
  normalizeUserPayload,
} from '../server/utils/auth/user-service';

const CREATE = { requireUsername: true, requirePassword: true } as const;
const UPDATE = { requireUsername: false, requirePassword: false } as const;

describe('normalizeUserPayload', () => {
  it('新增时补齐默认值：昵称留空、状态启用、部门未分配、角色为空', () => {
    const input = normalizeUserPayload({ username: 'lin_zhi', password: '123456' }, CREATE);
    expect(input).toEqual({
      username: 'lin_zhi',
      password: '123456',
      nickname: '',
      email: '',
      mobile: '',
      motto: '',
      gender: 'unknown',
      status: 'enable',
      departmentId: 0,
      roleIds: [],
    });
  });

  it('部门 id 只接受正整数，其它一律收敛到「未分配」', () => {
    expect(normalizeUserPayload({ departmentId: 5 }, UPDATE).departmentId).toBe(5);
    expect(normalizeUserPayload({ departmentId: '7' }, UPDATE).departmentId).toBe(7);
    expect(normalizeUserPayload({ departmentId: -3 }, UPDATE).departmentId).toBe(0);
    expect(normalizeUserPayload({ departmentId: 'x' }, UPDATE).departmentId).toBe(0);
    expect(normalizeUserPayload({}, UPDATE).departmentId).toBe(0);
  });

  it('性别只认 unknown / male / female，其它值落到保密', () => {
    expect(normalizeUserPayload({ gender: 'female' }, UPDATE).gender).toBe('female');
    expect(normalizeUserPayload({ gender: 'male' }, UPDATE).gender).toBe('male');
    expect(normalizeUserPayload({ gender: '女' }, UPDATE).gender).toBe('unknown');
    expect(normalizeUserPayload({}, UPDATE).gender).toBe('unknown');
  });

  it('角色 id 去重并丢掉非法值', () => {
    const input = normalizeUserPayload({ roles: [1, '2', 2, 0, -1, 'x'] }, UPDATE);
    expect(input.roleIds).toEqual([1, 2]);
  });

  it('账号太短、含中文、密码过短都会被拒绝', () => {
    expect(() => normalizeUserPayload({ username: 'ab', password: '123456' }, CREATE)).toThrow();
    expect(() => normalizeUserPayload({ username: '张三', password: '123456' }, CREATE)).toThrow();
    expect(() => normalizeUserPayload({ username: 'zhangsan', password: '123' }, CREATE)).toThrow();
  });

  it('邮箱与手机号只做格式校验，允许留空', () => {
    expect(() => normalizeUserPayload({ username: 'zhangsan', password: '123456', email: 'a@b' }, CREATE)).toThrow();
    expect(() =>
      normalizeUserPayload({ username: 'zhangsan', password: '123456', mobile: 'abc' }, CREATE),
    ).toThrow();
    const input = normalizeUserPayload(
      { username: 'zhangsan', password: '123456', email: 'a@b.co', mobile: '+86 138-0000-0000' },
      CREATE,
    );
    expect(input.email).toBe('a@b.co');
    expect(input.mobile).toBe('+86 138-0000-0000');
  });

  it('编辑时不校验账号，空密码视为不修改', () => {
    const input = normalizeUserPayload({ id: 7, nickname: '新昵称', status: 'disable' }, UPDATE);
    expect(input.password).toBe('');
    expect(input.status).toBe('disable');
    expect(input.nickname).toBe('新昵称');
  });

  it('编辑时填了短密码仍然报错，避免「以为改了其实没改」', () => {
    expect(() => normalizeUserPayload({ password: '123' }, UPDATE)).toThrow();
  });
});

describe('normalizeUserListQuery', () => {
  it('页码与条数被夹在合理区间', () => {
    expect(normalizeUserListQuery({ page: '0', limit: '999' })).toMatchObject({ page: 1, limit: 100 });
    expect(normalizeUserListQuery({ page: '-3', limit: '0' })).toMatchObject({ page: 1, limit: 10 });
  });

  it('关键词去空格，状态只认白名单，部门/角色 id 收敛为非负整数', () => {
    expect(normalizeUserListQuery({ keyword: '  lin  ', status: 'enable' })).toMatchObject({
      keyword: 'lin',
      status: 'enable',
    });
    expect(normalizeUserListQuery({ status: 'delete' }).status).toBe('');
    expect(normalizeUserListQuery({ departmentId: '5' }).departmentId).toBe(5);
    expect(normalizeUserListQuery({ departmentId: -2 }).departmentId).toBe(0);
    expect(normalizeUserListQuery({ departmentId: 'x' }).departmentId).toBe(0);
    expect(normalizeUserListQuery({ roleId: '3' }).roleId).toBe(3);
    expect(normalizeUserListQuery({ roleId: -1 }).roleId).toBe(0);
    expect(normalizeUserListQuery({ roleId: 'x' }).roleId).toBe(0);
    expect(normalizeUserListQuery({}).roleId).toBe(0);
  });

  it('性别只认 unknown / male / female，其它值一律「不限」', () => {
    expect(normalizeUserListQuery({ gender: 'male' }).gender).toBe('male');
    expect(normalizeUserListQuery({ gender: 'female' }).gender).toBe('female');
    expect(normalizeUserListQuery({ gender: 'unknown' }).gender).toBe('unknown');
    for (const bad of ['MALE', 'other', '', 1, null, {}, undefined]) {
      expect(normalizeUserListQuery({ gender: bad }).gender).toBe('');
    }
  });

  it('排除角色 id 也收敛为非负整数（分配用户弹窗用）', () => {
    expect(normalizeUserListQuery({ excludeRoleId: '4' }).excludeRoleId).toBe(4);
    expect(normalizeUserListQuery({ excludeRoleId: -8 }).excludeRoleId).toBe(0);
    expect(normalizeUserListQuery({ excludeRoleId: 'x' }).excludeRoleId).toBe(0);
    expect(normalizeUserListQuery({}).excludeRoleId).toBe(0);
  });

  it('excludeSelf 只认 true / "true" / 1', () => {
    expect(normalizeUserListQuery({ excludeSelf: true }).excludeSelf).toBe(true);
    expect(normalizeUserListQuery({ excludeSelf: 'true' }).excludeSelf).toBe(true);
    expect(normalizeUserListQuery({ excludeSelf: 1 }).excludeSelf).toBe(true);
    expect(normalizeUserListQuery({ excludeSelf: 'yes' }).excludeSelf).toBe(false);
    expect(normalizeUserListQuery({}).excludeSelf).toBe(false);
  });
});

describe('normalizeUserIds', () => {
  it('去重、丢掉非法值', () => {
    expect(normalizeUserIds([1, '2', 2, 0, -1, 'x', null])).toEqual([1, 2]);
  });

  it('空列表与超量都会报错', () => {
    expect(() => normalizeUserIds([])).toThrow();
    expect(() => normalizeUserIds(Array.from({ length: 101 }, (_, index) => index + 1))).toThrow();
  });
});
