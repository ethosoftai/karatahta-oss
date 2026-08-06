import { Router } from 'express';
import { generateCardsStream } from '../services/cardsEngine.js';

export const cardsRouter = Router();

// Streams newline-delimited JSON, one line per card, as each card finishes
// rendering -- matches the "generate card -> explain card -> next card" flow.
cardsRouter.post('/api/cards/generate', async (req, res) => {
  const prompt = req.body?.prompt;
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  try {
    for await (const card of generateCardsStream({ prompt })) {
      res.write(`${JSON.stringify({ type: 'card', card })}\n`);
    }
    res.write(`${JSON.stringify({ type: 'done' })}\n`);
  } catch (error) {
    res.write(`${JSON.stringify({ type: 'error', message: error.message || 'Kart uretimi basarisiz.' })}\n`);
  } finally {
    res.end();
  }
});
