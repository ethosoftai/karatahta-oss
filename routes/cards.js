import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { generateCardsStream, answerCardsQuestion, transcribeCardsQuestionImage } from '../services/cardsEngine.js';
import { resolveRequestUser } from '../services/requestAuth.js';
import { uploadDataUrl, createStorageSignedUrl } from '../services/mediaStore.js';
import { publishCarouselToInstagram } from '../services/instagramPublish.js';
import { convertPngBufferToJpeg } from '../services/imageConvert.js';
import {
  createCardSession,
  appendCardSessionMessages,
  listCardSessionsForUser,
  getCardSessionForUser
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
      messages: session.messages || []
    });
  } catch (error) {
    next(error);
  }
});

// "Slide show" post: publishes a card session's stills as a single
// Instagram carousel (2-10 slides). Stills are stored as PNG but Instagram's
// Content Publishing API only accepts JPEG, so each one is downloaded,
// converted, and re-uploaded under its own path before publishing.
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
      const jpegSigned = await createStorageSignedUrl({ bucket: 'attachments', storagePath: uploadedJpeg.storagePath, expiresInSeconds: 600 });
      return jpegSigned.signedUrl;
    }));

    const caption = String(req.body?.caption || `Kara Tahta | ${session.title || 'Kartlar'}`).trim();
    const result = await publishCarouselToInstagram({ imageUrls, caption });
    res.json(result);
  } catch (error) {
    next(error);
  }
});
