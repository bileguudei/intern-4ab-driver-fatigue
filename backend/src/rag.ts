export interface VectorMatch {
  id: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export interface NormalizedAdviceRequest {
  sessionId: string | null;
  driverId: number | null;
  fatigueScore: number;
  averageFatigueScore: number | null;
  maxFatigueScore: number | null;
  driveDurationMinutes: number | null;
  prolongedEyeClosureCount: number | null;
  headNodCount: number | null;
  perclos: number | null;
  /** Аялалд гарсан анхааруулга, аюултай дохионы тоо. Хуучин апп илгээдэггүй. */
  warningCount?: number | null;
  criticalCount?: number | null;
}

/**
 * Апп-ын дохионы босготой ижил (src/features/fatigue/score.ts): оноо 0–100,
 * 40-өөс warning, 70-аас critical. AI онооны хэмжээсийг таахгүйн тулд
 * эрсдэлийг кодоор тогтоож prompt-д шууд хэлнэ.
 */
export const FATIGUE_THRESHOLDS = { warning: 40, critical: 70 } as const;

export type FatigueRisk = "low" | "moderate" | "high";

export const FATIGUE_SCALE_NOTE =
  "Fatigue scores use a 0-100 scale: 0-39 is normal, 40-69 is a warning, 70-100 is critical.";

export function classifyFatigueRisk(data: NormalizedAdviceRequest): FatigueRisk {
  const peak = Math.max(data.fatigueScore, data.maxFatigueScore ?? 0);
  if (
    peak >= FATIGUE_THRESHOLDS.critical ||
    (data.criticalCount ?? 0) > 0 ||
    (data.prolongedEyeClosureCount ?? 0) > 0
  ) {
    return "high";
  }
  if (
    peak >= FATIGUE_THRESHOLDS.warning ||
    (data.warningCount ?? 0) > 0 ||
    (data.headNodCount ?? 0) >= 2
  ) {
    return "moderate";
  }
  return "low";
}

/** Эрсдэлийн түвшинд тохирсон заавар — бага эрсдэлд зогсохыг зөвлөхгүй. */
export function adviceRiskInstruction(risk: FatigueRisk): string {
  if (risk === "high") {
    return "Serious fatigue signs were detected. Recommend stopping at the nearest safe place to rest before continuing.";
  }
  if (risk === "moderate") {
    return "Early fatigue signs were detected. Recommend a break at the next safe place soon, without overstating the danger.";
  }
  return "The driver showed no fatigue warning signs. Do NOT tell the driver to stop, pull over or that they are too tired to drive, and do not mention legal penalties. Give at most two short preventive tips, such as regular breaks on long trips and enough sleep.";
}

/** Апп PERCLOS-ыг 0–1 бутархайгаар илгээдэг — хувиар бичвэл AI зөв ойлгоно. */
export function formatPerclos(perclos: number | null): string {
  if (perclos === null) return "n/a";
  const percent = perclos <= 1 ? perclos * 100 : perclos;
  return `${Math.round(percent)}%`;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function asPositiveInteger(value: unknown): number | null {
  const parsed = asNumber(value);
  if (parsed === null) return null;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function normalizeAdviceRequest(
  payload: unknown,
): NormalizedAdviceRequest {
  const body =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};

  const fatigueScore = asNumber(body.fatigueScore);
  if (fatigueScore === null) {
    throw new Error("fatigueScore is required and must be a number");
  }

  return {
    sessionId: asString(body.sessionId) ?? asString(body.session_id) ?? null,
    driverId:
      asPositiveInteger(body.driverId) ??
      asPositiveInteger(body.driver_id) ??
      null,
    fatigueScore,
    averageFatigueScore:
      asNumber(body.averageFatigueScore) ??
      asNumber(body.average_fatigue_score) ??
      null,
    maxFatigueScore:
      asNumber(body.maxFatigueScore) ??
      asNumber(body.max_fatigue_score) ??
      null,
    driveDurationMinutes:
      asNumber(body.driveDurationMinutes) ??
      asNumber(body.drive_duration_minutes) ??
      null,
    prolongedEyeClosureCount:
      asNumber(body.prolongedEyeClosureCount) ??
      asNumber(body.prolonged_eye_closure_count) ??
      null,
    headNodCount:
      asNumber(body.headNodCount) ?? asNumber(body.head_nod_count) ?? null,
    perclos: asNumber(body.perclos) ?? null,
    warningCount:
      asNumber(body.warningCount) ?? asNumber(body.warning_count) ?? null,
    criticalCount:
      asNumber(body.criticalCount) ?? asNumber(body.critical_count) ?? null,
  };
}

export function buildAdviceQuery(data: NormalizedAdviceRequest): string {
  const risk = classifyFatigueRisk(data);
  const parts = [
    `Driver fatigue score is ${data.fatigueScore}.`,
    data.averageFatigueScore !== null
      ? `Average fatigue score is ${data.averageFatigueScore}.`
      : null,
    data.maxFatigueScore !== null
      ? `Maximum fatigue score is ${data.maxFatigueScore}.`
      : null,
    data.driveDurationMinutes !== null
      ? `The trip lasted ${data.driveDurationMinutes} minutes.`
      : null,
    data.prolongedEyeClosureCount !== null
      ? `There were ${data.prolongedEyeClosureCount} prolonged eye closure events.`
      : null,
    data.headNodCount !== null
      ? `There were ${data.headNodCount} head nod events.`
      : null,
    data.warningCount !== null && data.warningCount !== undefined
      ? `There were ${data.warningCount} fatigue warnings.`
      : null,
    data.criticalCount !== null && data.criticalCount !== undefined
      ? `There were ${data.criticalCount} critical fatigue alerts.`
      : null,
    data.perclos !== null
      ? `The PERCLOS indicator (share of time with eyes closed) is ${formatPerclos(data.perclos)}.`
      : null,
    FATIGUE_SCALE_NOTE,
    `Overall fatigue risk is ${risk.toUpperCase()}.`,
    // Хайлтын асуулга эрсдэлд тохирсон материал олоход нөлөөлнө.
    risk === "low"
      ? "What preventive guidance helps a driver who shows no fatigue signs stay alert?"
      : risk === "moderate"
        ? "What guidance is relevant for early signs of driver fatigue?"
        : "What urgent safety guidance is relevant for a severely fatigued driver?",
  ].filter(
    (part): part is string => typeof part === "string" && part.length > 0,
  );

  return parts.join(" ");
}

export function chunkText(
  text: string,
  options: { chunkSize?: number; overlap?: number } = {},
): string[] {
  const chunkSize = Math.max(32, options.chunkSize ?? 800);
  const overlap = Math.max(0, Math.min(options.overlap ?? 120, chunkSize - 1));
  const normalized = text.replace(/\s+/g, " ").trim();

  if (!normalized) return [];

  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    const end = Math.min(start + chunkSize, normalized.length);
    const chunk = normalized.slice(start, end).trim();
    if (!chunk) break;
    chunks.push(chunk);
    if (end >= normalized.length) break;
    start = Math.max(start + chunkSize - overlap, start + 1);
  }

  return chunks;
}

export function createVectorMetadata(input: {
  documentId: string;
  chunkId: string;
  category: string;
  title: string;
  source: string;
}): Record<string, unknown> {
  return {
    documentId: input.documentId,
    chunkId: input.chunkId,
    category: input.category,
    title: input.title,
    source: input.source,
  };
}

/**
 * Апп зөвлөгөөг энгийн Text-ээр харуулдаг тул Markdown тэмдэг (**, *, #)
 * жолоочид шууд харагдана. Загвар prompt-ыг дагаагүй үед ч цэвэрлэнэ.
 */
export function toPlainText(text: string): string {
  return text
    .replace(/^\s*#{1,6}\s*/gm, "")
    .replace(/^(\s*)[*•]\s+/gm, "$1- ")
    .replace(/\*/g, "")
    .replace(/__(.+?)__/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function selectRelevantChunks(
  matches: Array<{
    id?: string;
    score?: number;
    metadata?: Record<string, unknown>;
  }>,
  threshold = 0.45,
): Array<{ id: string; score: number; metadata: Record<string, unknown> }> {
  return matches
    .filter(
      (match) => typeof match?.score === "number" && match.score >= threshold,
    )
    .map((match) => ({
      id: String(match.id ?? "unknown"),
      score: Number(match.score ?? 0),
      metadata: match.metadata ?? {},
    }))
    .sort((a, b) => b.score - a.score);
}
