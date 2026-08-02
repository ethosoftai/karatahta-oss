import test from 'node:test';
import assert from 'node:assert/strict';
import { createKaraLiveSession } from '../services/karaLiveSession.js';

function fakeGenaiClient() {
  const sentToolResponses = [];
  const sentRealtimeInputs = [];
  let closed = false;
  let capturedCallbacks;
  let capturedConfig;

  return {
    connectCalls: [],
    sentToolResponses,
    sentRealtimeInputs,
    get closed() { return closed; },
    get callbacks() { return capturedCallbacks; },
    get config() { return capturedConfig; },
    live: {
      connect: async (params) => {
        capturedCallbacks = params.callbacks;
        capturedConfig = params.config;
        return {
          sendToolResponse: (payload) => sentToolResponses.push(payload),
          sendRealtimeInput: (payload) => sentRealtimeInputs.push(payload),
          close: () => { closed = true; }
        };
      }
    }
  };
}

test('araclar tanimli sekilde tools setup mesajina eklenir', async () => {
  const client = fakeGenaiClient();
  await createKaraLiveSession({
    apiKey: 'test-key',
    genaiClient: client,
    executors: { get_frame: async () => ({ response: { ok: true } }) }
  });
  const [{ functionDeclarations }] = client.config.tools;
  assert.deepEqual(functionDeclarations.map((tool) => tool.name), ['get_frame', 'web_search', 'generate_manim']);
});

test('get_frame arac cagrisi calistiriciya yonlendirilir ve resim parcasi ile yanitlanir', async () => {
  const client = fakeGenaiClient();
  const getFrameCalls = [];
  await createKaraLiveSession({
    apiKey: 'test-key',
    genaiClient: client,
    executors: {
      get_frame: async (args) => {
        getFrameCalls.push(args);
        return {
          response: { ok: true, timestampSeconds: args.time },
          parts: [{ inlineData: { mimeType: 'image/jpeg', data: 'BASE64' } }]
        };
      }
    }
  });

  await client.callbacks.onmessage({
    toolCall: { functionCalls: [{ id: 'call-1', name: 'get_frame', args: { time: 12.5 } }] }
  });

  assert.deepEqual(getFrameCalls, [{ time: 12.5 }]);
  assert.equal(client.sentToolResponses.length, 1);
  const [{ functionResponses }] = client.sentToolResponses;
  assert.equal(functionResponses[0].id, 'call-1');
  assert.equal(functionResponses[0].name, 'get_frame');
  assert.deepEqual(functionResponses[0].response, { ok: true, timestampSeconds: 12.5 });
  assert.deepEqual(functionResponses[0].parts, [{ inlineData: { mimeType: 'image/jpeg', data: 'BASE64' } }]);
});

test('bilinmeyen arac cagrisi hata yaniti dondurur ve oturumu dusurmez', async () => {
  const client = fakeGenaiClient();
  await createKaraLiveSession({
    apiKey: 'test-key',
    genaiClient: client,
    executors: { get_frame: async () => ({ response: { ok: true } }) }
  });

  await client.callbacks.onmessage({
    toolCall: { functionCalls: [{ id: 'call-2', name: 'unknown_tool', args: {} }] }
  });

  const [{ functionResponses }] = client.sentToolResponses;
  assert.equal(functionResponses[0].response.ok, false);
  assert.match(functionResponses[0].response.error, /Bilinmeyen arac/);
});

test('calistirici hata firlatirsa arac yaniti basarisiz olarak isaretlenir', async () => {
  const client = fakeGenaiClient();
  await createKaraLiveSession({
    apiKey: 'test-key',
    genaiClient: client,
    executors: {
      get_frame: async () => { throw new Error('ffmpeg patladi'); }
    }
  });

  await client.callbacks.onmessage({
    toolCall: { functionCalls: [{ id: 'call-3', name: 'get_frame', args: { time: 1 } }] }
  });

  const [{ functionResponses }] = client.sentToolResponses;
  assert.equal(functionResponses[0].response.ok, false);
  assert.match(functionResponses[0].response.error, /ffmpeg patladi/);
});

test('sunucu icerik mesaji ses parcalarini ve transkript alanlarini normalize eder', async () => {
  const client = fakeGenaiClient();
  const events = [];
  await createKaraLiveSession({
    apiKey: 'test-key',
    genaiClient: client,
    executors: { get_frame: async () => ({ response: { ok: true } }) },
    onServerMessage: (event) => events.push(event)
  });

  client.callbacks.onmessage({
    serverContent: {
      modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'AUDIO_BASE64' } }] },
      outputTranscription: { text: 'merhaba' },
      turnComplete: true
    }
  });

  const event = events.find((item) => item.type === 'server_content');
  assert.deepEqual(event.audioChunks, ['AUDIO_BASE64']);
  assert.equal(event.outputTranscript, 'merhaba');
  assert.equal(event.turnComplete, true);
});

test('sendAudioChunk pcm 16khz mime turuyle realtime input gonderir', async () => {
  const client = fakeGenaiClient();
  const session = await createKaraLiveSession({
    apiKey: 'test-key',
    genaiClient: client,
    executors: { get_frame: async () => ({ response: { ok: true } }) }
  });

  session.sendAudioChunk('CHUNK');
  assert.deepEqual(client.sentRealtimeInputs, [{ audio: { data: 'CHUNK', mimeType: 'audio/pcm;rate=16000' } }]);
});

test('apiKey veya get_frame calistiricisi eksikse baglanti kurulmadan hata firlar', async () => {
  await assert.rejects(
    () => createKaraLiveSession({ apiKey: '', genaiClient: fakeGenaiClient(), executors: { get_frame: async () => {} } }),
    /GEMINI_API_KEY/
  );
  await assert.rejects(
    () => createKaraLiveSession({ apiKey: 'k', genaiClient: fakeGenaiClient(), executors: {} }),
    /get_frame calistiricisi/
  );
});
