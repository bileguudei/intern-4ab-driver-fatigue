export type TabName = "home" | "history" | "settings";
export type FlowScreen =
  | "camera"
  | "calibration"
  | "driving"
  | "summary"
  | "advice";
export type Route =
  | { kind: "tabs"; tab: TabName }
  | { kind: "flow"; screen: FlowScreen };

export type SessionSummary = {
  durationSeconds: number;
  warningCount: number;
  criticalCount: number;
  maxScore: number;
  avgScore: number;
  /** Аяллын дундаж PERCLOS (0…1). Хэмжээгүй бол null. */
  perclos?: number | null;
  /** 1.5 сек-ээс удаан аньсан удаа. */
  longClosureCount?: number;
  /** Жижиг, хурдан толгой дохилтын тоо. */
  quickNodCount?: number;
  /** GPS-ээр тооцсон явсан зай. */
  distanceKm?: number;
  /** Явж байх үеийн дундаж хурд. Хэмжээгүй бол null. */
  avgSpeedKmh?: number | null;
  maxSpeedKmh?: number | null;
  /** Нүд аньсан хугацаанд машин явсан хамгийн их зай. */
  maxBlindDistanceM?: number;
};

export type FatigueState = "normal" | "warning" | "critical";
