import { describe, expect, it } from 'vitest';
import { sanitizeNoticeHtml } from '../server/utils/notice-service';
import { verifyPassword } from '../server/utils/auth/password';

const payloads = [
  '<img src=x onerror=alert(1)>',
  '<img/src=x/onerror=alert(1)>',
  '<svg/onload=alert(1)>',
  '<a href="javascript:alert(1)">x</a>',
  '<a href="java&#115;cript:alert(1)">x</a>',
  '<a href="java&Tab;script:alert(1)">x</a>',
  '<script>alert(1)</script>',
  '<iframe src=javascript:alert(1)>',
  '<body onload=alert(1)>',
  '<img src=x onerror="alert(1)"',
];

describe('notice sanitizer probe', () => {
  it('reports which payloads survive', () => {
    for (const p of payloads) {
      console.log(JSON.stringify(p), '=>', JSON.stringify(sanitizeNoticeHtml(p)));
    }
    expect(true).toBe(true);
  });
});

describe('password probe', () => {
  it('legacy plaintext fallback', async () => {
    console.log('plaintext stored "123456" vs input "123456" =', await verifyPassword('123456', '123456'));
    console.log('broken hash vs input =', await verifyPassword('x', 'scrypt$bad'));
    expect(true).toBe(true);
  });
});
