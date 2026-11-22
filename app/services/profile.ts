/**
 * 个人中心接口封装。
 *
 * 三个接口都不带 id：动的是谁由服务端的 token 决定。前端少一个参数，
 * 也就少一个「传错 id 改到别人」的可能。
 */
import { apiFetch } from '../utils/request';

export interface SelfRole {
  id: number;
  name: string;
}

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
  isSuper: boolean;
  createTime: number;
  lastLoginTime: number;
  lastLoginIp: string;
  security: {
    mobile: boolean;
    email: boolean;
    password: boolean;
  };
  /** 还在用初始 / 重置口令：界面要把用户按到改密流程上 */
  mustChangePassword: boolean;
  thirdParty: {
    qq: boolean;
    wechat: boolean;
  };
}

export type ContactField = 'mobile' | 'email';

export function fetchSelfProfile(): Promise<SelfProfile> {
  return apiFetch<SelfProfile>('/api/admin/profile');
}

/** 改安全手机 / 安全邮箱：password 是当前登录密码，服务端会再验一次。 */
export function updateSelfContact(payload: {
  field: ContactField;
  value: string;
  password: string;
}): Promise<{ field: ContactField; value: string }> {
  return apiFetch<{ field: ContactField; value: string }>('/api/admin/profile/contact', {
    method: 'POST',
    body: payload,
  });
}

/** 改登录密码。成功后服务端会清掉其他设备上的登录态。 */
export function changeSelfPassword(payload: {
  oldPassword: string;
  newPassword: string;
}): Promise<boolean> {
  return apiFetch<boolean>('/api/admin/profile/password', {
    method: 'POST',
    body: payload,
  });
}
