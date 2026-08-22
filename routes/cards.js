import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { generateCardsStream, answerCardsQuestion, transcribeCardsQuestionImage } from '../services/cardsEngine.js';
import { resolveRequestUser } from '../services/requestAuth.js';
import { uploadDataUrl, createStorageSignedUrl } from '../services/mediaStore.js';
import { createSocialPublishJob } from '../services/socialPublishQueue.js';
import { convertPngBufferToJpeg } from '../services/imageConvert.js';
import {
  createCardSession,
  appendCardSessionMessages,
  listCardSessionsForUser,
  getCardSessionForUser,
  listPublicCardSessions,
  listCardSessionsForUserWithVisibility,
  setCardSessionPublic,
  getPublicCardSession
} from '../services/supabaseStore.js';

export const cardsRouter = Router();

async function uploadCardImage({ userId, sessionId, index, imageDataUrl }) {
  if (!imageDataUrl) return null;
  const storagePath = `cards/${userId}/${sessionId}/card-${index}.png`;
  const uploaded = await uploadDataUrl({
    bucket: 'attachments',
    storagePath,
    dataUrl: imageDataUrl,
    contentType: 'image/png'
  });
  return uploaded.storagePath;
}

// Streams newline-delimited JSON, one line per card, as each card finishes
// rendering -- matches the "generate card -> explain card -> next card" flow.
// Accepts a general `topic`, a specific `question`, and/or a `question_image`
// (photo of a handwritten/printed question) -- the photo is transcribed to
// text first and used as `question`, same as the lesson question-photo flow.
cardsRouter.post('/api/cards/generate', async (req, res) => {
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  try {
    const userContext = await resolveRequestUser(req);
    let question = req.body?.question;
    if (req.body?.question_image) {
      question = await transcribeCardsQuestionImage(req.body.question_image);
    }
    const collected = [];
    for await (const card of generateCardsStream({ prompt: req.body?.prompt, topic: req.body?.topic, question })) {
      collected.push(card);
      res.write(`${JSON.stringify({ type: 'card', card })}\n`);
    }
    if (collected.length) {
      try {
        // Just a storage-path prefix so images can upload before the DB row
        // (and its own generated id) exists -- not the session id returned
        // to the client, which is session.id below.
        const storagePathSessionId = randomUUID();
        const persistedCards = await Promise.all(collected.map(async (card, index) => ({
          title: card.title,
          explanation: card.explanation,
          imageStoragePath: await uploadCardImage({ userId: userContext.profileId, sessionId: storagePathSessionId, index, imageDataUrl: card.imageDataUrl })
        })));
        const title = String(req.body?.prompt || req.body?.topic || question || 'Kart oturumu').slice(0, 240);
        const session = await createCardSession({ userId: userContext.profileId, title, cards: persistedCards });
        res.write(`${JSON.stringify({ type: 'session', id: session.id })}\n`);
      } catch (persistError) {
        // Kart uretimi kullaniciya zaten ulasti; kalicilik basarisiz olsa da
        // akisi bozmuyoruz, sadece gecmise eklenmiyor.
      }
    }
    res.write(`${JSON.stringify({ type: 'done' })}\n`);
  } catch (error) {
    res.write(`${JSON.stringify({ type: 'error', message: error.message || 'Kart uretimi basarisiz.' })}\n`);
  } finally {
    res.end();
  }
});

// Follow-up chat once the card sequence is on screen -- same request/response
// shape as /api/ask-kara (question + history in, answer text out) but scoped
// to the cards just shown, since cards have no lesson/video/frame context.
cardsRouter.post('/api/cards/ask', async (req, res, next) => {
  try {
    const userContext = await resolveRequestUser(req);
    const question = req.body?.question;
    const result = await answerCardsQuestion({
      question,
      cards: req.body?.cards,
      history: req.body?.history
    });
    if (req.body?.session_id) {
      appendCardSessionMessages({
        sessionId: req.body.session_id,
        userId: userContext.profileId,
        messages: [
          { role: 'user', content: question, createdAt: new Date().toISOString() },
          { role: 'assistant', content: result.answer, createdAt: new Date().toISOString() }
        ]
      }).catch(() => {});
    }
    res.json(result);
  } catch (error) {
    next(error);
  }
});

cardsRouter.get('/api/cards/sessions', async (req, res, next) => {
  try {
    const userContext = await resolveRequestUser(req);
    const sessions = await listCardSessionsForUser({ userId: userContext.profileId });
    res.json({
      sessions: sessions.map((session) => ({
        id: session.id,
        title: session.title,
        createdAt: session.created_at,
        updatedAt: session.updated_at,
        cardCount: Array.isArray(session.cards) ? session.cards.length : 0
      }))
    });
  } catch (error) {
    next(error);
  }
});

cardsRouter.get('/api/cards/sessions/:id', async (req, res, next) => {
  try {
    const userContext = await resolveRequestUser(req);
    const session = await getCardSessionForUser({ sessionId: req.params.id, userId: userContext.profileId });
    if (!session) {
      return res.status(404).json({ error: 'Kart oturumu bulunamadi.' });
    }
    const cards = await Promise.all((session.cards || []).map(async (card) => {
      if (!card.imageStoragePath) return { ...card, imageUrl: null };
      const signed = await createStorageSignedUrl({ bucket: 'attachments', storagePath: card.imageStoragePath, expiresInSeconds: 3600 }).catch(() => null);
      return { ...card, imageUrl: signed?.signedUrl || null };
    }));
    res.json({
      id: session.id,
      title: session.title,
      createdAt: session.created_at,
      updatedAt: session.updated_at,
      cards,
      messages: session.messages || [],
      isPublic: Boolean(session.is_public)
    });
  } catch (error) {
    next(error);
  }
});

async function firstCardPosterUrl(cards) {
  const first = (Array.isArray(cards) ? cards : []).find((card) => card.imageStoragePath);
  if (!first) return null;
  const signed = await createStorageSignedUrl({ bucket: 'attachments', storagePath: first.imageStoragePath, expiresInSeconds: 3600 }).catch(() => null);
  return signed?.signedUrl || null;
}

// Public "Kartlar" catalog feed -- mirrors /api/catalog for video lessons but
// kept as a separate list (kartlar has no video duration/orientation and the
// two content types are shown in separate sections on the frontend).
cardsRouter.get('/api/catalog/cards', async (req, res, next) => {
  try {
    const sessions = await listPublicCardSessions({});
    const entries = await Promise.all(sessions.map(async (session) => ({
      id: session.id,
      title: session.title,
      createdAt: session.created_at,
      updatedAt: session.updated_at,
      cardCount: Array.isArray(session.cards) ? session.cards.length : 0,
      posterUrl: await firstCardPosterUrl(session.cards)
    })));
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json({ sessions: entries });
  } catch (error) {
    next(error);
  }
});

// NOTE: registered before the /:id route below so "mine" isn't captured as
// a session id by Express's param matching.
cardsRouter.get('/api/catalog/cards/mine', async (req, res, next) => {
  try {
    const userContext = await resolveRequestUser(req);
    const sessions = await listCardSessionsForUserWithVisibility({ userId: userContext.profileId });
    const entries = await Promise.all(sessions.map(async (session) => ({
      id: session.id,
      title: session.title,
      createdAt: session.created_at,
      updatedAt: session.updated_at,
      cardCount: Array.isArray(session.cards) ? session.cards.length : 0,
      isPublic: Boolean(session.is_public),
      posterUrl: await firstCardPosterUrl(session.cards)
    })));
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ sessions: entries });
  } catch (error) {
    next(error);
  }
});

// Public read of one card session's full content (all cards + signed image
// URLs) -- no auth, no ownership check, only sessions marked is_public. Lets
// the catalog grid open a card session the same way it opens a lesson.
cardsRouter.get('/api/catalog/cards/:id', async (req, res, next) => {
  try {
    const session = await getPublicCardSession({ sessionId: req.params.id });
    if (!session) {
      return res.status(404).json({ error: 'Kart oturumu bulunamadi.' });
    }
    const cards = await Promise.all((session.cards || []).map(async (card) => {
      if (!card.imageStoragePath) return { ...card, imageUrl: null };
      const signed = await createStorageSignedUrl({ bucket: 'attachments', storagePath: card.imageStoragePath, expiresInSeconds: 3600 }).catch(() => null);
      return { ...card, imageUrl: signed?.signedUrl || null };
    }));
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json({ id: session.id, title: session.title, createdAt: session.created_at, updatedAt: session.updated_at, cards });
  } catch (error) {
    next(error);
  }
});

async function setSessionVisibility(req, res, next, isPublic) {
  try {
    const userContext = await resolveRequestUser(req);
    const session = await getCardSessionForUser({ sessionId: req.params.id, userId: userContext.profileId });
    if (!session) {
      return res.status(404).json({ error: 'Kart oturumu bulunamadi.' });
    }
    const updated = await setCardSessionPublic({ sessionId: session.id, userId: userContext.profileId, isPublic });
    res.json({ id: updated?.id || session.id, isPublic });
  } catch (error) {
    next(error);
  }
}

cardsRouter.post('/api/cards/sessions/:id/publish', (req, res, next) => setSessionVisibility(req, res, next, true));
cardsRouter.post('/api/cards/sessions/:id/unpublish', (req, res, next) => setSessionVisibility(req, res, next, false));

// Converts a card session's stills to Instagram-compatible JPEGs, then queues
// the actual network publish for the separate social-publisher worker.
cardsRouter.post('/api/cards/sessions/:id/publish-instagram', async (req, res, next) => {
  try {
    const userContext = await resolveRequestUser(req);
    const session = await getCardSessionForUser({ sessionId: req.params.id, userId: userContext.profileId });
    if (!session) {
      return res.status(404).json({ error: 'Kart oturumu bulunamadi.' });
    }
    const cardsWithImages = (session.cards || []).filter((card) => card.imageStoragePath);
    if (cardsWithImages.length < 2) {
      return res.status(400).json({ error: 'Carousel icin en az 2 gorselli kart gerekli.' });
    }
    if (cardsWithImages.length > 10) {
      return res.status(400).json({ error: 'Instagram carousel en fazla 10 gorsel destekler; bu oturumda daha fazlasi var.' });
    }

    const imageUrlTtl = Math.min(86400, Math.max(60, Number(process.env.SOCIAL_PUBLISH_IMAGE_URL_TTL_SECONDS || 86400)));
    const imageUrls = await Promise.all(cardsWithImages.map(async (card, index) => {
      const original = await createStorageSignedUrl({ bucket: 'attachments', storagePath: card.imageStoragePath, expiresInSeconds: 300 });
      const response = await fetch(original.signedUrl);
      if (!response.ok) {
        throw new Error(`Kart gorseli indirilemedi (${response.status}).`);
      }
      const jpegBuffer = await convertPngBufferToJpeg(Buffer.from(await response.arrayBuffer()));
      const jpegPath = `cards/${userContext.profileId}/${session.id}/carousel/card-${index}.jpg`;
      const uploadedJpeg = await uploadDataUrl({
        bucket: 'attachments',
        storagePath: jpegPath,
        dataUrl: `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`,
        contentType: 'image/jpeg'
      });
      const jpegSigned = await createStorageSignedUrl({ bucket: 'attachments', storagePath: uploadedJpeg.storagePath, expiresInSeconds: imageUrlTtl });
      return jpegSigned.signedUrl;
    }));

    const caption = String(req.body?.caption || `Kara Tahta | ${session.title || 'Kartlar'}`).trim();
    const job = await createSocialPublishJob({
      userId: userContext.profileId,
      targetPlatform: 'instagram',
      action: 'instagram.carousel',
      imageUrls,
      caption
    });
    res.status(202).json({ publishJobId: job.id, sessionId: session.id, platform: 'instagram', status: job.status });
  } catch (error) {
    next(error);
  }
});
