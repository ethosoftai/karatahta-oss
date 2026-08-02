import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMultipartUploadBody,
  refreshGoogleAccessToken,
  uploadFileToDrive
} from '../services/googleDrive.js';

test('multipart yukleme govdesi metadata ve dosya baytlarini boundary ile ayirir', () => {
  const body = buildMultipartUploadBody({
    metadata: { name: 'ders.mp4' },
    fileBuffer: Buffer.from('VIDEO_BYTES'),
    mimeType: 'video/mp4',
    boundary: 'B'
  });
  const text = body.toString('utf8');
  assert.match(text, /--B\r\nContent-Type: application\/json; charset=UTF-8\r\n\r\n\{"name":"ders\.mp4"\}/);
  assert.match(text, /--B\r\nContent-Type: video\/mp4\r\n\r\nVIDEO_BYTES/);
  assert.match(text, /--B--$/);
});

test('refreshGoogleAccessToken eksik parametrelerde istek atmadan hata verir', async () => {
  await assert.rejects(
    () => refreshGoogleAccessToken({ clientId: '', clientSecret: 'x', refreshToken: 'y' }),
    /clientId, clientSecret ve refreshToken gerekli/
  );
});

test('refreshGoogleAccessToken basarili yanitta access token dondurur', async () => {
  const fetchImpl = async (url, options) => {
    assert.equal(url, 'https://oauth2.googleapis.com/token');
    const body = new URLSearchParams(options.body);
    assert.equal(body.get('grant_type'), 'refresh_token');
    assert.equal(body.get('refresh_token'), 'rt-1');
    return {
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'at-1', expires_in: 3600 })
    };
  };
  const result = await refreshGoogleAccessToken({
    clientId: 'cid',
    clientSecret: 'secret',
    refreshToken: 'rt-1',
    fetchImpl
  });
  assert.deepEqual(result, { accessToken: 'at-1', expiresInSeconds: 3600 });
});

test('refreshGoogleAccessToken 401 durumunda gecersiz oturum hatasi firlatir', async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 400,
    json: async () => ({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' })
  });
  await assert.rejects(
    () => refreshGoogleAccessToken({ clientId: 'c', clientSecret: 's', refreshToken: 'r', fetchImpl }),
    (error) => {
      assert.equal(error.statusCode, 401);
      return true;
    }
  );
});

test('uploadFileToDrive basarili yanitta dosya id ve webViewLink dondurur', async () => {
  const fetchImpl = async (url, options) => {
    assert.match(url, /uploadType=multipart/);
    assert.equal(options.headers.authorization, 'Bearer at-1');
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'file-1', webViewLink: 'https://drive.google.com/file/d/file-1/view' })
    };
  };
  const result = await uploadFileToDrive({
    accessToken: 'at-1',
    fileBuffer: Buffer.from('bytes'),
    fileName: 'ders.mp4',
    fetchImpl
  });
  assert.deepEqual(result, { fileId: 'file-1', webViewLink: 'https://drive.google.com/file/d/file-1/view' });
});

test('uploadFileToDrive bos dosyada istek atmadan hata verir', async () => {
  await assert.rejects(
    () => uploadFileToDrive({ accessToken: 'at', fileBuffer: Buffer.alloc(0), fileName: 'x.mp4' }),
    /bos olamaz/
  );
});
