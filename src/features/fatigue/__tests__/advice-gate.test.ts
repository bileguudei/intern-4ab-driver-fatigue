import { describe, expect, it } from 'bun:test';

import { needsAiAdvice } from '../advice-gate';

describe('needsAiAdvice', () => {
  it('ядаргааны шинж илрээгүй аялалд AI дуудахгүй', () => {
    expect(needsAiAdvice({ maxScore: 5, warningCount: 0, criticalCount: 0 })).toBe(false);
    expect(needsAiAdvice({ maxScore: 39, warningCount: 0, criticalCount: 0 })).toBe(false);
  });

  it('оноо анхааруулгын босгод хүрвэл AI дуудна', () => {
    expect(needsAiAdvice({ maxScore: 40, warningCount: 0, criticalCount: 0 })).toBe(true);
  });

  it('анхааруулга эсвэл аюултай дохио гарсан бол AI дуудна', () => {
    expect(needsAiAdvice({ maxScore: 10, warningCount: 1, criticalCount: 0 })).toBe(true);
    expect(needsAiAdvice({ maxScore: 10, warningCount: 0, criticalCount: 1 })).toBe(true);
  });
});
