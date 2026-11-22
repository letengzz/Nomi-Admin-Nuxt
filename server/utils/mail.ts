/**
 * 极简 SMTP 发信客户端（只实现「投递一封邮件」这一条路径）。
 *
 * 为什么要自己写而不是装 nodemailer：本仓库的依赖表刻意保持精简，而找回密码只需要
 * 22 个 SMTP 动词（EHLO / STARTTLS / AUTH LOGIN / MAIL / RCPT / DATA / QUIT）。
 * 为这一个场景引入一个附带几十个传递依赖的库，收益抵不上供应链面。
 *
 * 正文支持两种形态，由调用方决定：
 *   · 只有 `text`  → `text/plain` 单段（最不容易被判成钓鱼，也最省事）；
 *   · 给了 `html` → `multipart/alternative`，纯文本与 HTML 各一段，客户端自选。
 *     HTML 模板见 `mail-template.ts`。
 *
 * 支持的形态与系统配置里 `email.encryption` 的三个取值一一对应：
 *   · `ssl`  → 465 直连 TLS（connect 即握手）
 *   · `tls`  → 587 明文连接后 STARTTLS 升级
 *   · `none` → 25 明文（只建议在内网中继上用）
 *
 * 明确**不做**的事：不重试、不排队、不解析 DSN 退信。发信失败就抛 `MailError`，
 * 由调用方决定怎么提示 —— 找回密码接口宁可告诉用户「稍后再试」，
 * 也不该假装成功让对方在收件箱前一直等。
 */
import { connect as connectTcp, type Socket } from 'node:net';
import { connect as connectTls } from 'node:tls';
import type { EmailConfig } from './system-config';

/** 建立连接的超时。SMTP 服务器卡住时不该把接口一起拖死。 */
const CONNECT_TIMEOUT_MS = 10_000;

/** 单条命令的响应超时（DATA 阶段服务器要落盘，给得比握手宽一点）。 */
const COMMAND_TIMEOUT_MS = 20_000;

export class MailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MailError';
  }
}

export interface MailMessage {
  to: string;
  subject: string;
  /** 纯文本版本。**始终必填**：它是降级通道，也是反垃圾邮件评分的一部分。 */
  text: string;
  /** 可选 HTML 版本。给了就发 multipart/alternative，没给就是纯文本单段。 */
  html?: string;
}

interface SmtpReply {
  code: number;
  lines: string[];
}

/** 头部字段不允许有换行：否则 `to` 里塞一个 `\r\nBcc: ...` 就能改写信封。 */
function assertSingleLine(value: string, field: string): string {
  if (/[\r\n]/.test(value)) throw new MailError(`${field} 不能包含换行`);
  return value;
}

/** 非 ASCII 主题 / 显示名按 RFC 2047 编码，否则中文主题在多数客户端是乱码。 */
function encodeHeaderWord(value: string): string {
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

/** base64 正文按 76 列折行（RFC 2045）。折行后也不会出现以 `.` 开头的行，无需 dot-stuffing。 */
function wrapBase64(encoded: string): string {
  return encoded.replace(/(.{76})/g, '$1\r\n');
}

/** 单段正文的 base64 编码结果，后面给 multipart 复用。 */
function encodeBody(value: string): string {
  return wrapBase64(Buffer.from(value, 'utf8').toString('base64'));
}

/**
 * 拼 multipart/alternative：纯文本在前、HTML 在后。
 *
 * 顺序不是随意的 —— RFC 2046 规定「越靠后的部分越贴近用户看到的最终形态」，
 * 客户端据此挑最后一个它能渲染的。反过来写，Gmail 会一直显示纯文本。
 *
 * boundary 必须不出现在正文里：base64 只用 `A-Za-z0-9+/=`，加上 `--nomi-` 前缀
 * 与随机串，撞车的概率可以忽略。
 */
function buildAlternative(text: string, html: string): { header: string[]; body: string } {
  const boundary = `--nomi-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const body = [
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    encodeBody(text),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    encodeBody(html),
    `--${boundary}--`,
  ].join('\r\n');

  return {
    // 不写顶层 Content-Transfer-Encoding：multipart 容器的传输编码没有意义，
    // 每段自己声明就够了。老客户端不认识 alternative 时会退化成显示第一段纯文本，
    // 这正是把 text 放在前面的原因。
    header: [`Content-Type: multipart/alternative; boundary="${boundary}"`],
    body,
  };
}

/**
 * 拼一封 MIME 邮件。
 *
 * 正文整体 base64：中文不会被 7bit 通道截断，也天然规避了「正文里一行只有 `.`
 * 会被当成结束符」这个经典坑。
 */
export function buildMimeMessage(config: EmailConfig, message: MailMessage): string {
  const fromAddress = assertSingleLine(config.fromAddress.trim(), '发件地址');
  const fromName = config.fromName.trim();
  const to = assertSingleLine(message.to.trim(), '收件地址');
  const subject = encodeHeaderWord(assertSingleLine(message.subject.trim(), '邮件主题'));

  const from = fromName ? `${encodeHeaderWord(fromName)} <${fromAddress}>` : fromAddress;
  const domain = fromAddress.split('@')[1] ?? 'localhost';
  const html = message.html?.trim();

  const content = html
    ? buildAlternative(message.text, html)
    : {
        header: ['Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64'],
        body: encodeBody(message.text),
      };

  return [
    `Date: ${new Date().toUTCString()}`,
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Message-ID: <${Date.now()}.${Math.random().toString(36).slice(2)}@${domain}>`,
    'MIME-Version: 1.0',
    ...content.header,
    '',
    content.body,
  ].join('\r\n');
}

/**
 * 一条 SMTP 连接。只做「发一行、读一个完整响应」，把协议细节关在这里。
 *
 * 响应可能是多行（`250-XXX` 若干行 + `250 XXX` 结束），所以不能简单地「读一行算一个响应」：
 * 必须攒到分隔符是空格的最后一行才算收完。
 */
class SmtpConnection {
  private socket: Socket;
  private buffer = '';
  private queue: SmtpReply[] = [];
  private current: { code: number; lines: string[] } | null = null;
  private waiters: Array<{ resolve: (reply: SmtpReply) => void; reject: (error: Error) => void }> =
    [];
  private failure: Error | null = null;

  constructor(socket: Socket) {
    this.socket = this.attach(socket);
  }

  private attach(socket: Socket): Socket {
    // 不用 setEncoding：STARTTLS 升级会把底层 socket 交给 tls 模块，
    // 那时它必须是原始 Buffer 通道。
    socket.on('data', (chunk: Buffer) => this.feed(chunk.toString('utf8')));
    socket.on('error', (error: Error) => this.fail(new MailError(`SMTP 连接异常：${error.message}`)));
    socket.on('close', () => this.fail(new MailError('SMTP 连接被服务器关闭')));
    socket.setTimeout(COMMAND_TIMEOUT_MS, () => this.fail(new MailError('等待 SMTP 响应超时')));
    return socket;
  }

  private feed(chunk: string): void {
    this.buffer += chunk;
    let index = this.buffer.indexOf('\r\n');
    while (index >= 0) {
      const line = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 2);
      this.consumeLine(line);
      if (this.failure) return;
      index = this.buffer.indexOf('\r\n');
    }
  }

  private consumeLine(line: string): void {
    const match = /^(\d{3})([- ])?(.*)$/.exec(line);
    if (!match) {
      this.fail(new MailError(`无法解析的 SMTP 响应：${line.slice(0, 80)}`));
      return;
    }
    const code = Number(match[1]);
    const separator = match[2] ?? ' ';
    if (!this.current || this.current.code !== code) this.current = { code, lines: [] };
    this.current.lines.push(match[3] ?? '');

    if (separator !== '-') {
      const reply = this.current;
      this.current = null;
      this.deliver(reply);
    }
  }

  private deliver(reply: SmtpReply): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve(reply);
    else this.queue.push(reply);
  }

  private fail(error: Error): void {
    if (this.failure) return;
    this.failure = error;
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
    this.socket.destroy();
  }

  /** 读一个响应。已经有排队的直接给，没有就等 —— 超时由 socket 计时器兜。 */
  readReply(): Promise<SmtpReply> {
    const ready = this.queue.shift();
    if (ready) return Promise.resolve(ready);
    if (this.failure) return Promise.reject(this.failure);
    return new Promise<SmtpReply>((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }

  /** 发一行命令并读响应，不判状态码。给「允许降级重试」的场景用（EHLO → HELO）。 */
  async raw(line: string): Promise<SmtpReply> {
    if (this.failure) throw this.failure;
    this.socket.write(`${line}\r\n`);
    return this.readReply();
  }

  /** 发一行命令并读响应，校验状态码在白名单里。 */
  async command(line: string, expected: readonly number[]): Promise<SmtpReply> {
    const reply = await this.raw(line);
    if (!expected.includes(reply.code)) {
      // 只回显状态码与命令动词，绝不回显整行 —— AUTH 阶段那一行里有口令。
      throw new MailError(`SMTP ${line.split(' ')[0]} 被拒绝（${reply.code}）`);
    }
    return reply;
  }

  /** 明文连接 → STARTTLS 升级。升级后必须重新 EHLO，能力集是新的。 */
  async startTls(host: string): Promise<void> {
    const plain = this.socket;
    plain.removeAllListeners('data');
    plain.removeAllListeners('error');
    plain.removeAllListeners('close');
    plain.removeAllListeners('timeout');
    plain.setTimeout(0);
    plain.pause();

    const secure = connectTls({ socket: plain, servername: host, rejectUnauthorized: true });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new MailError('TLS 握手超时')),
        CONNECT_TIMEOUT_MS,
      );
      secure.once('secureConnect', () => {
        clearTimeout(timer);
        resolve();
      });
      secure.once('error', (error: Error) => {
        clearTimeout(timer);
        reject(new MailError(`TLS 握手失败：${error.message}`));
      });
    });

    // 握手成功后换掉通道，清掉明文阶段残留的半个响应。
    this.buffer = '';
    this.queue = [];
    this.current = null;
    this.failure = null;
    this.socket = this.attach(secure);
  }

  close(): void {
    this.socket.destroy();
  }
}

/** 建立 TCP / TLS 连接，等到可写再返回。 */
function openSocket(config: EmailConfig): Promise<Socket> {
  const host = config.host.trim();
  const port = Number(config.port) || 465;
  return new Promise<Socket>((resolve, reject) => {
    const secure = config.encryption === 'ssl';
    const socket = secure
      ? connectTls({ host, port, servername: host, rejectUnauthorized: true })
      : connectTcp({ host, port });

    const timer = setTimeout(() => {
      socket.destroy();
      reject(new MailError('连接邮件服务器超时'));
    }, CONNECT_TIMEOUT_MS);

    socket.once(secure ? 'secureConnect' : 'connect', () => {
      clearTimeout(timer);
      socket.setTimeout(0);
      resolve(socket);
    });
    socket.once('error', (error: Error) => {
      clearTimeout(timer);
      socket.destroy();
      reject(new MailError(`无法连接邮件服务器：${error.message}`));
    });
  });
}

/** SMTP 要求 EHLO 给个域名，取发件地址的域名即可，不必是本机主机名。 */
function heloHost(config: EmailConfig): string {
  return config.fromAddress.split('@')[1]?.trim() || 'localhost';
}

/** 配置是否足以发信。缺任何一项都算「未配置」，调用方据此关闭自助找回密码。 */
export function isMailConfigured(config: EmailConfig | undefined | null): boolean {
  if (!config) return false;
  return Boolean(
    config.enabled &&
      config.host?.trim() &&
      Number(config.port) > 0 &&
      config.fromAddress?.trim() &&
      /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(config.fromAddress.trim()),
  );
}

/**
 * 投递一封邮件。失败抛 `MailError`。
 *
 * 调用方务必保证 `to` 是**库里已绑定的地址**，而不是请求体里传上来的值 ——
 * 否则这个函数就成了「任意收件人」的垃圾邮件发射器。
 */
export async function sendMail(config: EmailConfig, message: MailMessage): Promise<void> {
  if (!isMailConfigured(config)) throw new MailError('邮件服务未配置');
  const to = message.to.trim();
  if (!/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(to)) throw new MailError('收件地址格式不正确');

  const socket = await openSocket(config);
  const connection = new SmtpConnection(socket);
  try {
    const helo = heloHost(config);
    // 先读欢迎语再开口说话：不读的话，下面第一句 EHLO 读到的是这条 220，
    // 后面整条会话就错位了（真实服务器上表现为「握手被拒绝（220）」）。
    const banner = await connection.readReply();
    if (banner.code !== 220) throw new MailError(`SMTP 服务未就绪（${banner.code}）`);

    // 个别老服务器只认 HELO：EHLO 被 500/502 拒时降级重试一次。
    let greeting = await connection.raw('EHLO ' + helo);
    if (greeting.code >= 500) greeting = await connection.raw('HELO ' + helo);
    if (greeting.code !== 250) throw new MailError(`SMTP 握手被拒绝（${greeting.code}）`);

    if (config.encryption === 'tls') {
      await connection.command('STARTTLS', [220]);
      await connection.startTls(config.host.trim());
      await connection.command('EHLO ' + heloHost(config), [250]);
    }

    if (config.username.trim()) {
      await connection.command('AUTH LOGIN', [334]);
      await connection.command(Buffer.from(config.username.trim(), 'utf8').toString('base64'), [334]);
      await connection.command(Buffer.from(config.password, 'utf8').toString('base64'), [235]);
    }

    const from = config.fromAddress.trim();
    await connection.command(`MAIL FROM:<${from}>`, [250]);
    await connection.command(`RCPT TO:<${to}>`, [250, 251]);
    await connection.command('DATA', [354]);
    const mime = buildMimeMessage(config, { ...message, to });
    // 结束符必须是「单独一行的句点」。正文已 base64，不会出现以句点开头的行。
    await connection.command(`${mime}\r\n.`, [250]);
    await connection.command('QUIT', [221]).catch(() => undefined);
  } finally {
    connection.close();
  }
}
