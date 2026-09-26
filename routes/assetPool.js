// Mounts the marketing-agent-assets asset-pool contract on top of Kara
// Tahta's own data: approved lesson videos/posters for collect_assets and
// prepare_media, and Kara Tahta's own /api/generate-lesson for
// request_video_generation. See ../services/assetPool/README (in
// marketing-agent-assets/asset-pool/examples/karatahta) for the contract
// this implements and what each capability does and doesn't guarantee.
//
// Both routers authenticate with their own shared token (ASSET_POOL_TOKEN),
// never with a user session -- an agent calling this API is not a signed-in
// user. The video-request adapter additionally authenticates itself to Kara
// Tahta's own /api endpoints with the scheduler shared secret, the same
// mechanism services/scheduler.js uses.

import { createAssetPoolHandler } from '../services/assetPool/handler.js';
import { createVideoRequestHandler } from '../services/assetPool/videoRequests.js';
import { createKaratahtaAssetSource } from '../services/assetPool/assetSource.js';
import { createKaratahtaVideoSource } from '../services/assetPool/videoSource.js';
import { listPublicCatalogLessons, getPublicLessonVideo } from '../services/supabaseStore.js';
import { createStorageSignedUrl } from '../services/mediaStore.js';
import { isYoutubeStoragePath } from '../services/youtubeSource.js';

const assetPoolToken = String(process.env.ASSET_POOL_TOKEN || '').trim();
const publishUrlTtlSeconds = Number(process.env.SOCIAL_PUBLISH_VIDEO_URL_TTL_SECONDS || 86400);

export const assetPoolHandler = createAssetPoolHandler({
  token: assetPoolToken,
  ...createKaratahtaAssetSource({
    store: { listPublicCatalogLessons, getPublicLessonVideo },
    media: { createStorageSignedUrl },
    isYoutubeStoragePath,
    publishUrlTtlSeconds
  })
});

// request_video_generation is optional per the contract and needs Kara
// Tahta's own scheduler token to call itself -- if that isn't configured,
// mount only the asset pool and let the agent's video_uretimi_iste fail
// closed with a clear error instead of standing up a broken route.
const schedulerToken = String(process.env.SCHEDULER_INTERNAL_TOKEN || '').trim();

export const videoRequestHandler = schedulerToken
  ? createVideoRequestHandler({
      token: assetPoolToken,
      ...createKaratahtaVideoSource({
        backendUrl: process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${process.env.PORT || 3000}`,
        token: schedulerToken
      })
    })
  : null;
