/**
 * 演示站只读闸门。
 *
 * 这条规则的价值不只是「写接口会失败」，更是「失败时说的是同一句话」：
 * 各页面弹的都是 error.message，文案一旦各写一份，站里就会出现七八种说法。
 *
 * 同时锁住放行名单 —— 登录被误挡的话整个演示站等于打不开，而这种错误
 * 只在浏览器里点一次才会暴露，跑单测更划算。
 */
import { describe, expect, it } from 'vitest';
import { mockEnvelope } from '../app/mock';

const READONLY_MESSAGE = '演示环境，不允许操作';

describe('演示站只读', () => {
  it.each([
    ['POST', '/api/admin/users/add'],
    ['POST', '/api/admin/users/edit'],
    ['POST', '/api/admin/users/del'],
    ['POST', '/api/admin/roles/del'],
    ['POST', '/api/admin/notices/upload'],
    ['POST', '/api/admin/settings/save'],
    ['POST', '/api/admin/languages/entry'],
    ['POST', '/api/admin/profile/password'],
    ['POST', '/api/auth/register'],
    ['POST', '/api/auth/password-reset'],
    ['DELETE', '/api/admin/notices/1'],
  ])('%s %s 一律拒绝', async (method, url) => {
    const res = await mockEnvelope(url, { method });

    expect(res.code).toBe(403);
    expect(res.msg).toBe(READONLY_MESSAGE);
  });

  it('登录仍然放行，否则演示站进不去', async () => {
    const res = await mockEnvelope('/api/auth/login', {
      method: 'POST',
      body: { userName: 'super', password: 'whatever' },
    });

    expect(res.code).toBe(200);
    expect((res.data as { token: string }).token).toBe('demo-token');
  });

  it('退出与续期放行', async () => {
    await expect(mockEnvelope('/api/admin/logout', { method: 'POST' })).resolves.toMatchObject({
      code: 200,
    });
    await expect(
      mockEnvelope('/api/admin/refresh-token', { method: 'POST', body: { refreshToken: 'x' } }),
    ).resolves.toMatchObject({ code: 200 });
  });

  it('读接口不受影响', async () => {
    const res = await mockEnvelope('/api/admin/users/list', {
      method: 'GET',
      query: { page: 1, limit: 10 },
    });

    expect(res.code).toBe(200);
    expect((res.data as { total: number }).total).toBeGreaterThan(0);
  });
});
