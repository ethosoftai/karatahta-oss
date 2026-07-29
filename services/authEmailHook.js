import { Webhook } from 'standardwebhooks';

const RESEND_EMAILS_URL = 'https://api.resend.com/emails';
const supportedLinkActions = new Set(['signup', 'invite', 'magiclink', 'recovery', 'email_change']);

function hookError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeHookSecret(secret) {
  const normalized = String(secret || '').trim().replace(/^v1,whsec_/, '');
  if (!normalized) {
    throw hookError('Send Email Hook secret ayari eksik.', 503);
  }
  return normalized;
}

export function verifySendEmailHook({ payload, headers, secret }) {
  if (!payload) {
    throw hookError('Send Email Hook govdesi bos.', 400);
  }
  try {
    const webhook = new Webhook(normalizeHookSecret(secret));
    return webhook.verify(payload, headers);
  } catch (error) {
    if (error.statusCode) throw error;
    throw hookError('Send Email Hook imzasi gecersiz.', 401);
  }
}

function requireEmail(value, label = 'Alici') {
  const email = String(value || '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    throw hookError(`${label} e-posta adresi gecersiz.`, 400);
  }
  return email;
}

function createJob({ to, actionType, token, tokenHash, redirectTo, siteUrl }) {
  return {
    to: requireEmail(to),
    actionType,
    token: String(token || ''),
    tokenHash: String(tokenHash || ''),
    redirectTo: String(redirectTo || ''),
    siteUrl: String(siteUrl || '')
  };
}

export function buildSendEmailJobs(event) {
  const user = event?.user || {};
  const emailData = event?.email_data || {};
  const actionType = String(emailData.email_action_type || '').trim().toLowerCase();
  if (!actionType) {
    throw hookError('E-posta aksiyon tipi eksik.', 400);
  }

  const baseJob = {
    actionType,
    redirectTo: emailData.redirect_to,
    siteUrl: emailData.site_url
  };

  if (actionType === 'email_change') {
    const currentEmail = user.email;
    const newEmail = user.new_email || emailData.new_email;
    const jobs = [];

    if (emailData.token_hash_new && currentEmail) {
      jobs.push(createJob({
        ...baseJob,
        to: currentEmail,
        token: emailData.token,
        tokenHash: emailData.token_hash_new
      }));
    }
    if (emailData.token_hash && newEmail) {
      jobs.push(createJob({
        ...baseJob,
        to: newEmail,
        token: emailData.token_new || emailData.token,
        tokenHash: emailData.token_hash
      }));
    }
    if (!jobs.length) {
      throw hookError('E-posta degisikligi icin token bilgisi eksik.', 400);
    }
    return jobs;
  }

  return [createJob({
    ...baseJob,
    to: user.email,
    token: emailData.token,
    tokenHash: emailData.token_hash
  })];
}

function buildVerifyUrl({ supabaseUrl, tokenHash, actionType, redirectTo }) {
  if (!supportedLinkActions.has(actionType)) {
    return null;
  }
  if (!supabaseUrl || !tokenHash) {
    throw hookError('Dogrulama baglantisi icin Supabase URL veya token eksik.', 500);
  }
  const url = new URL('/auth/v1/verify', supabaseUrl);
  url.searchParams.set('token', tokenHash);
  url.searchParams.set('type', actionType);
  if (redirectTo) {
    url.searchParams.set('redirect_to', redirectTo);
  }
  return url.toString();
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function copyForAction(actionType) {
  switch (actionType) {
    case 'signup':
      return {
        subject: 'Kara Tahta hesabını doğrula',
        heading: 'Kara Tahta’ya hoş geldin',
        message: 'E-posta adresini doğrulamak ve hesabını kullanmaya başlamak için aşağıdaki butona tıkla.',
        button: 'E-posta adresimi doğrula',
        fallback: 'Bu hesabı sen oluşturmadıysan bu mesajı görmezden gelebilirsin.'
      };
    case 'recovery':
      return {
        subject: 'Kara Tahta şifreni yenile',
        heading: 'Şifreni yenile',
        message: 'Kara Tahta hesabın için bir şifre yenileme isteği aldık.',
        button: 'Yeni şifre oluştur',
        fallback: 'Bu isteği sen yapmadıysan bu mesajı görmezden gelebilirsin.'
      };
    case 'magiclink':
      return {
        subject: 'Kara Tahta giriş bağlantın',
        heading: 'Kara Tahta’ya giriş yap',
        message: 'Güvenli giriş bağlantın hazır. Bu bağlantı kısa süre içinde geçersiz olur.',
        button: 'Kara Tahta’ya giriş yap',
        fallback: 'Bu giriş isteğini sen yapmadıysan bu mesajı görmezden gelebilirsin.'
      };
    case 'invite':
      return {
        subject: 'Kara Tahta davetin',
        heading: 'Kara Tahta’ya davet edildin',
        message: 'Davetini kabul ederek Kara Tahta hesabını oluşturabilirsin.',
        button: 'Daveti kabul et',
        fallback: 'Bu daveti beklemiyorsan bu mesajı görmezden gelebilirsin.'
      };
    case 'email_change':
      return {
        subject: 'E-posta değişikliğini doğrula',
        heading: 'Yeni e-posta adresini doğrula',
        message: 'Kara Tahta hesabındaki e-posta değişikliğini tamamlamak için aşağıdaki butona tıkla.',
        button: 'E-posta değişikliğini doğrula',
        fallback: 'Bu değişikliği sen istemediysen hesabının şifresini yenile.'
      };
    case 'reauthentication':
      return {
        subject: 'Kara Tahta doğrulama kodun',
        heading: 'Kimliğini doğrula',
        message: 'Hassas işlemi tamamlamak için aşağıdaki tek kullanımlık kodu kullan.',
        button: null,
        fallback: 'Bu işlemi sen başlatmadıysan kodu kimseyle paylaşma.'
      };
    default:
      throw hookError(`Desteklenmeyen e-posta aksiyonu: ${actionType}`, 400);
  }
}

export function renderAuthEmail(job, { supabaseUrl }) {
  const copy = copyForAction(job.actionType);
  const actionUrl = buildVerifyUrl({
    supabaseUrl,
    tokenHash: job.tokenHash,
    actionType: job.actionType,
    redirectTo: job.redirectTo
  });
  if (!actionUrl && !job.token) {
    throw hookError('Dogrulama kodu eksik.', 400);
  }
  const actionBlock = actionUrl
    ? `<p style="margin:28px 0"><a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:#171717;color:#ffffff;padding:13px 20px;border-radius:8px;text-decoration:none;font-weight:700">${escapeHtml(copy.button)}</a></p>`
    : `<div style="margin:28px 0;padding:16px;background:#f4f4f4;border-radius:8px;font-size:28px;font-weight:700;letter-spacing:6px;text-align:center">${escapeHtml(job.token)}</div>`;
  const textAction = actionUrl
    ? `${copy.button}: ${actionUrl}`
    : `Doğrulama kodu: ${job.token}`;

  return {
    subject: copy.subject,
    html: `<!doctype html>
<html lang="tr">
  <body style="margin:0;background:#f4f4f4;font-family:Arial,sans-serif;color:#171717">
    <div style="max-width:560px;margin:0 auto;padding:36px 20px">
      <div style="background:#ffffff;border:1px solid #e7e7e7;border-radius:14px;padding:32px">
        <div style="font-size:18px;font-weight:800;margin-bottom:28px">Kara Tahta</div>
        <h1 style="font-size:24px;line-height:1.25;margin:0 0 16px">${escapeHtml(copy.heading)}</h1>
        <p style="font-size:16px;line-height:1.6;margin:0">${escapeHtml(copy.message)}</p>
        ${actionBlock}
        <p style="font-size:13px;line-height:1.5;color:#666666;margin:24px 0 0">${escapeHtml(copy.fallback)}</p>
      </div>
      <p style="font-size:12px;color:#777777;text-align:center;margin-top:18px">Kara Tahta · Güvenli hesap bildirimi</p>
    </div>
  </body>
</html>`,
    text: `Kara Tahta\n\n${copy.heading}\n\n${copy.message}\n\n${textAction}\n\n${copy.fallback}`
  };
}

export async function sendWithResend({
  apiKey,
  from,
  replyTo,
  to,
  subject,
  html,
  text,
  idempotencyKey,
  fetchImpl = fetch
}) {
  if (!apiKey) throw hookError('RESEND_API_KEY ayari eksik.', 503);
  if (!from) throw hookError('AUTH_EMAIL_FROM ayari eksik.', 503);

  const response = await fetchImpl(RESEND_EMAILS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {})
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html,
      text,
      ...(replyTo ? { reply_to: replyTo } : {})
    })
  });
  const responseText = await response.text();
  let result = {};
  try {
    result = responseText ? JSON.parse(responseText) : {};
  } catch {
    result = { message: responseText };
  }
  if (!response.ok) {
    const error = hookError(result.message || `Resend istegi ${response.status} ile basarisiz oldu.`, 502);
    error.providerStatus = response.status;
    throw error;
  }
  return result;
}
