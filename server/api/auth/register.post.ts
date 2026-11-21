/**
 * 注册接口。写入 `user` 表，默认分配「普通用户」角色（只有仪表盘 + 个人中心）。
 *
 * 账号不再有「类型」：注册出来的账号和后台新建的账号是同一种东西，
 * 差别只在角色。默认角色是普通用户，需要更多权限由管理员在「用户管理」里调。
 *
 * 与旧的内存版相比，这里多了三件真实系统必须有的事：
 *   · 唯一索引兜住并发重名（先查再插只能挡住普通情况，最终一致性靠 DB 约束）；
 *   · 密码 scrypt 哈希后入库，明文只在内存里存在几毫秒；
 *   · 响应业务码仍为 200，注册页不用改。
 */
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { definePublicHandler } from '../../utils/auth/handler';
import { ApiError } from '../../utils/http';
import { getPool } from '../../database/pool';
import { hashPassword } from '../../utils/auth/password';
import { DEFAULT_ROLE_ID } from '../../database/seed';
import { loadSystemConfig } from '../../utils/system-config';
import { nowSeconds } from '../../utils/auth/token';

const USERNAME_MIN = 3;
const USERNAME_MAX = 20;
const PASSWORD_MIN = 6;
const USERNAME_PATTERN = /^[A-Za-z0-9_-]+$/;

export default definePublicHandler(async (event) => {
  // 注册开关是服务端的硬闸：只藏前端入口的话，直接调接口照样能注册。
  const config = await loadSystemConfig();
  if (!config.login.registrationEnabled) throw new ApiError('当前未开放注册');

  const body = await readBody<{
    userName?: unknown;
    password?: unknown;
    agreement?: unknown;
    policyVersion?: unknown;
    agreedAt?: unknown;
  }>(event);

  const userName = typeof body?.userName === 'string' ? body.userName.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  if (userName.length < USERNAME_MIN || userName.length > USERNAME_MAX) {
    throw new ApiError(`账号长度需在 ${USERNAME_MIN}-${USERNAME_MAX} 个字符之间`);
  }
  if (!USERNAME_PATTERN.test(userName)) throw new ApiError('账号只能包含字母、数字、下划线和短横线');
  if (password.length < PASSWORD_MIN) throw new ApiError(`密码不能少于 ${PASSWORD_MIN} 位`);
  if (body?.agreement !== true) throw new ApiError('请先阅读并同意隐私政策');

  const pool = getPool();
  const [exists] = await pool.query<Array<{ id: number } & RowDataPacket>>(
    'SELECT `id` FROM `user` WHERE `username` = ? LIMIT 1',
    [userName],
  );
  if (exists.length > 0) throw new ApiError('该账号已被注册', 409);

  const ts = nowSeconds();
  const passwordHash = await hashPassword(password);
  let adminId: number;
  try {
    const [result] = await pool.query<ResultSetHeader>(
      'INSERT INTO `user` (`username`,`nickname`,`password`,`status`,`create_time`,`update_time`) VALUES (?,?,?,?,?,?)',
      [userName, userName, passwordHash, 'enable', ts, ts],
    );
    adminId = result.insertId;
  } catch (error) {
    // 并发注册时先查后插会同时通过，唯一索引是最后一道闸。
    if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
      throw new ApiError('该账号已被注册', 409);
    }
    throw error;
  }

  // 默认角色可能被人删了：挂不上角色也要让注册成功，管理员事后补授权即可。
  await pool.query('INSERT IGNORE INTO `user_role` (`user_id`,`role_id`) VALUES (?,?)', [
    adminId,
    DEFAULT_ROLE_ID,
  ]);

  return {
    code: 200,
    msg: 'ok',
    data: {
      userId: String(adminId),
      userName,
      // 留痕：同意协议的版本与时间（当前没有落表，扩展时加到 admin 表即可）
      policyVersion: typeof body?.policyVersion === 'string' ? body.policyVersion : '1.0',
      agreedAt: typeof body?.agreedAt === 'string' ? body.agreedAt : new Date().toISOString(),
    },
  };
});
