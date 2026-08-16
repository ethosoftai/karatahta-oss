import { Router } from 'express';
import { resolveRequestUser } from '../services/requestAuth.js';
import { getSchedulerJob, listSchedulerJobs, updateSchedulerJob } from '../services/supabaseStore.js';
import { readContentPool, writeContentPool } from '../services/contentPool.js';

export const schedulerRouter = Router();

const JOB_TYPES = new Set(['cards_carousel', 'lesson_video']);

function requireJobType(value) {
  const jobType = String(value || '').trim();
  if (!JOB_TYPES.has(jobType)) {
    const error = new Error(`job_type 'cards_carousel' veya 'lesson_video' olmali (gelen: ${jobType || '(bos)'}).`);
    error.statusCode = 400;
    throw error;
  }
  return jobType;
}

schedulerRouter.get('/api/scheduler/status', async (req, res, next) => {
  try {
    await resolveRequestUser(req);
    const jobs = await listSchedulerJobs();
    res.json({ jobs });
  } catch (error) {
    next(error);
  }
});

// Starts (or re-schedules) one of the two content-pool-driven jobs. Passing
// interval_minutes changes the cadence going forward; omit it to keep
// whatever is already configured. next_run_at is set to "now" so a freshly
// started job fires on the worker's next tick instead of waiting a full
// interval first.
schedulerRouter.post('/api/scheduler/start', async (req, res, next) => {
  try {
    await resolveRequestUser(req);
    const jobType = requireJobType(req.body?.job_type);
    const patch = { enabled: true, next_run_at: new Date().toISOString() };
    if (req.body?.interval_minutes != null) {
      const intervalMinutes = Math.max(1, Math.round(Number(req.body.interval_minutes)));
      if (!Number.isFinite(intervalMinutes)) {
        return res.status(400).json({ error: 'interval_minutes gecerli bir sayi olmali.' });
      }
      patch.interval_minutes = intervalMinutes;
    }
    const job = await updateSchedulerJob(jobType, patch);
    if (!job) {
      return res.status(404).json({ error: `scheduler_jobs icinde '${jobType}' bulunamadi.` });
    }
    res.json({ job });
  } catch (error) {
    next(error);
  }
});

schedulerRouter.post('/api/scheduler/stop', async (req, res, next) => {
  try {
    await resolveRequestUser(req);
    const jobType = requireJobType(req.body?.job_type);
    const job = await updateSchedulerJob(jobType, { enabled: false });
    if (!job) {
      return res.status(404).json({ error: `scheduler_jobs icinde '${jobType}' bulunamadi.` });
    }
    res.json({ job });
  } catch (error) {
    next(error);
  }
});

schedulerRouter.get('/api/scheduler/content-pool', async (req, res, next) => {
  try {
    await resolveRequestUser(req);
    const items = await readContentPool();
    const cardsJob = await getSchedulerJob('cards_carousel');
    const lessonJob = await getSchedulerJob('lesson_video');
    res.json({
      items,
      cursors: {
        cards_carousel: items.length ? Number(cardsJob?.content_pool_cursor || 0) % items.length : 0,
        lesson_video: items.length ? Number(lessonJob?.content_pool_cursor || 0) % items.length : 0
      }
    });
  } catch (error) {
    next(error);
  }
});

// Replaces the whole pool (one idea per line) -- simplest editable contract
// for a plain text file in the bucket; the frontend/CLI can GET first, edit,
// then PUT the full text back.
schedulerRouter.put('/api/scheduler/content-pool', async (req, res, next) => {
  try {
    await resolveRequestUser(req);
    const text = req.body?.text;
    if (typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'text bos olamaz (satir basina bir fikir).' });
    }
    await writeContentPool(text);
    const items = await readContentPool();
    res.json({ items });
  } catch (error) {
    next(error);
  }
});
