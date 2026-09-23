import type { FatigueEngineState } from './engine';

/**
 * Завсарлагын сануулга шинээр гарах бүрд нэг удаа дуугаргана. Engine
 * breakReminders-ийг 2 цаг тасралтгүй явсны дараа, дараа нь 30 минут тутам
 * нэмэгдүүлдэг. Шинэ аялалд 0 болоход дуугаргахгүй.
 */
export function createBreakAlert(remind: () => void) {
  let seen = 0;

  return (state: FatigueEngineState) => {
    if (state.breakReminders > seen) remind();
    seen = state.breakReminders;
  };
}
