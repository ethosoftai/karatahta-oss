import { createClient } from '@supabase/supabase-js';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const supabaseUrl = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const devUserId = process.env.DEV_USER_ID;
const storagePublic = String(process.env.SUPABASE_STORAGE_PUBLIC || 'false').toLowerCase() === 'true';

export const supabaseConfigured = Boolean(supabaseUrl && serviceRoleKey && devUserId);
export const supabaseAuthConfigured = Boolean(supabaseUrl && anonKey);

export const supabase = supabaseConfigured
  ? createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    })
  : null;

const supabaseAuth = supabaseAuthConfigured
  ? createClient(supabaseUrl, anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    })
  : null;

let devProfileReady = false;

function requireSupabase() {
  if (!supabaseConfigured || !supabase) {
    throw new Error('Supabase ayarlari eksik.');
  }
  return supabase;
}

async function ensureDevProfile() {
  if (devProfileReady) {
    return;
  }
  const client = requireSupabase();
  const { error } = await client
    .from('profiles')
    .upsert({
      id: devUserId,
      display_name: 'Dev User'
    }, {
      onConflict: 'id'
    });
  if (error) throw error;
  devProfileReady = true;
}

function displayNameFromAuthUser(user, fallbackEmail) {
  return user?.user_metadata?.display_name
    || user?.user_metadata?.name
    || fallbackEmail?.split('@')[0]
    || user?.email?.split('@')[0]
    || 'Kara Tahta Kullanıcısı';
}

export async function upsertProfileFromAuthUser(user) {
  if (!user?.id) {
    throw new Error('Gecerli Supabase auth kullanicisi bulunamadi.');
  }

  const client = requireSupabase();
  const email = user.email || null;
  const fullPayload = {
    auth_user_id: user.id,
    email,
    display_name: displayNameFromAuthUser(user, email),
    avatar_url: user.user_metadata?.avatar_url || null,
    last_seen_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  let { data, error } = await client
    .from('profiles')
    .upsert(fullPayload, {
      onConflict: 'auth_user_id'
    })
    .select('*')
    .single();
  if (error && /column .* does not exist/i.test(error.message || '')) {
    const fallback = await client
      .from('profiles')
      .upsert({
        auth_user_id: user.id,
        display_name: fullPayload.display_name
      }, {
        onConflict: 'auth_user_id'
      })
      .select('*')
      .single();
    data = fallback.data;
    error = fallback.error;
  }
  if (error) throw error;
  return data;
}

export async function getProfileForAccessToken(accessToken) {
  if (!supabaseAuth) {
    throw new Error('Supabase auth ayarlari eksik.');
  }
  const { data, error } = await supabaseAuth.auth.getUser(accessToken);
  if (error || !data?.user) {
    const authError = new Error('Oturum gecersiz veya suresi dolmus.');
    authError.statusCode = 401;
    throw authError;
  }
  return upsertProfileFromAuthUser(data.user);
}

export async function signUpWithPassword({ email, password, displayName }) {
  if (!supabaseAuth) {
    throw new Error('Supabase auth ayarlari eksik.');
  }
  const { data, error } = await supabaseAuth.auth.signUp({
    email,
    password,
    options: {
      data: {
        display_name: displayName || email.split('@')[0]
      }
    }
  });
  if (error) throw error;
  const profile = data.user ? await upsertProfileFromAuthUser(data.user) : null;
  return { session: data.session, user: data.user, profile };
}

export async function signInWithPassword({ email, password }) {
  if (!supabaseAuth) {
    throw new Error('Supabase auth ayarlari eksik.');
  }
  const { data, error } = await supabaseAuth.auth.signInWithPassword({ email, password });
  if (error) throw error;
  const profile = data.user ? await upsertProfileFromAuthUser(data.user) : null;
  return { session: data.session, user: data.user, profile };
}

export async function refreshAuthSession(refreshToken) {
  if (!supabaseAuth) {
    throw new Error('Supabase auth ayarlari eksik.');
  }
  const { data, error } = await supabaseAuth.auth.refreshSession({ refresh_token: refreshToken });
  if (error) throw error;
  const profile = data.user ? await upsertProfileFromAuthUser(data.user) : null;
  return { session: data.session, user: data.user, profile };
}

function dataUrlToBuffer(dataUrl) {
  const raw = String(dataUrl || '');
  const base64 = raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw;
  return Buffer.from(base64, 'base64');
}

function safePathPart(value) {
  return String(value || 'item').replace(/[^\w.-]/g, '_').slice(0, 80) || 'item';
}

function extensionFromMime(mimeType) {
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/webp') return '.webp';
  if (mimeType === 'audio/mpeg') return '.mp3';
  if (mimeType === 'video/mp4') return '.mp4';
  return mimeType?.startsWith('image/') ? '.jpg' : '';
}

async function insertRow(table, payload) {
  const client = requireSupabase();
  const { data, error } = await client.from(table).insert(payload).select('*').single();
  if (error) throw error;
  return data;
}

async function updateRows(table, match, payload) {
  const client = requireSupabase();
  let query = client.from(table).update(payload);
  Object.entries(match).forEach(([key, value]) => {
    query = query.eq(key, value);
  });
  const { data, error } = await query.select('*');
  if (error) throw error;
  return data;
}

async function uploadBuffer(bucket, storagePath, buffer, contentType) {
  const client = requireSupabase();
  const { error } = await client.storage
    .from(bucket)
    .upload(storagePath, buffer, {
      contentType,
      upsert: true
    });
  if (error) throw error;

  let publicUrl = null;
  if (storagePublic) {
    const { data } = client.storage.from(bucket).getPublicUrl(storagePath);
    publicUrl = data?.publicUrl || null;
  }

  return { bucket, storagePath, publicUrl };
}

export function userId() {
  return devUserId;
}

export async function createLesson({ userId = devUserId, title, topic, studentLevel, targetMinutes, targetSegmentCount, sourceType }) {
  if (userId === devUserId) {
    await ensureDevProfile();
  }
  return insertRow('lessons', {
    user_id: userId,
    title: title || topic || 'Yeni ders',
    topic: topic || title || null,
    student_level: studentLevel || null,
    target_minutes: targetMinutes || null,
    target_segment_count: targetSegmentCount || null,
    status: 'planned',
    source_type: sourceType || 'topic'
  });
}

export async function updateLesson(lessonId, patch) {
  if (!lessonId) return null;
  const rows = await updateRows('lessons', { id: lessonId }, {
    ...patch,
    updated_at: new Date().toISOString()
  });
  return rows?.[0] || null;
}

export async function getLessonForUser({ lessonId, userId }) {
  if (!lessonId || !userId) return null;
  const client = requireSupabase();
  const { data, error } = await client
    .from('lessons')
    .select('*')
    .eq('id', lessonId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function listLessonsForUser({ userId, limit = 30 }) {
  if (!userId) return [];
  const client = requireSupabase();
  const { data, error } = await client
    .from('lessons')
    .select(`
      id,
      title,
      topic,
      status,
      source_type,
      created_at,
      updated_at,
      lesson_videos (
        id,
        local_video_path,
        video_storage_path,
        duration_seconds,
        created_at
      )
    `)
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).map((lesson) => ({
    ...lesson,
    latest_video: [...(lesson.lesson_videos || [])]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0] || null,
    lesson_videos: undefined
  }));
}

export async function getLessonDetailForUser({ lessonId, userId }) {
  const lesson = await getLessonForUser({ lessonId, userId });
  if (!lesson) return null;

  const client = requireSupabase();
  const [
    planResult,
    segmentsResult,
    videoResult,
    chatResult
  ] = await Promise.all([
    client
      .from('lesson_plans')
      .select('*')
      .eq('lesson_id', lessonId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    client
      .from('lesson_segments')
      .select('*')
      .eq('lesson_id', lessonId)
      .order('order_index', { ascending: true }),
    client
      .from('lesson_videos')
      .select('*')
      .eq('lesson_id', lessonId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    client
      .from('chats')
      .select('id')
      .eq('lesson_id', lessonId)
      .eq('user_id', userId)
      .maybeSingle()
  ]);

  for (const result of [planResult, segmentsResult, videoResult, chatResult]) {
    if (result.error) throw result.error;
  }

  let messages = [];
  if (chatResult.data?.id) {
    const messagesResult = await client
      .from('chat_messages')
      .select('*')
      .eq('chat_id', chatResult.data.id)
      .order('created_at', { ascending: true });
    if (messagesResult.error) throw messagesResult.error;
    messages = messagesResult.data || [];
  }

  return {
    lesson,
    plan: planResult.data?.plan_json || null,
    segments: segmentsResult.data || [],
    video: videoResult.data || null,
    chat: chatResult.data || null,
    messages
  };
}

export async function savePlan({ lessonId, provider, model, prompt, plan, rawResponse }) {
  return insertRow('lesson_plans', {
    lesson_id: lessonId,
    provider,
    model,
    prompt: prompt || null,
    plan_json: plan,
    raw_response: rawResponse || null
  });
}

export async function saveSegments({ lessonId, segments }) {
  const client = requireSupabase();
  const rows = (segments || []).map((segment, index) => ({
    lesson_id: lessonId,
    segment_key: segment.id || `s${index + 1}`,
    title: segment.title || null,
    duration_seconds: segment.duration_seconds || null,
    learning_objective: segment.learning_objective || null,
    narration: segment.narration || null,
    animation_json: segment.animation || null,
    order_index: index,
    status: 'planned'
  }));
  if (!rows.length) return [];
  const { data, error } = await client
    .from('lesson_segments')
    .upsert(rows, { onConflict: 'lesson_id,segment_key' })
    .select('*');
  if (error) throw error;
  return data || [];
}

export async function getSegment({ lessonId, segmentKey }) {
  if (!lessonId || !segmentKey) return null;
  const client = requireSupabase();
  const { data, error } = await client
    .from('lesson_segments')
    .select('*')
    .eq('lesson_id', lessonId)
    .eq('segment_key', segmentKey)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateSegment(segmentId, patch) {
  if (!segmentId) return null;
  const rows = await updateRows('lesson_segments', { id: segmentId }, {
    ...patch,
    updated_at: new Date().toISOString()
  });
  return rows?.[0] || null;
}

export async function saveSpeechScript({ segmentId, provider, model, speech }) {
  return insertRow('speech_scripts', {
    segment_id: segmentId,
    provider,
    model,
    speech_json: speech,
    speech_text: speech?.speech_text || null,
    cue_plan: speech?.cue_plan || null,
    duration_seconds: speech?.estimated_seconds || null
  });
}

export async function saveManimCode({ segmentId, provider, model, code, attempt = 1, isRepair = false, repairReason = null, renderError = null }) {
  return insertRow('manim_codes', {
    segment_id: segmentId || null,
    provider,
    model,
    code,
    attempt,
    is_repair: isRepair,
    repair_reason: repairReason,
    render_error: renderError
  });
}

export async function uploadLocalFile({ bucket, localPath, storagePath, contentType }) {
  const buffer = await fs.readFile(localPath);
  return uploadBuffer(bucket, storagePath, buffer, contentType);
}

export async function uploadDataUrl({ bucket, dataUrl, storagePath, contentType }) {
  return uploadBuffer(bucket, storagePath, dataUrlToBuffer(dataUrl), contentType);
}

export function storagePathFor({ userId = devUserId, lessonId, segmentKey, kind, fileName }) {
  const parts = ['users', userId, 'lessons', lessonId];
  if (segmentKey) {
    parts.push('segments', safePathPart(segmentKey));
  }
  parts.push(kind, safePathPart(fileName));
  return parts.join('/');
}

export async function saveTtsOutput({ segmentId, voiceName, speakingRate, durationSeconds, storagePath, publicUrl }) {
  return insertRow('tts_outputs', {
    segment_id: segmentId,
    provider: 'google_cloud',
    voice_name: voiceName || null,
    speaking_rate: speakingRate || null,
    duration_seconds: durationSeconds || null,
    storage_path: storagePath || null,
    public_url: publicUrl || null
  });
}

export async function saveVideoRender({ segmentId, manimCodeId, quality, videoStoragePath, localVideoPath, audioStoragePath, backgroundMusicPath, durationSeconds, stdout, stderr }) {
  return insertRow('video_renders', {
    segment_id: segmentId || null,
    manim_code_id: manimCodeId || null,
    quality,
    status: 'done',
    video_storage_path: videoStoragePath || null,
    local_video_path: localVideoPath || null,
    audio_storage_path: audioStoragePath || null,
    background_music_path: backgroundMusicPath || null,
    duration_seconds: durationSeconds || null,
    stdout: stdout || null,
    stderr: stderr || null
  });
}

export async function saveLessonVideo({ lessonId, videoStoragePath, localVideoPath, durationSeconds, segmentRenderIds }) {
  return insertRow('lesson_videos', {
    lesson_id: lessonId,
    status: 'done',
    video_storage_path: videoStoragePath || null,
    local_video_path: localVideoPath || null,
    duration_seconds: durationSeconds || null,
    segment_render_ids: segmentRenderIds || []
  });
}

export async function createGenerationJob({ appJobId, lessonId, total, current, message }) {
  return insertRow('generation_jobs', {
    app_job_id: appJobId,
    lesson_id: lessonId || null,
    status: 'queued',
    progress: 0,
    total: total || 0,
    current: current || null,
    message: message || null
  });
}

export async function updateGenerationJob(appJobId, patch) {
  const rows = await updateRows('generation_jobs', { app_job_id: appJobId }, {
    status: patch.status,
    progress: patch.progress,
    total: patch.total,
    current: patch.current,
    message: patch.message,
    error: patch.error,
    completed_at: patch.completedAt || null,
    updated_at: new Date().toISOString()
  });
  return rows?.[0] || null;
}

export async function appendGenerationEvent({ jobId, lessonId, segmentId, level = 'info', message, payload }) {
  return insertRow('generation_events', {
    job_id: jobId || null,
    lesson_id: lessonId || null,
    segment_id: segmentId || null,
    level,
    message,
    payload: payload || null
  });
}

export async function getOrCreateChat({ userId = devUserId, lessonId }) {
  if (userId === devUserId) {
    await ensureDevProfile();
  }
  const client = requireSupabase();
  const { data: existing, error: selectError } = await client
    .from('chats')
    .select('*')
    .eq('lesson_id', lessonId)
    .eq('user_id', userId)
    .maybeSingle();
  if (selectError) throw selectError;
  if (existing) return existing;
  return insertRow('chats', {
    lesson_id: lessonId,
    user_id: userId
  });
}

export async function saveChatMessage({ chatId, role, content, timestampSeconds, timestampLabel, frameAttachmentId, provider, model, context }) {
  return insertRow('chat_messages', {
    chat_id: chatId,
    role,
    content,
    timestamp_seconds: timestampSeconds || null,
    timestamp_label: timestampLabel || null,
    frame_attachment_id: frameAttachmentId || null,
    provider: provider || null,
    model: model || null,
    context_json: context || null
  });
}

export async function saveAttachment({ userId = devUserId, lessonId, chatMessageId = null, type, mimeType, storagePath, metadata }) {
  if (userId === devUserId) {
    await ensureDevProfile();
  }
  return insertRow('attachments', {
    lesson_id: lessonId || null,
    chat_message_id: chatMessageId,
    user_id: userId,
    type,
    mime_type: mimeType || null,
    storage_path: storagePath || null,
    metadata: metadata || null
  });
}

export function fileNameFromLocalPath(localPath, fallbackName) {
  return safePathPart(path.basename(localPath || fallbackName || 'file'));
}

export function extensionFromContentType(mimeType) {
  return extensionFromMime(mimeType);
}
