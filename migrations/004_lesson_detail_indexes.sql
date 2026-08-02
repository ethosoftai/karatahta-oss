-- getLessonDetailForUser / getLessonVideoForUser look up the latest
-- lesson_plans and lesson_videos row per lesson on every lesson-history
-- open (GET /api/lessons/:id). Without these indexes both queries fall
-- back to a sequential scan that gets slower as the tables grow.
create index if not exists lesson_plans_lesson_created_idx on lesson_plans(lesson_id, created_at desc);
create index if not exists lesson_videos_lesson_created_idx on lesson_videos(lesson_id, created_at desc);
