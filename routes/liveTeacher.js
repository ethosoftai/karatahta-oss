import { Router } from 'express';
import { generateLiveTeacherTurn } from '../services/liveTeacherEngine.js';

export const liveTeacherRouter = Router();

liveTeacherRouter.post('/api/live-teacher/turn', async (req, res, next) => {
  try {
    const { prompt, history } = req.body || {};
    const turn = await generateLiveTeacherTurn({ prompt, history: Array.isArray(history) ? history : [] });
    res.json(turn);
  } catch (error) {
    next(error);
  }
});
