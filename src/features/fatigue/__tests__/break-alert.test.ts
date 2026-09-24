import { describe, expect, it } from 'bun:test';

import { createBreakAlert } from '../break-alert';
import type { FatigueEngineState } from '../engine';

const state = (breakReminders: number) => ({ breakReminders }) as FatigueEngineState;

describe('createBreakAlert', () => {
  it('сануулга шинээр гарах бүрд нэг удаа дуугаргана', () => {
    let reminded = 0;
    const onState = createBreakAlert(() => {
      reminded += 1;
    });

    onState(state(0));
    onState(state(1));
    onState(state(1));
    onState(state(2));
    expect(reminded).toBe(2);
  });

  it('шинэ аялалд тоо 0 болоход дуугаргахгүй', () => {
    let reminded = 0;
    const onState = createBreakAlert(() => {
      reminded += 1;
    });

    onState(state(1));
    onState(state(0));
    onState(state(1));
    expect(reminded).toBe(2);
  });
});
