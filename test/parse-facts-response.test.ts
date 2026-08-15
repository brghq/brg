import { describe, it, expect } from 'vitest';
import { parseSummaryWithFacts } from '../src/context-strategies/parse-facts-response.js';

describe('parseSummaryWithFacts', () => {
  it('parses a well-formed response', () => {
    const raw = JSON.stringify({
      summary: 'did the thing',
      facts: [{ op: 'add', subject: 's', relation: 'r', object: 'o' }],
    });
    expect(parseSummaryWithFacts(raw)).toEqual({
      summary: 'did the thing',
      facts: [{ op: 'add', subject: 's', relation: 'r', object: 'o' }],
    });
  });

  it('returns an empty facts array when facts is omitted', () => {
    const raw = JSON.stringify({ summary: 'did the thing' });
    expect(parseSummaryWithFacts(raw)).toEqual({ summary: 'did the thing', facts: [] });
  });

  it('strips a ```json fenced block before parsing', () => {
    const raw = '```json\n' + JSON.stringify({ summary: 'x', facts: [] }) + '\n```';
    expect(parseSummaryWithFacts(raw)).toEqual({ summary: 'x', facts: [] });
  });

  it('strips a plain (unlabeled) fenced block before parsing', () => {
    const raw = '```\n' + JSON.stringify({ summary: 'x', facts: [] }) + '\n```';
    expect(parseSummaryWithFacts(raw)).toEqual({ summary: 'x', facts: [] });
  });

  it('returns null for plain prose (not JSON at all)', () => {
    expect(parseSummaryWithFacts('just a sentence, not json')).toBeNull();
  });

  it('returns null when summary field is missing', () => {
    expect(parseSummaryWithFacts(JSON.stringify({ facts: [] }))).toBeNull();
  });

  it('returns null when summary is an empty string', () => {
    expect(parseSummaryWithFacts(JSON.stringify({ summary: '', facts: [] }))).toBeNull();
  });

  it('returns null when summary is the wrong type', () => {
    expect(parseSummaryWithFacts(JSON.stringify({ summary: 123, facts: [] }))).toBeNull();
  });

  it('drops individual malformed fact entries instead of rejecting the whole response', () => {
    const raw = JSON.stringify({
      summary: 'x',
      facts: [
        { op: 'add', subject: 's', relation: 'r', object: 'o' },
        { op: 'invalid-op', subject: 's', relation: 'r', object: 'o' },
        { op: 'add', subject: '', relation: 'r', object: 'o' },
        { op: 'add', relation: 'r', object: 'o' },
        'not even an object',
      ],
    });
    expect(parseSummaryWithFacts(raw)).toEqual({
      summary: 'x',
      facts: [{ op: 'add', subject: 's', relation: 'r', object: 'o' }],
    });
  });

  it('treats a non-array facts field as an empty facts array rather than erroring', () => {
    const raw = JSON.stringify({ summary: 'x', facts: 'not an array' });
    expect(parseSummaryWithFacts(raw)).toEqual({ summary: 'x', facts: [] });
  });

  it('returns null for an empty string', () => {
    expect(parseSummaryWithFacts('')).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(parseSummaryWithFacts('{ "summary": "x", "facts": [')).toBeNull();
  });
});
