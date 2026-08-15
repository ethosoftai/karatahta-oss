import { Router } from 'express';
import { generateCardsStream, answerCardsQuestion, transcribeCardsQuestionImage } from '../services/cardsEngine.js';

export const cardsRouter = Router();

// Streams newline-delimited JSON, one line per card, as each card finishes
// rendering -- matches the "generate card -> explain card -> next card" flow.
// Accepts a general `topic`, a specific `question`, and/or a `question_image`
// (photo of a handwritten/printed question) -- the photo is transcribed to
// text first and used as `question`, same as the lesson question-photo flow.
cardsRouter.post('/api/cards/generate', async (req, res) => {
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  try {
    let question = req.body?.question;
    if (req.body?.question_image) {
      question = await transcribeCardsQuestionImage(req.body.question_image);
    }
    for await (const card of generateCardsStream({ prompt: req.body?.prompt, topic: req.body?.topic, question })) {
      res.write(`${JSON.stringify({ type: 'card', card })}\n`);
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
    const result = await answerCardsQuestion({
      question: req.body?.question,
      cards: req.body?.cards,
      history: req.body?.history
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});
