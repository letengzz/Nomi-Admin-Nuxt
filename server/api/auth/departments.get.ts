/**
 * 登录页的「选择部门」下拉数据。
 *
 * 免登录接口，所以只给 id / pid / name —— 部门树本身不是秘密（登录页要展示），
 * 但负责人、电话、人数这些就不该对外了。
 */
import { definePublicHandler } from '../../utils/auth/handler';
import { listEnabledDepartments } from '../../utils/auth/department-service';

export default definePublicHandler(async () => {
  const list = await listEnabledDepartments();
  return { list };
});
