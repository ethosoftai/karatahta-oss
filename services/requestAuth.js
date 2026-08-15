import { getProfileForAccessToken } from './supabaseStore.js';

const authRequired = String(process.env.AUTH_REQUIRED || 'true').toLowerCase() !== 'false';

export function bearerTokenFromRequest(req) {
  const header = String(req.headers.authorization || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
}

export async function resolveRequestUser(req) {
  if (req.userContext) {
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
