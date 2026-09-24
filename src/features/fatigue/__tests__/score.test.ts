import { describe, expect, it } from 'bun:test';

import type { EyeState } from '../eyes';
import type { HeadState } from '../head';
import { computeScore, nextLevel } from '../score';
import type { YawnState } from '../yawn';

const eyes = (patch: Partial<EyeState> = {}): EyeState => ({ closed: false, closureMs: 0, perclos: 0.03, ...patch });
const head = (patch: Partial<HeadState> = {}): HeadState => ({ downDeg: 0, forwardLean: 0, droopMs: 0, quickNods: 0, ...patch });
const yawn = (patch: Partial<YawnState> = {}): YawnState => ({ open: false, openMs: 0, yawns: 0, ...patch });

describe('computeScore', () => {
  it('хэвийн жолооч бага оноотой', () => {
    expect(computeScore(eyes(), head(), yawn())).toBe(0);
  });

  it('PERCLOS 30% ба 2 жижиг дохилт өндөр оноо өгнө', () => {
    expect(computeScore(eyes({ perclos: 0.3 }), head({ quickNods: 2 }), yawn())).toBe(50);
  });
});

describe('nextLevel', () => {
  it('1.5 сек аньсан бол оноо хүлээлгүй critical', () => {
    expect(nextLevel('normal', 10, eyes({ closureMs: 1_500 }), head(), yawn())).toBe('critical');
  });

  it('удаан унжилт critical, 2 жижиг дохилт warning', () => {
    expect(nextLevel('normal', 0, eyes(), head({ droopMs: 1_600, downDeg: 25 }), yawn())).toBe('critical');
    expect(nextLevel('normal', 0, eyes(), head({ quickNods: 2 }), yawn())).toBe('warning');
  });

  it('дунд зэргийн удаан унжилтыг таньж, өнцгийн жижиг савлагаанд critical-ийг хадгална', () => {
    expect(nextLevel('normal', 0, eyes(), head({ droopMs: 1_600, downDeg: 16 }), yawn())).toBe('critical');
    expect(nextLevel('critical', 0, eyes(), head({ droopMs: 1_700, downDeg: 11 }), yawn())).toBe('critical');
    expect(nextLevel('critical', 0, eyes(), head({ droopMs: 0, downDeg: 4 }), yawn())).toBe('normal');
  });

  it('гистерезис: орох, гарах босго ялгаатай', () => {
    expect(nextLevel('normal', 35, eyes(), head(), yawn())).toBe('normal');
    expect(nextLevel('warning', 35, eyes(), head(), yawn())).toBe('warning');
    expect(nextLevel('critical', 60, eyes(), head(), yawn())).toBe('critical');
    expect(nextLevel('critical', 50, eyes(), head(), yawn())).toBe('warning');
  });

  it('5 минутад 3 эвшээлт оноо хүлээлгүй warning өгнө', () => {
    expect(nextLevel('normal', 0, eyes(), head(), yawn({ yawns: 3 }))).toBe('warning');
  });

  it('машин зогсож байхад зөвхөн удаан анилтад warning өгнө', () => {
    const stopped = { stationary: true };
    expect(nextLevel('normal', 90, eyes(), head({ droopMs: 3_000, downDeg: 30 }), yawn(), stopped)).toBe('normal');
    expect(nextLevel('critical', 0, eyes(), head(), yawn(), { ...stopped, faceMissingMs: 5_000 })).toBe('normal');
    expect(nextLevel('normal', 0, eyes({ closureMs: 1_500 }), head(), yawn(), stopped)).toBe('warning');
  });

  it('өндөр хурдад нүд аних, нүүр алга болох дохиог эрт өгнө', () => {
    expect(nextLevel('normal', 0, eyes({ closureMs: 1_000 }), head(), yawn())).toBe('normal');
    expect(nextLevel('normal', 0, eyes({ closureMs: 1_000 }), head(), yawn(), { highSpeed: true })).toBe('critical');
    expect(nextLevel('normal', 0, eyes(), head(), yawn(), { faceMissingMs: 2_000 })).toBe('warning');
    expect(nextLevel('normal', 0, eyes(), head(), yawn(), { faceMissingMs: 2_000, highSpeed: true })).toBe('critical');
  });
});
