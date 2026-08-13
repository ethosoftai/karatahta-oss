const GRAPH_API_VERSION = process.env.INSTAGRAM_GRAPH_API_VERSION || 'v21.0';
// Instagram Login tokens (IGA...) are valid on graph.instagram.com. They are
// intentionally not Facebook Login/Page tokens and graph.facebook.com rejects
// them before a publish container can be created.
const GRAPH_API_BASE = `https://graph.instagram.com/${GRAPH_API_VERSION}`;
const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

function requireInstagramConfig() {
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  const businessAccountId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
  const missing = [];
  if (!accessToken) missing.push('INSTAGRAM_ACCESS_TOKEN');
  if (!businessAccountId) missing.push('INSTAGRAM_BUSINESS_ACCOUNT_ID');
  if (missing.length) {
    const error = new Error(`Instagram yayinlama icin .env eksik: ${missing.join(', ')}`);
    error.statusCode = 400;
    throw error;
  }
  return { accessToken, businessAccountId };
}

async function graphRequest(path, { method = 'GET', body = null } = {}) {
  const response = await fetch(`${GRAPH_API_BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json();
  if (!response.ok || data.error) {
    const error = new Error(`Instagram Graph API hatasi: ${data.error?.message || response.statusText}`);
    error.statusCode = response.status;
    throw error;
  }
  return data;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForContainerReady(containerId, accessToken) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const status = await graphRequest(`/${containerId}?fields=status_code&access_token=${accessToken}`);
    if (status.status_code === 'FINISHED') return;
    if (status.status_code === 'ERROR') {
      const error = new Error('Instagram video isleme basarisiz oldu.');
      error.statusCode = 502;
      throw error;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  const error = new Error('Instagram video isleme zaman asimina ugradi.');
  error.statusCode = 504;
  throw error;
}

export async function publishReelToInstagram({ videoUrl, caption = '' }) {
  if (!videoUrl) {
    const error = new Error('videoUrl zorunlu.');
    error.statusCode = 400;
    throw error;
  }
  const { accessToken, businessAccountId } = requireInstagramConfig();

  const container = await graphRequest(`/${businessAccountId}/media`, {
    method: 'POST',
    body: { media_type: 'REELS', video_url: videoUrl, caption, access_token: accessToken }
  });

  await waitForContainerReady(container.id, accessToken);

  const published = await graphRequest(`/${businessAccountId}/media_publish`, {
    method: 'POST',
    body: { creation_id: container.id, access_token: accessToken }
  });

  let permalink = null;
  try {
    const permalinkData = await graphRequest(`/${published.id}?fields=permalink&access_token=${accessToken}`);
    permalink = permalinkData.permalink || null;
  } catch {
    // best-effort only
  }

  return { mediaId: published.id, permalink };
}
