import type { VisionStatus } from '../../../modules/driver-fatigue-vision';

/** Камер `running` байхад ийм удаан фрэйм ирэхгүй бол зогссон гэж үзнэ. */
export const FRAME_STALL_MS = 2_000;

/**
 * Native тал статус илгээлгүйгээр фрэйм зогсох тохиолдлыг (камерын тасалдал,
 * тодорхойгүй алдаа) JS талд илрүүлнэ. Ингэхгүй бол UI «хянаж байна» гэж
 * харуулсаар жолооч хамгаалалтгүй болсноо мэдэхгүй.
 * `frame` болон `check` нь дамжуулах ёстой статусыг буцаана, үгүй бол null.
 */
export function createFrameWatchdog(stallMs = FRAME_STALL_MS) {
  let nativeStatus: VisionStatus = 'idle';
  let lastFrameAt: number | null = null;
  let stalled = false;

  return {
    /** Native-аас ирсэн статусыг бүртгэнэ. */
    status(status: VisionStatus, now: number) {
      nativeStatus = status;
      stalled = false;
      if (status === 'running') lastFrameAt = now;
    },
    /** Фрэйм ирэхэд дуудна. Зогссоноос сэргэсэн бол `running` буцаана. */
    frame(now: number): VisionStatus | null {
      lastFrameAt = now;
      if (!stalled) return null;
      stalled = false;
      return 'running';
    },
    /** Тогтмол дуудна. Фрэйм удаан ирээгүй бол нэг удаа `stopped` буцаана. */
    check(now: number): VisionStatus | null {
      if (nativeStatus !== 'running' || stalled || lastFrameAt === null) return null;
      if (now - lastFrameAt <= stallMs) return null;
      stalled = true;
      return 'stopped';
    },
  };
}
