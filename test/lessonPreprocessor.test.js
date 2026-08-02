import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLessonAnalysisPrompt,
  buildQuestionImageTranscriptionPrompt,
  fallbackLessonAnalysis,
  parseLessonAnalysis
} from '../services/lessonPreprocessor.js';

test('soru fotografi transkript promptu cozum istemez, sadece metne doker', () => {
  const prompt = buildQuestionImageTranscriptionPrompt();
  assert.match(prompt, /SADECE/);
  assert.match(prompt, /cozme/);
});

test('konu modu analiz promptu genis sure araligi ve kaynak metinleri icerir', () => {
  const { systemInstruction, userText } = buildLessonAnalysisPrompt({
    rawText: 'Fotosentez nasil calisir',
    mode: 'topic',
    studentLevel: 'beginner'
  });
  assert.match(systemInstruction, /2-20 dakika/);
  assert.match(systemInstruction, /clean_prompt/);
  assert.match(userText, /Fotosentez nasil calisir/);
});

test('soru modu analiz promptu kisa sure araligi kullanir ve foto transkriptini de ekler', () => {
  const { systemInstruction, userText } = buildLessonAnalysisPrompt({
    rawText: '',
    mode: 'question',
    imageTranscript: '2x + 3 = 7 ise x kactir?'
  });
  assert.match(systemInstruction, /0\.5-3 dakika/);
  assert.match(userText, /2x \+ 3 = 7/);
});

test('gecerli JSON yanitini sinirlar icinde ayristirir', () => {
  const result = parseLessonAnalysis(
    JSON.stringify({
      title: 'Fotosentez Anlatimi',
      clean_prompt: 'Fotosentezin isik ve karanlik evrelerini ornekle anlat.',
      target_duration_minutes: 8,
      target_segment_count: 6
    }),
    { mode: 'topic' }
  );
  assert.equal(result.title, 'Fotosentez Anlatimi');
  assert.equal(result.target_duration_minutes, 8);
  assert.equal(result.target_segment_count, 6);
  assert.equal(result.usedFallback, false);
});

test('sinir disi degerleri mod araligina kirpiyor', () => {
  const result = parseLessonAnalysis(
    JSON.stringify({
      title: 'x',
      clean_prompt: 'y',
      target_duration_minutes: 999,
      target_segment_count: 999
    }),
    { mode: 'question' }
  );
  assert.equal(result.target_duration_minutes, 3);
  assert.equal(result.target_segment_count, 3);
});

test('bozuk JSON yanitinda ham metne dusup usedFallback isaretler', () => {
  const result = parseLessonAnalysis('not json at all', {
    mode: 'question',
    rawText: '',
    imageTranscript: 'Bir ucgenin ic acilari toplami kactir?'
  });
  assert.equal(result.usedFallback, true);
  assert.equal(result.clean_prompt, 'Bir ucgenin ic acilari toplami kactir?');
  assert.equal(result.target_duration_minutes, 1);
  assert.equal(result.target_segment_count, 1);
});

test('fallbackLessonAnalysis girdi metninden kisa baslik ve varsayilan sure uretir', () => {
  const result = fallbackLessonAnalysis({
    rawText: 'Turevin gunluk hayattaki kullanimi',
    mode: 'topic'
  });
  assert.equal(result.title, 'Turevin gunluk hayattaki kullanimi');
  assert.equal(result.clean_prompt, result.title);
  assert.equal(result.target_duration_minutes, 10);
  assert.equal(result.target_segment_count, 8);
  assert.equal(result.usedFallback, true);
});

test('60 karakteri asan baslik uc nokta ile kisaltilir', () => {
  const longText = 'a'.repeat(100);
  const result = fallbackLessonAnalysis({ rawText: longText, mode: 'question' });
  assert.equal(result.title.length, 60);
  assert.ok(result.title.endsWith('…'));
});
