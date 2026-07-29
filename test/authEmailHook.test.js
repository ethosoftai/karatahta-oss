import test from 'node:test';
import assert from 'node:assert/strict';
import { Webhook } from 'standardwebhooks';

import {
  buildSendEmailJobs,
  renderAuthEmail,
  sendWithResend,
  verifySendEmailHook
} from '../services/authEmailHook.js';

test('Supabase Send Email Hook imzasını doğrular', () => {
  const secret = Buffer.from('kara-tahta-hook-secret').toString('base64');
  const payload = JSON.stringify({
    user: { email: 'student@example.com' },
    email_data: { email_action_type: 'signup', token_hash: 'hash' }
  });
  const webhook = new Webhook(secret);
  const timestamp = new Date();
  const headers = {
    'webhook-id': 'msg_test',
    'webhook-timestamp': String(Math.floor(timestamp.getTime() / 1000)),
    'webhook-signature': webhook.sign('msg_test', timestamp, payload)
  };

  const event = verifySendEmailHook({
    payload,
    headers,
    secret: `v1,whsec_${secret}`
  });
  assert.equal(event.user.email, 'student@example.com');
});

test('geçersiz Send Email Hook imzasını reddeder', () => {
  assert.throws(() => verifySendEmailHook({
    payload: JSON.stringify({ user: { email: 'student@example.com' } }),
    headers: {
      'webhook-id': 'msg_test',
      'webhook-timestamp': String(Math.floor(Date.now() / 1000)),
      'webhook-signature': 'v1,invalid'
    },
    secret: `v1,whsec_${Buffer.from('kara-tahta-hook-secret').toString('base64')}`
  }), (error) => error.statusCode === 401);
});

test('signup hook verisinden güvenli doğrulama maili üretir', () => {
  const [job] = buildSendEmailJobs({
    user: { email: 'student@example.com' },
    email_data: {
      email_action_type: 'signup',
      token: '123456',
      token_hash: 'hash-value',
      redirect_to: 'https://karatahta.ethosoft.org/?auth=confirmed',
      site_url: 'https://karatahta.ethosoft.org'
    }
  });
  const email = renderAuthEmail(job, {
    supabaseUrl: 'https://project.supabase.co'
  });
  assert.equal(job.to, 'student@example.com');
  assert.equal(email.subject, 'Kara Tahta hesabını doğrula');
  assert.match(email.html, /project\.supabase\.co\/auth\/v1\/verify/);
  assert.match(email.html, /type=signup/);
  assert.match(email.text, /Kara Tahta/);
});

test('secure email change için mevcut ve yeni adrese ayrı işler üretir', () => {
  const jobs = buildSendEmailJobs({
    user: {
      email: 'old@example.com',
      new_email: 'new@example.com'
    },
    email_data: {
      email_action_type: 'email_change',
      token: '111111',
      token_hash: 'new-email-hash',
      token_new: '222222',
      token_hash_new: 'current-email-hash'
    }
  });
  assert.deepEqual(jobs.map((job) => [job.to, job.tokenHash]), [
    ['old@example.com', 'current-email-hash'],
    ['new@example.com', 'new-email-hash']
  ]);
});

test('Resend API isteğinde HTML, text ve idempotency anahtarı gönderir', async () => {
  let request;
  const result = await sendWithResend({
    apiKey: 're_test',
    from: 'Kara Tahta <no-reply@karatahta.ethosoft.org>',
    to: 'student@example.com',
    subject: 'Test',
    html: '<p>Test</p>',
    text: 'Test',
    idempotencyKey: 'msg_test-0',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ id: 'email_123' }), { status: 200 });
    }
  });
  assert.equal(result.id, 'email_123');
  assert.equal(request.options.headers['Idempotency-Key'], 'msg_test-0');
  assert.deepEqual(JSON.parse(request.options.body).to, ['student@example.com']);
});
