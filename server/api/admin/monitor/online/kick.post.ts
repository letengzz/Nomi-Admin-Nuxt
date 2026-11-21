/**
 * 强退：按 session_id 一次删掉成对的 access + refresh 令牌，并留一条登录日志。
 *
 * 三道保护：不能踢掉自己当前会话（否则前端会瞬间 303 且日志莫名其妙）、
 * 目标必须落在自己的部门数据范围内、入口权限由 `monitor/online/kick` 卡住。
 */
import type { RowDataPacket } from 'mysql2/promise';
import { defineAdminHandler } from '../../../../utils/auth/handler';
import { getPool } from '../../../../database/pool';
import { assertBusiness } from '../../../../utils/http';
import { recordLoginLog } from '../../../../utils/auth/admin-log';
import { collectRequestMeta } from '../../../../utils/auth/request-meta';
import {
  digestToken,
  revokeSessionBySessionId,
  TOKEN_TYPE_ADMIN,
} from '../../../../utils/auth/token';
import { resolveDepartmentScope, userScopeSubquery } from '../../../../utils/auth/department-scope';

interface TargetRow extends RowDataPacket {
  user_id: number;
  username: string | null;
  nickname: string | null;
}

export default defineAdminHandler('monitor/online/kick', async (event, context) => {
  const body = await readBody<{ sessionId?: unknown }>(event).catch(() => null);
  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim().slice(0, 40) : '';
  assertBusiness(Boolean(sessionId), '缺少会话标识');

  const pool = getPool();
  const [selfRows] = await pool.query<Array<{ session_id: string } & RowDataPacket>>(
    'SELECT `session_id` FROM `token` WHERE `token` = ? LIMIT 1',
    [digestToken(context.token)],
  );
  assertBusiness(selfRows[0]?.session_id !== sessionId, '不能强制当前会话下线');

  const where = ['t.`session_id` = ?', 't.`type` = ?'];
  const params: unknown[] = [sessionId, TOKEN_TYPE_ADMIN];
  const scope = userScopeSubquery(await resolveDepartmentScope(context));
  if (scope) {
    where.push(scope.clause);
    params.push(...scope.params);
  }

  const [rows] = await pool.query<TargetRow[]>(
    `SELECT t.\`user_id\`, u.\`username\`, u.\`nickname\`
       FROM \`token\` t LEFT JOIN \`user\` u ON u.\`id\` = t.\`user_id\`
      WHERE ${where.join(' AND ')} LIMIT 1`,
    params,
  );
  const target = rows[0];
  assertBusiness(Boolean(target), '会话不存在或无权操作');

  const revoked = await revokeSessionBySessionId(sessionId);
  await recordLoginLog({
    userId: Number(target!.user_id ?? 0),
    username: String(target!.username ?? ''),
    nickname: String(target!.nickname ?? ''),
    behavior: 'kick',
    status: true,
    message: '管理员强制下线',
    meta: await collectRequestMeta(event),
  });

  return { revoked };
});
