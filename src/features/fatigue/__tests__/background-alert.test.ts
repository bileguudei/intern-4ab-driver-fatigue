import { describe, expect, it } from 'bun:test';

import { createBackgroundAlert } from '../background-alert';
import type { FatigueEngineState } from '../engine';

describe('createBackgroundAlert', () => {
  it('камер зогсоход нэг удаа анхааруулж, буцахад сануулгыг цуцална', () => {
    const calls: string[] = [];
    const onState = createBackgroundAlert({
      alertNow: () => calls.push('alert'),
      scheduleReminders: () => calls.push('schedule'),
      cancelReminders: () => calls.push('cancel'),
    });
    const emit = (cameraStatus: FatigueEngineState['cameraStatus']) => onState({ cameraStatus } as FatigueEngineState);

    ['running', 'stopped', 'stopped', 'starting', 'running'].forEach((s) => emit(s as FatigueEngineState['cameraStatus']));
    expect(calls).toEqual(['alert', 'schedule', 'cancel']);
  });
});
