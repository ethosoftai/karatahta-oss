export function compactLessonPlanContext(lessonPlan) {
  if (!lessonPlan || typeof lessonPlan !== 'object') {
    return null;
  }

  const segments = Array.isArray(lessonPlan.segments)
    ? lessonPlan.segments.slice(0, 10).map((segment) => ({
        id: segment?.id || null,
        title: String(segment?.title || '').slice(0, 160),
        learning_objective: String(segment?.learning_objective || '').slice(0, 240),
        narration: String(segment?.narration || '').slice(0, 320)
      }))
    : [];

  return {
    topic: String(lessonPlan.topic || '').slice(0, 240),
    core_insight: String(lessonPlan.core_insight || '').slice(0, 600),
    segments
  };
}

export function compactChatHistory(chatHistory, limit = 6) {
  if (!Array.isArray(chatHistory)) {
    return [];
  }
  return chatHistory.slice(-limit).map((message) => ({
    role: message?.role === 'assistant' ? 'assistant' : 'user',
    timestamp: String(message?.timestamp || '').slice(0, 32),
    content: String(message?.content || '').slice(0, 1200)
  }));
}
