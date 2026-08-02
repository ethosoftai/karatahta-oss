const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink';

export async function refreshGoogleAccessToken({
  clientId,
  clientSecret,
  refreshToken,
  fetchImpl = fetch
}) {
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Google token yenileme icin clientId, clientSecret ve refreshToken gerekli.');
  }
  const response = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      `Google token yenileme basarisiz (${response.status}): ${payload?.error_description || payload?.error || response.statusText}`
    );
    error.statusCode = response.status === 400 || response.status === 401 ? 401 : 502;
    throw error;
  }
  if (!payload.access_token) {
    throw new Error('Google token yenileme yaniti access_token icermiyor.');
  }
  return {
    accessToken: payload.access_token,
    expiresInSeconds: Number(payload.expires_in || 3600)
  };
}

export function buildMultipartUploadBody({ metadata, fileBuffer, mimeType, boundary }) {
  const metadataPart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`;
  const filePartHeader = `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`;
  const closing = `\r\n--${boundary}--`;
  return Buffer.concat([
    Buffer.from(metadataPart, 'utf8'),
    Buffer.from(filePartHeader, 'utf8'),
    fileBuffer,
    Buffer.from(closing, 'utf8')
  ]);
}

export async function uploadFileToDrive({
  accessToken,
  fileBuffer,
  fileName,
  mimeType = 'video/mp4',
  fetchImpl = fetch
}) {
  if (!accessToken) throw new Error('Google Drive erisim tokeni gerekli.');
  if (!fileBuffer?.length) throw new Error('Yuklenecek dosya bos olamaz.');

  const boundary = `karatahta-drive-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const body = buildMultipartUploadBody({
    metadata: { name: fileName },
    fileBuffer,
    mimeType,
    boundary
  });

  const response = await fetchImpl(GOOGLE_DRIVE_UPLOAD_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': `multipart/related; boundary=${boundary}`
    },
    body
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      `Google Drive yukleme basarisiz (${response.status}): ${payload?.error?.message || response.statusText}`
    );
    error.statusCode = response.status === 401 ? 401 : 502;
    throw error;
  }
  if (!payload.id) {
    throw new Error('Google Drive yaniti dosya id icermiyor.');
  }
  return { fileId: payload.id, webViewLink: payload.webViewLink || null };
}
