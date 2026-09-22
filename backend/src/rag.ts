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
  };
}

export function buildAdviceQuery(data: NormalizedAdviceRequest): string {
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
    data.perclos !== null ? `The PERCLOS indicator is ${data.perclos}.` : null,
    "What safety guidance is relevant for this driver state?",
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
