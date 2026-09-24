import { describe, expect, it } from 'bun:test';

import { toKmh } from '../speed';

describe('toKmh', () => {
  it('м/с-ийг бүхэл км/ц болгоно', () => {
    expect(toKmh(0)).toBe(0);
    expect(toKmh(13.89)).toBe(50);
    expect(toKmh(25)).toBe(90);
  });

  it('хурд тодорхойгүй үед null буцаана', () => {
    expect(toKmh(-1)).toBeNull();
    expect(toKmh(null)).toBeNull();
    expect(toKmh(undefined)).toBeNull();
    expect(toKmh(Number.NaN)).toBeNull();
  });
});
