import type { EyeState } from './eyes';
import type { HeadState } from './head';
import type { YawnState } from './yawn';

export type FatigueLevel = 'normal' | 'warning' | 'critical';

/** Энэ хугацаанаас удаан аньсан бол оноо хүлээлгүй critical. Туршилтаар тааруулна. */
export const CRITICAL_CLOSURE_MS = 1_500;
/** Удаан унжилтын орох/гарах өнцгийг салгаж pose-ийн жижиг савлагааг тогтворжуулна. */
const CRITICAL_DROOP = { ms: 1_500, enterDeg: 15, exitDeg: 8 };
const CRITICAL_FORWARD_LEAN = { enter: 0.16, exit: 0.07 };
/** Гистерезис: түвшинд орох ба гарах оноо ялгаатай — дэлгэц анивчихгүй. */
/** 5 минутад ийм олон эвшээвэл оноо хүлээлгүй анхааруулна. */
const YAWN_WARNING = 3;
const ENTER = { warning: 40, critical: 70 };
const EXIT = { warning: 30, critical: 55 };

const unit = (value: number) => Math.min(1, Math.max(0, value));

/** 0–100 оноо. Жин нь эхлэлийн утга — шошготой туршилтаар тааруулна. */
export function computeScore(eyes: EyeState, head: HeadState, yawn: YawnState): number {
  const perclos = unit((eyes.perclos - 0.08) / 0.22) * 35;
  const closure = unit(eyes.closureMs / CRITICAL_CLOSURE_MS) * 30;
  const nods = (Math.min(head.quickNods, 2) / 2) * 15;
  const droop = unit(head.droopMs / CRITICAL_DROOP.ms) * 5;
  const yawns = (Math.min(yawn.yawns, YAWN_WARNING) / YAWN_WARNING) * 15;
  return Math.round(perclos + closure + nods + droop + yawns);
}

export function nextLevel(previous: FatigueLevel, score: number, eyes: EyeState, head: HeadState, yawn: YawnState): FatigueLevel {
  const criticalBar = previous === 'critical' ? EXIT.critical : ENTER.critical;
  const warningBar = previous === 'normal' ? ENTER.warning : EXIT.warning;
  const droopThreshold = previous === 'critical' ? CRITICAL_DROOP.exitDeg : CRITICAL_DROOP.enterDeg;
  const forwardLeanThreshold =
    previous === 'critical' ? CRITICAL_FORWARD_LEAN.exit : CRITICAL_FORWARD_LEAN.enter;
  const droop =
    head.droopMs >= CRITICAL_DROOP.ms &&
    (head.downDeg >= droopThreshold || head.forwardLean >= forwardLeanThreshold);
  const matched = {
    critical: score >= criticalBar || eyes.closureMs >= CRITICAL_CLOSURE_MS || droop,
    warning: score >= warningBar || head.quickNods >= 2 || yawn.yawns >= YAWN_WARNING,
  };
  return (['critical', 'warning'] as const).find((level) => matched[level]) ?? 'normal';
}
