import { describe, expect, it } from 'bun:test';

import type { ComputerVisionObservation } from '@/features/computer-vision';

import { createFatigueEngine } from '../engine';

function observation(faceDetected: boolean, timestampMs = 1_000): ComputerVisionObservation {
  return {
    timestampMs, faceDetected, faceConfidence: null,
    leftEar: 0.3, rightEar: 0.3, averageEar: 0.3,
    leftBlink: 0.1, rightBlink: 0.1, jawOpen: 0,
    headPose: { pitch: 3, yaw: 0, roll: 0 }, brightness: 0.5, inferenceTimeMs: 10, landmarkCount: 478,
  };
}

function setup() {
  let clock = 1_700_000_000_000;
  let id = 0;
  const engine = createFatigueEngine({ now: () => clock, createId: () => `e${++id}` });
  return { engine, tick: (ms: number) => { clock += ms; } };
}

describe('createFatigueEngine', () => {
  it('камер ажиллаж нүүр олдсон үед л хяналттай гэж үзнэ', () => {
    const { engine } = setup();
    engine.accept(observation(true));
    expect(engine.getState().monitoring).toBe(false);
    engine.onCameraStatus('running');
    engine.accept(observation(true));
    expect(engine.getState().monitoring).toBe(true);
    engine.accept(observation(false));
    expect(engine.getState().monitoring).toBe(false);
  });

  it('камер тасрахад Unix цагтай явдал бүртгэж хяналтыг зогсооно', () => {
    const { engine, tick } = setup();
    engine.onCameraStatus('running');
    engine.accept(observation(true, 50));
    tick(5_000);
    engine.onCameraStatus('stopped');
    expect(engine.getState().monitoring).toBe(false);
    expect(engine.getEvents()).toEqual([
      { id: 'e1', occurredAt: 1_700_000_005_000, type: 'camera_stopped' },
    ]);
  });

  it('тасарсны дараа сэргэхийг бүртгэнэ, анх асахыг бүртгэхгүй', () => {
    const { engine } = setup();
    engine.onCameraStatus('starting');
    engine.onCameraStatus('running');
    expect(engine.getEvents()).toHaveLength(0);
    engine.onCameraStatus('stopped');
    engine.onCameraStatus('running');
    expect(engine.getEvents().map((e) => e.type)).toEqual(['camera_stopped', 'camera_resumed']);
  });

  it('захиалагчид төлөв өөрчлөгдөх бүрд мэдэгдэж, цуцлах боломжтой', () => {
    const { engine } = setup();
    const seen: boolean[] = [];
    const unsubscribe = engine.subscribe((s) => seen.push(s.monitoring));
    engine.onCameraStatus('running');
    engine.accept(observation(true));
    unsubscribe();
    engine.accept(observation(false));
    expect(seen).toEqual([false, false, true]);
  });

  it('калибраци 10 сек ажиглалтын дараа суурь тогтооно', () => {
    const { engine } = setup();
    engine.onCameraStatus('running');
    engine.startCalibration();
    for (let t = 0; t <= 10_000; t += 50) engine.accept(observation(true, t));
    expect(engine.getState().calibration).toBe('done');
    expect(engine.getState().baseline?.blinkOpen).toBeCloseTo(0.1);
  });

  it('нүүр олдоогүй бол калибраци амжилтгүй болно', () => {
    const { engine } = setup();
    engine.startCalibration();
    for (let t = 0; t <= 10_000; t += 50) engine.accept(observation(false, t));
    expect(engine.getState().calibration).toBe('failed');
  });
});
