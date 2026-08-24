import { Router } from 'express';
import { resolveRequestUser } from '../services/requestAuth.js';
import { getUserPlan } from '../services/supabaseStore.js';
import { PLAN_CATALOG } from '../services/plans.js';

export const plansRouter = Router();

plansRouter.get('/api/plans', (req, res) => {
  res.json({ plans: PLAN_CATALOG });
});

plansRouter.get('/api/plans/me', async (req, res, next) => {
  try {
    const userContext = await resolveRequestUser(req);
    const plan = await getUserPlan(userContext.profileId);
    const catalogEntry = PLAN_CATALOG.find((entry) => entry.id === plan.plan_id) || PLAN_CATALOG[0];
    res.json({
      planId: plan.plan_id,
      planName: catalogEntry.name,
      video: { used: plan.videos_used, quota: plan.video_quota },
      card: { used: plan.cards_used, quota: plan.card_quota }
    });
  } catch (error) {
    next(error);
  }
});
