/**
 * 个人中心（自助服务）。
 *
 * 和 user-service 的分界线很清楚：
 *   · user-service 是「管理员管别人」—— 要看数据范围（部门树）、要判断
 *     `operable`（同级不能管同级），入参里必须带 id；
 *   · 这里是「我自己管我自己」—— 目标账号只从 token 里取，**不接受 id**。
 *
 * 正因为只动自己，这几个接口不挂 RBAC 节点：一个只被分配了仪表盘的角色，
 * 照样应该能改自己的密码。权限边界在这里是「登录态」而不是某个节点。
 *
 * 三件事共用一条安全规则：改手机 / 改邮箱 / 改密码都要先验当前密码。
 * 没有短信网关、没有邮件回执，当前密码就是唯一能证明「是本人」的东西。
 */
import type { RowDataPacket } from 'mysql2/promise';
import { getPool } from '../../database/pool';
import { ApiError } from '../http';
import { checkPasswordStrength, hashPassword, verifyPassword } from './password';
import { removeInitialPasswordFile } from './initial-password';
import { parseRules } from './rbac';
import {
  findToken,
  digestToken,
  nowSeconds,
  TOKEN_TYPE_ADMIN,
  TOKEN_TYPE_ADMIN_REFRESH,
} from './token';

/** 与 user-service 的账号字段校验保持同一口径，避免「后台能建、自己改不了」。 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE_PATTERN = /^[0-9+\-() ]{5,20}$/;
const EMAIL_MAX = 100;
const MOBILE_MAX = 20;

export type ContactField = 'mobile' | 'email';

export interface SelfRole {
  id: number;
  name: string;
}

/**
 * 个人中心需要的那一份资料。
 *
 * 不复用 `/api/admin/init` 的 adminInfo：那份是「登录态快照」，只关心能不能进后台；
 * 个人中心还要部门名、注册时间、性别、安全项状态 —— 塞进 init 会让每次登录都
 * 多查两张表，而绝大多数请求并不需要它们。
 */
export interface SelfProfile {
  id: number;
  username: string;
  nickname: string;
  avatar: string;
  email: string;
  mobile: string;
  motto: string;
  /** unknown 保密 / male 男 / female 女 */
  gender: string;
  status: string;
  departmentId: number;
  departmentName: string;
  roles: SelfRole[];
  /** 仅用于界面上的「超管」标记，不是权限依据 */
  isSuper: boolean;
  createTime: number;
  lastLoginTime: number;
  lastLoginIp: string;
  security: {
    mobile: boolean;
    email: boolean;
    /** 密码永远有值（登录必须有密码），保留字段是为了让界面不必知道这个前提 */
    password: boolean;
  };
  /**
   * true = 还在用初始 / 重置口令，界面必须先把用户按到改密流程上。
   * 与登录响应里的同名字段同源（`user.must_change_password`）。
   */
  mustChangePassword: boolean;
  /**
   * 第三方账号绑定状态。
   *
   * 目前恒为 false：项目还没有接 QQ 互联 / 微信开放平台（没有 clientId、
   * 没有回调路由）。字段先按「将来会长这样」返回，前端就不用等接口改版。
   */
  thirdParty: {
    qq: boolean;
    wechat: boolean;
  };
}

interface ProfileRow extends RowDataPacket {
  id: number;
  username: string;
  department_id: number;
  department_name: string | null;
  nickname: string;
  avatar: string;
  email: string;
  mobile: string;
  motto: string;
  gender: string;
  status: string;
  password: string;
  last_login_time: number;
  last_login_ip: string;
  create_time: number;
  must_change_password: number;
}

interface RoleRow extends RowDataPacket {
  id: number;
  name: string;
  rules: string | null;
}

async function findProfileRow(adminId: number): Promise<ProfileRow> {
  const pool = getPool();
  const [rows] = await pool.query<ProfileRow[]>(
    `SELECT u.\`id\`, u.\`username\`, u.\`department_id\`, d.\`name\` AS \`department_name\`,
            u.\`nickname\`, u.\`avatar\`, u.\`email\`, u.\`mobile\`, u.\`motto\`, u.\`gender\`,
            u.\`status\`, u.\`password\`, u.\`last_login_time\`, u.\`last_login_ip\`, u.\`create_time\`,
            u.\`must_change_password\`
       FROM \`user\` u
       LEFT JOIN \`department\` d ON d.\`id\` = u.\`department_id\`
      WHERE u.\`id\` = ?
      LIMIT 1`,
    [adminId],
  );
  const row = rows[0];
  if (!row) throw new ApiError('账号不存在，请重新登录', 303);
  return row;
}

/** 只取启用角色：停用的角色不该出现在「我是谁」的页面上。 */
async function findProfileRoles(adminId: number): Promise<RoleRow[]> {
  const pool = getPool();
  const [rows] = await pool.query<RoleRow[]>(
    `SELECT r.\`id\`, r.\`name\`, r.\`rules\`
       FROM \`role\` r
       INNER JOIN \`user_role\` ur ON ur.\`role_id\` = r.\`id\`
      WHERE ur.\`user_id\` = ? AND r.\`status\` = 1
      ORDER BY r.\`id\` ASC`,
    [adminId],
  );
  return rows;
}

export async function getSelfProfile(adminId: number): Promise<SelfProfile> {
  const [row, roles] = await Promise.all([findProfileRow(adminId), findProfileRoles(adminId)]);

  return {
    id: row.id,
    username: row.username,
    nickname: row.nickname,
    avatar: row.avatar,
    email: row.email,
    mobile: row.mobile,
    motto: row.motto,
    gender: row.gender,
    status: row.status,
    departmentId: Number(row.department_id ?? 0),
    departmentName: row.department_name ?? '',
    roles: roles.map((role) => ({ id: Number(role.id), name: role.name })),
    // `*` 哨兵只可能在超管角色的规则串里，与 loadAdminContext 的判定同源。
    isSuper: roles.some((role) => parseRules(role.rules).includes('*')),
    createTime: Number(row.create_time ?? 0),
    lastLoginTime: Number(row.last_login_time ?? 0),
    lastLoginIp: row.last_login_ip ?? '',
    security: {
      mobile: Boolean(row.mobile),
      email: Boolean(row.email),
      password: Boolean(row.password),
    },
    thirdParty: { qq: false, wechat: false },
    mustChangePassword: Number(row.must_change_password ?? 0) === 1,
  };
}

/** 验当前密码。错就抛业务错误，文案里不区分「账号不存在」这类信息。 */
async function assertOwnPassword(adminId: number, password: string): Promise<void> {
  if (!password) throw new ApiError('请输入当前登录密码');
  const row = await findProfileRow(adminId);
  if (!(await verifyPassword(password, row.password))) {
    throw new ApiError('当前密码不正确');
  }
}

export async function updateSelfContact(
  adminId: number,
  input: { field: unknown; value: unknown; password: unknown },
): Promise<{ field: ContactField; value: string }> {
  const field = input.field === 'mobile' || input.field === 'email' ? input.field : undefined;
  if (!field) throw new ApiError('暂不支持修改这个字段');

  const value = typeof input.value === 'string' ? input.value.trim() : '';
  if (field === 'mobile') {
    if (!MOBILE_PATTERN.test(value) || value.length > MOBILE_MAX) {
      throw new ApiError('手机号格式不正确');
    }
  } else {
    if (!EMAIL_PATTERN.test(value) || value.length > EMAIL_MAX) {
      throw new ApiError('邮箱格式不正确');
    }
  }

  await assertOwnPassword(adminId, typeof input.password === 'string' ? input.password : '');

  const pool = getPool();
  await pool.query(`UPDATE \`user\` SET \`${field}\` = ?, \`update_time\` = ? WHERE \`id\` = ?`, [
    value,
    nowSeconds(),
    adminId,
  ]);
  return { field, value };
}

/**
 * 改自己的登录密码。
 *
 * 改完把**其他会话**踢掉：密码泄露的场景下，只改密码而不清登录态等于没改。
 * 当前这条会话保留 —— 用户刚在这个浏览器里操作，把他自己也踢出去只会被当成
 * 改密失败。清的是同 user_id 的其他 session_id（access + refresh 一起清），
 * 所以对方既调不动接口，也续不了期。
 *
 * ★ 这里是「初始口令」流程的出口，所以强度校验不能省：
 *   如果允许把初始口令改成 `123456`，那前面那套随机口令 + 强制改密就全白做了。
 *   顺带把 `must_change_password` 清零 —— 守卫按它放行其它接口。
 */
export async function changeSelfPassword(
  adminId: number,
  input: { oldPassword: unknown; newPassword: unknown },
): Promise<void> {
  const oldPassword = typeof input.oldPassword === 'string' ? input.oldPassword : '';
  const newPassword = typeof input.newPassword === 'string' ? input.newPassword : '';

  if (oldPassword && newPassword === oldPassword) {
    throw new ApiError('新密码不能与当前密码相同');
  }

  // 一次查询同时拿到旧密码哈希与账号名：账号名用于「密码里不能含账号名」。
  const row = await findProfileRow(adminId);
  if (!oldPassword) throw new ApiError('请输入当前登录密码');
  if (!(await verifyPassword(oldPassword, row.password))) throw new ApiError('当前密码不正确');

  const reason = checkPasswordStrength(newPassword, { username: row.username });
  if (reason) throw new ApiError(`新密码不符合要求：${reason}`);

  const pool = getPool();
  await pool.query(
    'UPDATE `user` SET `password` = ?, `login_failure` = 0, `must_change_password` = 0, `update_time` = ? WHERE `id` = ?',
    [await hashPassword(newPassword), nowSeconds(), adminId],
  );

  // 初始口令已经作废：磁盘上那份明文副本没有继续存在的理由。
  await removeInitialPasswordFile();
}

/**
 * 清掉除当前会话之外的登录态。token 表存的是摘要，所以「当前这条」要么按
 * session_id 认（同一对 access/refresh 共享它），要么退化成按摘要排除。
 */
export async function revokeOtherSessions(adminId: number, token: string): Promise<void> {
  const pool = getPool();
  const current = await findToken(token, TOKEN_TYPE_ADMIN);
  const sessionId = current?.session_id ?? '';

  if (sessionId) {
    await pool.query(
      'DELETE FROM `token` WHERE `user_id` = ? AND `type` IN (?,?) AND `session_id` <> ?',
      [adminId, TOKEN_TYPE_ADMIN, TOKEN_TYPE_ADMIN_REFRESH, sessionId],
    );
    return;
  }

  await pool.query('DELETE FROM `token` WHERE `user_id` = ? AND `type` IN (?,?) AND `token` <> ?', [
    adminId,
    TOKEN_TYPE_ADMIN,
    TOKEN_TYPE_ADMIN_REFRESH,
    digestToken(token),
  ]);
}
