import type { ComputerVisionObservation, FaceBounds } from '@/features/computer-vision';

import type { Baseline } from './calibration';
import { MAX_FRAME_MS } from './eyes';

/** Суурь байрлалаас доош хэдэн градус бөхийвөл дохилт эхэлсэн гэж үзэх. */
const NOD_START_DEG = 10;
/** Гистерезис — босгыг шүргэх хэлбэлзэлд дохилт тасрахгүй. */
const NOD_END_DEG = 5;
/** Нэг буруу pose утга дохилтыг таслахгүйн тулд сүүлийн хэдэн фрэймийн медиан. */
const POSE_FILTER_WINDOW_MS = 400;
const POSE_FILTER_MAX_SAMPLES = 5;
/** Толгой доошлоход landmark түр алга болдог тул богино тасалдлыг үргэлжлэл гэж үзнэ. */
const TRACKING_LOSS_GRACE_MS = 700;
/** Калибрацийн нүүрний өндрийн ийм хувиар доош-урагш шилжвэл унжилт эхэлнэ. */
const FORWARD_LEAN_START_RATIO = 0.12;
const FORWARD_LEAN_END_RATIO = 0.05;
/** Ойртож нүүр томрох нь доош шилжилтийг дэмжих боловч дангаараа дохио болохгүй. */
const FACE_SCALE_WEIGHT = 0.25;
/**
 * Тонгойсон байрлалд нүд нээлттэй, толгой эгц, хүрээ тогтвортой ийм удаан байвал
 * суудал эсвэл утасны шинэ байрлал гэж үзэж урагш бөхийлтийн суурийг шинэчилнэ.
 * Богино тонгойлт critical хэвээр илэрнэ. Зөвхөн сэрүүн жолоочид дохио аяллын
 * турш тасралтгүй дуугарахаас сэргийлнэ. Ердийн анивчилт хугацааг тасалдуулахгүй.
 */
const LEAN_REANCHOR = { stableMs: 10_000, maxRange: 0.04, blinkGraceMs: 500 };
/**
 * «Унжаад гэнэт өндийх» жижиг дохилт. Хэмжилтэд толгой 0.75 сек-т +30° хүртэл
 * бөхийсөн. Удаан доош харах (утас, самбар) 3 сек-ээс урт тул тоологдохгүй.
 */
const QUICK_NOD = { minMs: 300, maxMs: 3_000, maxRecoveryMs: 700 };
const NOD_WINDOW_MS = 60_000;

export type HeadState = Readonly<{
  /** Суурьтай харьцуулсан бөхийлт, градус. Эерэг = доош. */
  downDeg: number;
  /** Калибрацийн нүүрний өндөртэй харьцуулсан доош-урагш шилжилт. */
  forwardLean: number;
  /** Одоогийн дохилт хэдэн мс үргэлжилж байна. Толгой шулуун бол 0. */
  droopMs: number;
  /** Сүүлийн 60 сек-ийн жижиг, хурдан өндийсөн дохилтын тоо. */
  quickNods: number;
}>;

type Episode = { start: number; peak: number; peakAt: number; last: number };
type DownSample = { t: number; value: number };
type SteadyLean = { since: number; minY: number; maxY: number; minH: number; maxH: number };

/** Тонгойсон байрлал тогтвортой үргэлжилж буй эсэхийг хүрээний хэлбэлзлээр шалгана. */
function extendSteadyLean(previous: SteadyLean | null, t: number, bounds: FaceBounds): SteadyLean {
  const fresh = { since: t, minY: bounds.centerY, maxY: bounds.centerY, minH: bounds.height, maxH: bounds.height };
  if (previous === null) return fresh;
  const next = {
    since: previous.since,
    minY: Math.min(previous.minY, bounds.centerY),
    maxY: Math.max(previous.maxY, bounds.centerY),
    minH: Math.min(previous.minH, bounds.height),
    maxH: Math.max(previous.maxH, bounds.height),
  };
  const steady =
    next.maxY - next.minY <= LEAN_REANCHOR.maxRange && next.maxH - next.minH <= LEAN_REANCHOR.maxRange;
  return steady ? next : fresh;
}

const isQuickNod = (episode: Episode, end: number) =>
  end - episode.start >= QUICK_NOD.minMs &&
  end - episode.start <= QUICK_NOD.maxMs &&
  end - episode.peakAt <= QUICK_NOD.maxRecoveryMs;

export function createHeadTracker(initialBounds: FaceBounds | null = null) {
  let episode: Episode | null = null;
  let nods: number[] = [];
  let downSamples: DownSample[] = [];
  let lastObservationAt: number | null = null;
  let filteredDown = 0;
  let anchorBounds: FaceBounds | null = initialBounds;
  let forwardSamples: DownSample[] = [];
  let filteredForwardLean = 0;
  let steadyLean: SteadyLean | null = null;
  let eyesOpenAt: number | null = null;

  return {
    update(observation: ComputerVisionObservation, baseline: Baseline): HeadState {
      const t = observation.timestampMs;
      const pitch = observation.headPose?.pitch;
      const valid = observation.faceDetected && typeof pitch === 'number';
      const frameGap = lastObservationAt !== null && t - lastObservationAt > MAX_FRAME_MS;
      lastObservationAt = t;

      // Апп/камерын бодит frame тасралтыг доош унжилтын хугацаанд оруулахгүй.
      if (frameGap) {
        episode = null;
        downSamples = [];
        forwardSamples = [];
        filteredDown = 0;
        filteredForwardLean = 0;
        eyesOpenAt = null;
      }

      if (!valid) {
        steadyLean = null;
        const held = episode !== null && !frameGap && t - episode.last <= TRACKING_LOSS_GRACE_MS;
        if (!held) {
          episode = null;
          downSamples = [];
          forwardSamples = [];
          filteredDown = 0;
          filteredForwardLean = 0;
        }
        nods = nods.filter((at) => t - at <= NOD_WINDOW_MS);
        return {
          downDeg: held ? filteredDown : 0,
          forwardLean: held ? filteredForwardLean : 0,
          droopMs: held && episode !== null ? t - episode.start : 0,
          quickNods: nods.length,
        };
      }

      const rawDown = (pitch as number) - baseline.headPitch;
      downSamples = [...downSamples, { t, value: rawDown }]
        .filter((sample) => t - sample.t <= POSE_FILTER_WINDOW_MS)
        .slice(-POSE_FILTER_MAX_SAMPLES);
      const sortedDown = downSamples.map((sample) => sample.value).sort((a, b) => a - b);
      filteredDown = sortedDown[Math.floor(sortedDown.length / 2)];
      const down = filteredDown;

      const bounds = observation.faceBounds ?? null;
      if (anchorBounds === null && bounds !== null) anchorBounds = bounds;
      if (anchorBounds !== null && bounds !== null) {
        const anchorHeight = Math.max(anchorBounds.height, 0.01);
        const verticalShift = (bounds.centerY - anchorBounds.centerY) / anchorHeight;
        const scaleIncrease = Math.max(0, bounds.height / anchorHeight - 1);
        const rawForwardLean = Math.max(0, verticalShift + scaleIncrease * FACE_SCALE_WEIGHT);
        forwardSamples = [...forwardSamples, { t, value: rawForwardLean }]
          .filter((sample) => t - sample.t <= POSE_FILTER_WINDOW_MS)
          .slice(-POSE_FILTER_MAX_SAMPLES);
        const sortedForwardLean = forwardSamples
          .map((sample) => sample.value)
          .sort((a, b) => a - b);
        filteredForwardLean = sortedForwardLean[Math.floor(sortedForwardLean.length / 2)];
      }
      let forwardLean = filteredForwardLean;

      // Тонгойсон ч сэрүүн, тогтвортой байвал шинэ байрлал гэж хүлээн авна.
      const blink =
        observation.leftBlink !== null && observation.rightBlink !== null
          ? (observation.leftBlink + observation.rightBlink) / 2
          : null;
      if (blink !== null && blink < baseline.blinkClosed) eyesOpenAt = t;
      const awake = eyesOpenAt !== null && t - eyesOpenAt <= LEAN_REANCHOR.blinkGraceMs;
      if (bounds !== null && forwardLean >= FORWARD_LEAN_END_RATIO && awake && Math.abs(down) < NOD_END_DEG) {
        steadyLean = extendSteadyLean(steadyLean, t, bounds);
        if (t - steadyLean.since >= LEAN_REANCHOR.stableMs) {
          anchorBounds = bounds;
          steadyLean = null;
          forwardSamples = [];
          filteredForwardLean = 0;
          forwardLean = 0;
        }
      } else {
        steadyLean = null;
      }

      const current: Episode | null = episode;
      if (current !== null && down < NOD_END_DEG && forwardLean < FORWARD_LEAN_END_RATIO) {
        nods = isQuickNod(current, t) ? [...nods, t] : nods;
        episode = null;
      }
      const postureStrength = Math.max(
        down,
        (forwardLean / FORWARD_LEAN_START_RATIO) * NOD_START_DEG,
      );
      if (episode === null && (down > NOD_START_DEG || forwardLean > FORWARD_LEAN_START_RATIO)) {
        episode = { start: t, peak: postureStrength, peakAt: t, last: t };
      }

      const active: Episode | null = episode;
      if (active !== null) {
        active.peakAt = postureStrength > active.peak ? t : active.peakAt;
        active.peak = Math.max(active.peak, postureStrength);
        active.last = t;
      }
      nods = nods.filter((at) => t - at <= NOD_WINDOW_MS);

      return {
        downDeg: down,
        forwardLean,
        droopMs: active === null ? 0 : t - active.start,
        quickNods: nods.length,
      };
    },
  };
}
