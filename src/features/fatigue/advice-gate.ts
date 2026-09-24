import { ENTER } from './score';

export type AdviceTrip = Readonly<{ maxScore: number; warningCount: number; criticalCount: number }>;

/**
 * Ядаргааны шинж илэрсэн аялалд л AI зөвлөгөө хүснэ. AI 5 гэх мэт бага оноонд ч
 * "зогсож амар" гэж зөвлөдөг байсан тул дохиогүй аялалд апп өөрөө бичсэн
 * мессежийг харуулна — хүсэлт, зардал ч хэмнэгдэнэ.
 */
export function needsAiAdvice(trip: AdviceTrip): boolean {
  return trip.maxScore >= ENTER.warning || trip.warningCount > 0 || trip.criticalCount > 0;
}
