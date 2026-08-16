import { timingSafeEqual } from 'node:crypto';
import { getProfileForAccessToken } from './supabaseStore.js';

const authRequired = String(process.env.AUTH_REQUIRED || 'true').toLowerCase() !== 'false';
const schedulerInternalToken = String(process.env.SCHEDULER_INTERNAL_TOKEN || '').trim();
const schedulerUserId = String(process.env.SCHEDULER_USER_ID || '').trim();

export function bearerTokenFromRequest(req) {
  const header = String(req.headers.authorization || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
}

// Lets the social-publisher worker's scheduler call this API as itself
// (POST /api/cards/generate, /api/generate-lesson, /api/social-publish, ...)
// without a real user session -- gated behind a shared secret that must be
// configured on both sides (see services/scheduler.js).
function isSchedulerRequest(req) {
  if (!schedulerInternalToken || !schedulerUserId) return false;
  const provided = String(req.headers['x-scheduler-token'] || '');
  if (!provided || provided.length !== schedulerInternalToken.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(schedulerInternalToken));
}

export async function resolveRequestUser(req) {
  if (req.userContext) {
    return req.userContext;
  }

  if (isSchedulerRequest(req)) {
    req.userContext = {
      profileId: schedulerUserId,
      profile: null,
      mode: 'scheduler'
    };
    return req.userContext;
  }

  const token = bearerTokenFromRequest(req);
  if (token) {
    const profile = await getProfileForAccessToken(token);
    req.userContext = {
      profileId: profile.id,
      profile,
      mode: 'auth'
    };
    return req.userContext;
  }

  if (authRequired) {
    const error = new Error('Giris yapman gerekiyor.');
    error.statusCode = 401;
    throw error;
  }

  req.userContext = {
    profileId: process.env.DEV_USER_ID,
    profile: null,
    mode: 'dev'
  };
  return req.userContext;
}
