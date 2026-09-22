import { describe, expect, it } from 'bun:test';

import type { ComputerVisionObservation } from '@/features/computer-vision';

import { createFatigueEngine } from '../engine';

function observation(faceDetected: boolean, timestampMs = 1_000): ComputerVisionObservation {
  return {
    timestampMs, faceDetected, faceConfidence: null,
    faceBounds: faceDetected ? { x: 0.32, y: 0.24, width: 0.36, height: 0.45, centerX: 0.5, centerY: 0.465 } : null,
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

  it('нүүр олдоогүй бол калибраци урагшлахгүй', () => {
    const { engine } = setup();
    engine.startCalibration();
    for (let t = 0; t <= 10_000; t += 50) engine.accept(observation(false, t));
    expect(engine.getState().calibration).toBe('running');
    expect(engine.getState().calibrationProgress).toBe(0);
  });

  it('калибрацийн үеийн ердийн анивчилт хэмжилтийг таслахгүй', () => {
    const { engine } = setup();
    engine.onCameraStatus('running');
    engine.startCalibration();
    for (let t = 0; t <= 4_000; t += 50) engine.accept(observation(true, t));
    expect(engine.getState().calibrationProgress).toBeCloseTo(0.4);
    engine.accept({ ...observation(true, 4_050), leftBlink: 0.8, rightBlink: 0.8, averageEar: 0.06 });
    expect(engine.getState().calibrationProgress).toBeCloseTo(0.405);
    for (let t = 4_100; t <= 10_000; t += 50) engine.accept(observation(true, t));
    expect(engine.getState().calibration).toBe('done');
  });

  it('нүдээ бүтэн хугацаанд анисан калибрацийг baseline болгохгүй', () => {
    const { engine } = setup();
    engine.onCameraStatus('running');
    engine.startCalibration();
    for (let t = 0; t <= 10_000; t += 50) {
      engine.accept({
        ...observation(true, t),
        leftBlink: 0.8,
        rightBlink: 0.8,
        leftEar: 0.06,
        rightEar: 0.06,
        averageEar: 0.06,
      });
    }

    expect(engine.getState().calibration).toBe('failed');
    expect(engine.getState().baseline).toBeNull();
  });

  it('камерын frame тасарвал калибрацийн хэмжилтийг шинээр эхлүүлнэ', () => {
    const { engine } = setup();
    engine.onCameraStatus('running');
    engine.startCalibration();
    for (let t = 0; t <= 4_000; t += 50) engine.accept(observation(true, t));
    engine.accept(observation(true, 5_000));
    expect(engine.getState().calibrationProgress).toBe(0);
  });

  it('калибрацийн дараа 2 сек аньсан бол critical болж, дүнд тоологдоно', () => {
    const { engine, tick } = setup();
    engine.onCameraStatus('running');
    engine.startCalibration();
    for (let t = 0; t <= 10_000; t += 50) engine.accept(observation(true, t));
    for (let t = 10_050; t <= 12_100; t += 50) engine.accept({ ...observation(true, t), leftBlink: 0.8, rightBlink: 0.8 });
    tick(12_000);
    expect(engine.getState().level).toBe('critical');
    // Оноо өсөхдөө эхлээд warning-оор дамжина
    expect(engine.finish()).toMatchObject({ durationSeconds: 12, criticalCount: 1, warningCount: 1 });
  });

  it('хяналтгүй хугацааг тооцож, шинэ аялалд өмнөх явдлыг цэвэрлэнэ', () => {
    const { engine, tick } = setup();
    engine.startCalibration();
    engine.onCameraStatus('running');
    engine.onCameraStatus('stopped');
    tick(30_000);
    engine.onCameraStatus('running');
    expect(engine.finish()).toMatchObject({ unmonitoredSeconds: 30 });

    engine.startCalibration();
    expect(engine.getEvents()).toHaveLength(0);
  });

  it('эвшээх үед нүд анилтыг critical гэж тоолохгүй', () => {
    const { engine } = setup();
    engine.onCameraStatus('running');
    engine.startCalibration();
    for (let t = 0; t <= 10_000; t += 50) engine.accept(observation(true, t));
    // Ам ангайж, нүд аньсан 3 секунд — эвшээлт
    for (let t = 10_050; t <= 13_000; t += 50) {
      engine.accept({ ...observation(true, t), leftBlink: 0.8, rightBlink: 0.8, jawOpen: 0.8 });
    }
    expect(engine.getState().level).not.toBe('critical');
  });

  it('калибрацийн дараа жижиг толгойн drift-ийг аажим дагуулна', () => {
    const { engine } = setup();
    engine.onCameraStatus('running');
    engine.startCalibration();
    for (let t = 0; t <= 10_000; t += 50) engine.accept(observation(true, t));

    for (let t = 10_050; t <= 35_000; t += 50) {
      engine.accept({ ...observation(true, t), headPose: { pitch: 7, yaw: 0, roll: 0 } });
    }

    expect(engine.getState().level).toBe('normal');
    expect(engine.getState().baseline?.headPitch).toBeGreaterThan(6);
  });

  it('удаан толгой унжсан төлвийг шинэ baseline болгож ядаргааг нуухгүй', () => {
    const { engine } = setup();
    engine.onCameraStatus('running');
    engine.startCalibration();
    for (let t = 0; t <= 10_000; t += 50) engine.accept(observation(true, t));

    for (let t = 10_050; t <= 20_000; t += 50) {
      engine.accept({ ...observation(true, t), headPose: { pitch: 33, yaw: 0, roll: 0 } });
    }

    expect(engine.getState().level).toBe('critical');
    expect(engine.getState().baseline?.headPitch).toBeLessThanOrEqual(8);
  });

  it('толгой унжихад pose түр алдагдсан ч critical илрүүлэлт тасрахгүй', () => {
    const { engine } = setup();
    engine.onCameraStatus('running');
    engine.startCalibration();
    for (let t = 0; t <= 10_000; t += 50) engine.accept(observation(true, t));

    for (let t = 10_050; t <= 12_100; t += 50) {
      const poseMissed = t === 10_800 || t === 11_400;
      engine.accept({
        ...observation(!poseMissed, t),
        headPose: poseMissed ? null : { pitch: 19, yaw: 0, roll: 0 },
      });
    }

    expect(engine.getState().level).toBe('critical');
  });

  it('pitch өөрчлөгдөхгүй ч чигээрээ урагш тонгойвол critical илрүүлнэ', () => {
    const { engine } = setup();
    engine.onCameraStatus('running');
    engine.startCalibration();
    for (let t = 0; t <= 10_000; t += 50) engine.accept(observation(true, t));

    for (let t = 10_050; t <= 12_100; t += 50) {
      engine.accept({
        ...observation(true, t),
        faceBounds: { x: 0.29, y: 0.28, width: 0.42, height: 0.52, centerX: 0.5, centerY: 0.54 },
      });
    }

    expect(engine.getState().level).toBe('critical');
  });

  it('нүүр зөвхөн томорсон ч төв нь доошлоогүй бол урагш унжилт гэж андуурахгүй', () => {
    const { engine } = setup();
    engine.onCameraStatus('running');
    engine.startCalibration();
    for (let t = 0; t <= 10_000; t += 50) engine.accept(observation(true, t));

    for (let t = 10_050; t <= 12_100; t += 50) {
      engine.accept({
        ...observation(true, t),
        faceBounds: { x: 0.25, y: 0.165, width: 0.5, height: 0.6, centerX: 0.5, centerY: 0.465 },
      });
    }

    expect(engine.getState().level).toBe('normal');
  });

  it('жолооч хүрээнээс гараад өөр байрлалд буцвал дахин төвлөрч, анилтыг танина', () => {
    const { engine } = setup();
    engine.onCameraStatus('running');
    engine.startCalibration();
    for (let t = 0; t <= 10_000; t += 50) engine.accept(observation(true, t));

    for (let t = 10_050; t <= 12_000; t += 50) engine.accept(observation(false, t));
    for (let t = 12_050; t <= 13_400; t += 50) {
      engine.accept({
        ...observation(true, t),
        faceBounds: { x: 0.44, y: 0.24, width: 0.36, height: 0.45, centerX: 0.62, centerY: 0.465 },
        headPose: { pitch: 30, yaw: 0, roll: 0 },
      });
    }

    expect(engine.getState().level).toBe('normal');
    expect(engine.getState().baseline?.headPitch).toBeCloseTo(30, 0);

    for (let t = 13_450; t <= 15_500; t += 50) {
      engine.accept({
        ...observation(true, t),
        faceBounds: { x: 0.44, y: 0.24, width: 0.36, height: 0.45, centerX: 0.62, centerY: 0.465 },
        leftEar: 0.06,
        rightEar: 0.06,
        averageEar: 0.06,
        leftBlink: 0.8,
        rightBlink: 0.8,
        headPose: { pitch: 30, yaw: 0, roll: 0 },
      });
    }

    expect(engine.getState().level).toBe('critical');
  });

  it('нүүр алга болоод хуучин байрандаа толгой унжсан буцвал baseline болгож сурахгүй', () => {
    const { engine } = setup();
    engine.onCameraStatus('running');
    engine.startCalibration();
    for (let t = 0; t <= 10_000; t += 50) engine.accept(observation(true, t));

    for (let t = 10_050; t <= 12_000; t += 50) engine.accept(observation(false, t));
    for (let t = 12_050; t <= 14_000; t += 50) {
      engine.accept({
        ...observation(true, t),
        headPose: { pitch: 30, yaw: 0, roll: 0 },
      });
    }

    expect(engine.getState().level).toBe('critical');
    expect(engine.getState().baseline?.headPitch).toBeLessThanOrEqual(8);
  });
});
