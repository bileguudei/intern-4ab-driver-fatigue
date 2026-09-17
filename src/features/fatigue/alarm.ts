import type { FatigueEngineState } from './engine';
import type { FatigueLevel } from './score';

export type AlarmOutputs = {
  /** Зөөлөн, нэг удаа. */
  playWarning: () => void;
  /** Чанга, түвшин буутал давтана. */
  startCritical: () => void;
  stopCritical: () => void;
};

/**
 * Түвшин өөрчлөгдөх мөчид л дуу гаргана. Critical-аас warning руу буухад
 * зөөлөн дохио дахин дуугаргахгүй — жолооч аль хэдийн сэрсэн.
 */
export function createAlarmController(outputs: AlarmOutputs) {
  let previous: FatigueLevel = 'normal';

  return (state: FatigueEngineState) => {
    const level = state.level;
    if (level === previous) return;
    const leftCritical = previous === 'critical';
    if (leftCritical) outputs.stopCritical();
    if (level === 'critical') outputs.startCritical();
    if (level === 'warning' && !leftCritical) outputs.playWarning();
    previous = level;
  };
}
