/**
 * 接口守卫。等价于文档里「控制器继承 Backend」这件事：
 * 每个管理端接口都用 `defineAdminHandler('节点名', handler)` 包一层，
 * 想漏鉴权必须**主动**绕开它 —— 而不是忘记写中间件就漏了。
 *
 * 一个请求的完整顺序（对应文档 3.6 `Backend::initialize()`）：
 *   1. ensureDatabase：库/表/种子就绪（幂等，只在首次真正执行）
 *   2. resolveAdmin：token → 管理员 → 权限上下文（303 / 409 在这里返回）
 *   3. check(node)：已登录但没节点 → 401
 *   4. 执行业务 handler
 *   5. 非 GET 写操作日志：Trace ID、耗时、请求/响应头体、状态、客户端信息
 *
 * 第 5 步在 try/catch 的**两侧**各写一次：失败请求同样要留痕，
 * 否则排障时只能看到「成功的那些」，出错的那次恰好没有。
 */
import type { H3Event } from 'h3';
import { ensureDatabase } from '../../database/init';
import { ApiError, BusinessCode, fail, ok, type ApiEnvelope } from '../http';
import { recordAdminLog } from './admin-log';
import {
  collectRequestMeta,
  moduleFromPath,
  newTraceId,
  requestHeadersForLog,
  responseHeadersForLog,
  truncate,
} from './request-meta';
import { check, type AdminContext } from './rbac';
import { resolveAdmin } from './session';
import { loadSystemConfig } from '../system-config';

declare module 'h3' {
  interface H3EventContext {
    /** defineAdminHandler 写入的当前管理员摘要，日志/审计用 */
    admin?: {
      id: number;
      username: string;
      nickname: string;
      isSuper: boolean;
      token: string;
    };
    /** 本次请求的追踪 ID，写操作日志时也落一份 */
    traceId?: string;
  }
}

export interface AdminHandlerOptions {
  /** 权限节点名，如 `system/role/add`；传数组时按 relation 合并判定 */
  node?: string | string[];
  relation?: 'or' | 'and';
  /** 仅超管可用（对应文档 5.8 的 isSuperAdmin 显式判断） */
  superOnly?: boolean;
  /** false = 不写操作日志；字符串 = 覆盖日志标题 */
  log?: boolean | string;
  /**
   * false = 本次请求不刷新「最后活跃」。
   * 给会话心跳这类**不是用户操作**的请求用：它只回答「token 还认不认」，
   * 若照常 touch，在线用户页里的「离开」状态就永远不会出现。
   */
  touch?: boolean;
  /**
   * true = 维护模式下也放行。
   * 只给「拉取权限数据」这类必须先成功、才能判断对方是不是超管的接口用。
   */
  bypassMaintenance?: boolean;
  /**
   * true = 账号还没改初始密码时也放行。
   *
   * 只给「改密流程本身离不开」的接口用：拉菜单（改密页也在后台布局里）、
   * 看自己的资料、改自己的密码、退出登录、会话心跳。
   * 其它接口一律回 428 —— 少写一个 true 的后果是「改完密码才能用」，
   * 而不是「没改密码也能用」，方向是安全的。
   */
  bypassPasswordChange?: boolean;
}

export type AdminHandler = (event: H3Event, context: AdminContext) => Promise<unknown> | unknown;

const MAX_RESPONSE_LOG = 12_000;

function isEnvelope(value: unknown): value is ApiEnvelope {
  return typeof value === 'object' && value !== null && 'code' in value && 'msg' in value;
}

/** 上游网关传了 x-trace-id 就沿用，方便把一次调用串起来；否则自己生成一个。 */
function traceIdFromRequest(event: H3Event): string {
  const raw = event.node.req.headers['x-trace-id'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 40) : newTraceId();
}

/** 数据库错误 → 人话。运维最需要看到的是「是配置问题还是 MySQL 没起」。 */
function databaseErrorMessage(error: unknown): string | undefined {
  const code = (error as { code?: string } | null)?.code;
  if (!code) return undefined;
  const known: Record<string, string> = {
    ECONNREFUSED: 'MySQL 未启动或端口不对（MYSQL_HOST / MYSQL_PORT）',
    ETIMEDOUT: '连接 MySQL 超时（检查网络与防火墙）',
    ENOTFOUND: 'MySQL 主机名解析失败（MYSQL_HOST）',
    ER_ACCESS_DENIED_ERROR: 'MySQL 账号或密码错误（MYSQL_USER / MYSQL_PASSWORD）',
    ER_BAD_DB_ERROR: '数据库不存在且自动创建失败（检查 MYSQL_USER 是否有 CREATE 权限）',
    ER_DBACCESS_DENIED_ERROR: '当前 MySQL 账号没有该库的访问权限',
  };
  const hint = known[code];
  return hint ? `数据库不可用：${hint}` : `数据库错误：${code}`;
}

function toFailure(event: H3Event, error: unknown): ApiEnvelope {
  if (error instanceof ApiError) return fail(error.message, error.code);

  const dbMessage = databaseErrorMessage(error);
  if (dbMessage) {
    console.error('[api] 数据库异常', error);
    return fail(dbMessage, BusinessCode.FAIL);
  }

  console.error('[api] 未处理异常', error);
  const message = error instanceof Error ? error.message : String(error);
  // 生产环境不把内部错误原文透给前端：SQL 片段、文件路径都可能出现在里面。
  const safeMessage = process.env.NODE_ENV === 'production' ? '服务器内部错误' : message;
  return fail(safeMessage, BusinessCode.FAIL);
}

async function run(event: H3Event, handler: () => Promise<unknown>): Promise<unknown> {
  try {
    const result = await handler();
    return isEnvelope(result) ? result : ok(result);
  } catch (error) {
    // 业务码协议要求 HTTP 200：前端只看 body.code。
    setResponseStatus(event, 200);
    return toFailure(event, error);
  }
}

function stringifyResponse(value: unknown): string {
  try {
    return truncate(JSON.stringify(value) ?? '', MAX_RESPONSE_LOG);
  } catch {
    return '[unserializable response]';
  }
}

/**
 * 管理端接口。用法：
 *   export default defineAdminHandler('system/role/index', async (event, ctx) => { ... })
 */
export function defineAdminHandler(
  nodeOrOptions: string | string[] | AdminHandlerOptions,
  handler: AdminHandler,
): ReturnType<typeof defineEventHandler> {
  const options: AdminHandlerOptions =
    typeof nodeOrOptions === 'string' || Array.isArray(nodeOrOptions)
      ? { node: nodeOrOptions }
      : nodeOrOptions;

  return defineEventHandler((event) =>
    run(event, async () => {
      await ensureDatabase();

      const started = Date.now();
      const traceId = traceIdFromRequest(event);
      setResponseHeader(event, 'x-trace-id', traceId);
      event.context.traceId = traceId;

      // 1) 身份：303 未登录 / 409 过期
      const auth = await resolveAdmin(event, { touch: options.touch !== false });
      if (!auth.ok) return fail(auth.msg, auth.code);

      const context = auth.context;

      // 0) 初始口令未改：除改密流程本身外一律拒绝。
      //    放在 RBAC 之前 —— 这不是「权限不够」，而是「账号还没完成激活」，
      //    报「没有权限」会让用户去找管理员要授权，方向完全错了。
      if (context.mustChangePassword && !options.bypassPasswordChange) {
        return fail('请先修改初始密码后再使用其他功能', BusinessCode.NEED_PASSWORD_CHANGE);
      }

      // 维护模式：服务端也要挡，光靠前端路由跳走的话，普通用户直接调接口仍能用系统。
      // 超管放行 —— 否则一旦打开维护模式，就没人能进设置页把它关掉了。
      const accessConfig = await loadSystemConfig();
      if (
        !options.bypassMaintenance &&
        accessConfig.login.maintenanceEnabled &&
        !context.isSuper
      ) {
        return fail('系统维护中，请稍后再试', BusinessCode.NO_PERMISSION);
      }

      // 2) 路由级 RBAC：401 无权限
      const nodes = options.node
        ? (Array.isArray(options.node) ? options.node : [options.node]).filter(Boolean)
        : [];
      if (nodes.length > 0 && !check(context, nodes.join(','), options.relation ?? 'or')) {
        return fail(`没有权限执行此操作（${nodes.join(',')}）`, BusinessCode.NO_PERMISSION);
      }
      if (options.superOnly && !context.isSuper) {
        return fail('仅超级管理员可执行此操作', BusinessCode.NO_PERMISSION);
      }

      event.context.admin = {
        id: context.admin.id,
        username: context.admin.username,
        nickname: context.admin.nickname,
        isSuper: context.isSuper,
        token: context.token,
      };

      // 读接口不写日志：几百个列表请求会把真正有用的写操作淹掉。
      const audit = options.log !== false && event.method !== 'GET' && event.method !== 'HEAD';

      async function writeAudit(
        result: unknown,
        status: 'success' | 'fail',
        errorMsg: string,
      ): Promise<void> {
        const url = getRequestURL(event).pathname;
        const title =
          typeof options.log === 'string'
            ? options.log
            : (context.rules.find((rule) => nodes.includes(rule.name))?.title ?? nodes[0] ?? url);
        const meta = await collectRequestMeta(event, traceId);
        await recordAdminLog({
          userId: context.admin.id,
          username: context.admin.username,
          url,
          title,
          module: moduleFromPath(url),
          status,
          duration: Date.now() - started,
          errorMsg,
          data: await readBody(event).catch(() => undefined),
          requestHeaders: requestHeadersForLog(event),
          responseHeaders: responseHeadersForLog(event),
          responseBody: stringifyResponse(isEnvelope(result) ? result : ok(result)),
          meta,
        });
      }

      // 3) 业务
      let data: unknown;
      try {
        data = await handler(event, context);
      } catch (error) {
        if (audit) {
          await writeAudit(
            fail(error instanceof Error ? error.message : String(error),
              error instanceof ApiError ? error.code : BusinessCode.FAIL),
            'fail',
            error instanceof Error ? error.message : String(error),
          );
        }
        throw error;
      }

      // 4) 审计：成功也留痕，响应体是服务端真正回出去的那个包。
      if (audit) await writeAudit(data, 'success', '');

      return data;
    }),
  );
}

/** 免登录接口（登录、续期、注册、找回密码）。仍然保证 DB 就绪与统一错误包。 */
export function definePublicHandler(
  handler: (event: H3Event) => Promise<unknown> | unknown,
): ReturnType<typeof defineEventHandler> {
  return defineEventHandler((event) =>
    run(event, async () => {
      await ensureDatabase();
      return handler(event);
    }),
  );
}
