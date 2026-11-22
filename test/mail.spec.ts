/**
 * SMTP 客户端单测。
 *
 * 自己写 SMTP 的风险在于「协议顺序错了但本地没人发现」——真实发信只在生产发生，
 * 出错就是「用户永远收不到验证码」。所以这里起一个**假的 SMTP 服务器**（纯 net，
 * 不打桩函数），让客户端真的走一遍 EHLO → AUTH LOGIN → MAIL → RCPT → DATA → QUIT，
 * 并断言服务器收到的字节。
 *
 * 用 `@vitest-environment node`：默认的 happy-dom 没有可用的 net 模块。
 */
// @vitest-environment node
import { createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { buildMimeMessage, isMailConfigured, sendMail, type MailMessage } from '../server/utils/mail';
import type { EmailConfig } from '../server/utils/system-config';

interface FakeSmtp {
  server: Server;
  port: number;
  /** 收到的完整会话文本（含 DATA 正文） */
  transcript: () => string;
  /** 等待客户端发出 QUIT 后 resolve */
  done: Promise<void>;
}

/**
 * 极简 SMTP 服务端。`authRequired` 打开时走 AUTH LOGIN 流程，
 * 多行 EHLO 响应（`250-`）也照真实服务器发，用来验证客户端的多行解析。
 */
async function startFakeSmtp(): Promise<FakeSmtp> {
  let transcript = '';
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  const server = createServer((socket) => {
    let buffer = '';
    let inData = false;
    let authStep = 0;
    socket.write('220 fake-smtp ESMTP ready\r\n');

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let index = buffer.indexOf('\r\n');
      while (index >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        index = buffer.indexOf('\r\n');

        if (inData) {
          transcript += `${line}\n`;
          if (line === '.') {
            inData = false;
            socket.write('250 2.0.0 queued\r\n');
          }
          continue;
        }

        const upper = line.toUpperCase();
        if (authStep > 0) {
          // AUTH 的两行是 base64(账号) / base64(口令)，单独记下来供断言
          transcript += `${line}\n`;
          authStep += 1;
          socket.write(authStep === 2 ? '334 UGFzc3dvcmQ6\r\n' : '235 2.7.0 accepted\r\n');
          if (authStep === 3) authStep = 0;
          continue;
        }

        transcript += `${line}\n`;
        if (upper.startsWith('EHLO')) {
          // 多行响应：客户端必须攒到分隔符为空格的那一行才算收完
          socket.write('250-fake-smtp greets you\r\n250-SIZE 10240000\r\n250 AUTH LOGIN\r\n');
        } else if (upper === 'AUTH LOGIN') {
          authStep = 1;
          socket.write('334 VXNlcm5hbWU6\r\n');
        } else if (upper.startsWith('MAIL FROM')) {
          socket.write('250 2.1.0 sender ok\r\n');
        } else if (upper.startsWith('RCPT TO')) {
          socket.write('250 2.1.5 recipient ok\r\n');
        } else if (upper === 'DATA') {
          inData = true;
          socket.write('354 end with <CRLF>.<CRLF>\r\n');
        } else if (upper === 'QUIT') {
          socket.write('221 bye\r\n');
          socket.end();
          resolveDone();
        } else if (upper.startsWith('HELO')) {
          socket.write('250 fake-smtp\r\n');
        } else {
          socket.write('502 command not implemented\r\n');
        }
      }
    });
    // 客户端关连接不影响断言
    socket.on('error', () => undefined);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { server, port, transcript: () => transcript, done };
}

function configFor(port: number, overrides: Partial<EmailConfig> = {}): EmailConfig {
  return {
    enabled: true,
    host: '127.0.0.1',
    port,
    encryption: 'none',
    fromAddress: 'noreply@nomi.dev',
    fromName: 'Nomi Admin',
    username: '',
    password: '',
    ...overrides,
  };
}

let running: FakeSmtp | undefined;

afterEach(() => {
  running?.server.close();
  running = undefined;
});

describe('isMailConfigured', () => {
  it('缺任何一项都视为未配置', () => {
    expect(isMailConfigured(undefined)).toBe(false);
    expect(isMailConfigured({ ...configFor(465), enabled: false })).toBe(false);
    expect(isMailConfigured({ ...configFor(465), host: '  ' })).toBe(false);
    expect(isMailConfigured({ ...configFor(465), port: 0 })).toBe(false);
    expect(isMailConfigured({ ...configFor(465), fromAddress: 'not-an-email' })).toBe(false);
  });

  it('配置齐全时为 true', () => {
    expect(isMailConfigured(configFor(465))).toBe(true);
  });
});

describe('buildMimeMessage', () => {
  const message: MailMessage = { to: 'user@example.com', subject: '重置密码验证码', text: '验证码 123456' };

  it('中文主题按 RFC 2047 编码，正文 base64', () => {
    const mime = buildMimeMessage(configFor(465), message);
    expect(mime).toContain('Subject: =?UTF-8?B?');
    expect(mime).toContain('Content-Transfer-Encoding: base64');
    const body = mime.split('\r\n\r\n')[1] ?? '';
    expect(Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8')).toBe('验证码 123456');
  });

  it('头部注入被拒绝（收件地址里塞换行）', () => {
    expect(() =>
      buildMimeMessage(configFor(465), {
        ...message,
        to: 'a@b.com\r\nBcc: victim@b.com',
      }),
    ).toThrow(/收件地址/);
  });

  it('给了 html 时发 multipart/alternative，纯文本段排在 HTML 前面', () => {
    const mime = buildMimeMessage(configFor(465), {
      ...message,
      html: '<p>验证码 <b>123456</b></p>',
    });

    expect(mime).toContain('Content-Type: multipart/alternative; boundary="');
    const boundary = /boundary="([^"]+)"/.exec(mime)?.[1];
    expect(boundary).toBeTruthy();

    const parts = mime.split(`--${boundary}`);
    // 头部 + 纯文本段 + HTML 段 + 结束标记
    expect(parts).toHaveLength(4);
    expect(parts[1]).toContain('Content-Type: text/plain; charset=UTF-8');
    expect(parts[2]).toContain('Content-Type: text/html; charset=UTF-8');

    const decode = (part: string): string => {
      const body = part.split('\r\n\r\n').slice(1).join('\r\n\r\n');
      return Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8');
    };
    expect(decode(parts[1] ?? '')).toBe('验证码 123456');
    expect(decode(parts[2] ?? '')).toBe('<p>验证码 <b>123456</b></p>');
    // 结束边界必须是 `--boundary--`，少两个连字符客户端会一直等下一段
    expect(mime.trimEnd().endsWith(`--${boundary}--`)).toBe(true);
  });

  it('不给 html 时仍是单段纯文本，不套 multipart', () => {
    const mime = buildMimeMessage(configFor(465), message);
    expect(mime).not.toContain('multipart');
    expect(mime).toContain('Content-Type: text/plain; charset=UTF-8');
  });

  it('HTML 段被 base64 包住，正文里的点号不会提前结束 DATA', () => {
    const mime = buildMimeMessage(configFor(465), {
      ...message,
      html: '<p>.</p>\r\n.\r\n<p>end</p>',
    });
    // 逐行检查：DATA 阶段只有「单独一行句点」才是结束符，base64 保证不会出现
    for (const line of mime.split('\r\n')) expect(line).not.toBe('.');
  });
});

describe('sendMail 协议流程', () => {
  it('完整走通 MAIL / RCPT / DATA / QUIT', async () => {
    running = await startFakeSmtp();
    await sendMail(configFor(running.port), {
      to: 'user@example.com',
      subject: '重置密码验证码',
      text: '验证码是 123456',
    });
    await running.done;

    const transcript = running.transcript();
    expect(transcript).toContain('EHLO nomi.dev');
    expect(transcript).toContain('MAIL FROM:<noreply@nomi.dev>');
    expect(transcript).toContain('RCPT TO:<user@example.com>');
    expect(transcript).toContain('DATA');
    expect(transcript).toContain('QUIT');
  });

  it('配了账号时走 AUTH LOGIN，且口令是 base64 而不是明文', async () => {
    running = await startFakeSmtp();
    await sendMail(configFor(running.port, { username: 'mailer', password: 's3cret' }), {
      to: 'user@example.com',
      subject: 'code',
      text: 'code',
    });
    await running.done;

    const transcript = running.transcript();
    expect(transcript).toContain('AUTH LOGIN');
    expect(transcript).toContain(Buffer.from('mailer').toString('base64'));
    // 服务器只收到 base64，明文口令绝不出现在信道上
    expect(transcript).not.toContain('s3cret');
  });

  it('服务器拒绝收件人时抛错，而不是静默成功', async () => {
    const server = createServer((socket) => {
      socket.write('220 fake\r\n');
      socket.on('error', () => undefined);
      socket.on('data', (chunk) => {
        const text = chunk.toString('utf8').toUpperCase();
        if (text.startsWith('EHLO')) socket.write('250 ok\r\n');
        else if (text.startsWith('RCPT')) socket.write('550 no such user\r\n');
        else socket.write('250 ok\r\n');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    await expect(
      sendMail(configFor(port), { to: 'user@example.com', subject: 'x', text: 'y' }),
    ).rejects.toThrow(/RCPT/);
    server.close();
  });
});
