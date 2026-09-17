import { describe, expect, it } from 'bun:test';

import { createAlarmController } from '../alarm';
import type { FatigueEngineState } from '../engine';
import type { FatigueLevel } from '../score';

function setup() {
  const calls: string[] = [];
  const onState = createAlarmController({
    playWarning: () => calls.push('warning'),
    startCritical: () => calls.push('critical'),
    stopCritical: () => calls.push('stop'),
  });
  const emit = (level: FatigueLevel) => onState({ level } as FatigueEngineState);
  return { calls, emit };
}

describe('createAlarmController', () => {
  it('түвшин өсөх мөчид л дуугарна, ижил түвшинд давтахгүй', () => {
    const { calls, emit } = setup();
    ['normal', 'warning', 'warning', 'critical', 'critical'].forEach((l) => emit(l as FatigueLevel));
    expect(calls).toEqual(['warning', 'critical']);
  });

  it('critical-аас буухад зогсоож, warning-ийг дахин дуугаргахгүй', () => {
    const { calls, emit } = setup();
    ['critical', 'warning', 'normal'].forEach((l) => emit(l as FatigueLevel));
    expect(calls).toEqual(['critical', 'stop']);
  });

  it('шууд хэвийн болоход critical дуу зогсоно', () => {
    const { calls, emit } = setup();
    ['critical', 'normal', 'warning'].forEach((l) => emit(l as FatigueLevel));
    expect(calls).toEqual(['critical', 'stop', 'warning']);
  });
});
