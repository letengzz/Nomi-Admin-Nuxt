/** 改自己的安全手机 / 安全邮箱。必须带当前密码，服务端验过才落库。 */
import { defineAdminHandler } from '../../../utils/auth/handler';
import { updateSelfContact } from '../../../utils/auth/profile-service';
import { ok } from '../../../utils/http';

export default defineAdminHandler({ log: 'layout.profile.security' }, async (event, context) => {
  const body = (await readBody(event)) as Record<string, unknown> | undefined;
  return ok(
    await updateSelfContact(context.admin.id, {
      field: body?.field,
      value: body?.value,
      password: body?.password,
    }),
  );
});
