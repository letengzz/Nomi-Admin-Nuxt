/**
 * 角色编码的入参校验单测（不连数据库）。
 *
 * 编码是代码与配置里引用的稳定标识，所以格式、大小写归一、空值语义必须钉死；
 * 唯一性要查库，放在接口层验证（assertRoleCodeAvailable）。
 */
import { describe, expect, it } from 'vitest';
import { normalizeRoleCode } from '../server/utils/auth/role-service';

describe('normalizeRoleCode', () => {
  it('去空格并统一小写', () => {
    expect(normalizeRoleCode('  FINANCE_Manager ')).toBe('finance_manager');
  });

  it('接受字母、数字、下划线与中划线', () => {
    expect(normalizeRoleCode('ops-2')).toBe('ops-2');
    expect(normalizeRoleCode('super_admin')).toBe('super_admin');
  });

  it('空值收敛成空串：允许多个角色先不填编码', () => {
    expect(normalizeRoleCode(undefined)).toBe('');
    expect(normalizeRoleCode(null)).toBe('');
    expect(normalizeRoleCode(123)).toBe('');
    expect(normalizeRoleCode('   ')).toBe('');
  });

  it('中文、空格、斜杠、单字符和超长都拒绝', () => {
    for (const bad of ['管理员', '角色 编码', 'system/role', 'a', 'x'.repeat(51), 'role@name']) {
      expect(() => normalizeRoleCode(bad)).toThrow(/角色编码/);
    }
  });
});
