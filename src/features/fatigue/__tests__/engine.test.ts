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

  it('critical үед нүүр алга болбол дохиог унтраахгүй', () => {
    const { engine } = setup();
    engine.onCameraStatus('running');
    engine.startCalibration();
    for (let t = 0; t <= 10_000; t += 50) engine.accept(observation(true, t));
    for (let t = 10_050; t <= 12_100; t += 50) engine.accept({ ...observation(true, t), leftBlink: 0.8, rightBlink: 0.8 });
    expect(engine.getState().level).toBe('critical');

    // Толгой бүрэн унжиж landmark алга болсон 5 секунд.
    const levels = new Set<string>();
    for (let t = 12_150; t <= 17_000; t += 50) {
      engine.accept(observation(false, t));
      levels.add(engine.getState().level);
    }
    expect([...levels]).toEqual(['critical']);
  });

  it('нүүр удаан харагдахгүй бол 2 сек-д warning, 3 сек-д critical болно', () => {
    const { engine } = setup();
    engine.onCameraStatus('running');
    engine.startCalibration();
    for (let t = 0; t <= 10_000; t += 50) engine.accept(observation(true, t));

    for (let t = 10_050; t <= 12_000; t += 50) engine.accept(observation(false, t));
    expect(engine.getState().level).toBe('normal');
    engine.accept(observation(false, 12_050));
    expect(engine.getState().level).toBe('warning');
    for (let t = 12_100; t <= 13_050; t += 50) engine.accept(observation(false, t));
    expect(engine.getState().level).toBe('critical');

    for (let t = 13_100; t <= 15_000; t += 50) engine.accept(observation(true, t));
    expect(engine.getState().level).toBe('normal');
  });

  it('камер зогссон хугацааг нүүр алга болсон гэж тооцохгүй', () => {
    const { engine } = setup();
    engine.onCameraStatus('running');
    engine.startCalibration();
    for (let t = 0; t <= 10_000; t += 50) engine.accept(observation(true, t));

    engine.accept(observation(false, 10_050));
    engine.onCameraStatus('stopped');
    engine.onCameraStatus('running');
    engine.accept(observation(false, 20_000));
    expect(engine.getState().level).toBe('normal');
  });

  it('тонгойсон ч сэрүүн, тогтвортой суувал шинэ байрлалд дасаж дохиог зогсооно', () => {
    const { engine } = setup();
    engine.onCameraStatus('running');
    engine.startCalibration();
    for (let t = 0; t <= 10_000; t += 50) engine.accept(observation(true, t));

    const leaned = { x: 0.29, y: 0.28, width: 0.42, height: 0.52, centerX: 0.5, centerY: 0.54 };
    for (let t = 10_050; t <= 12_100; t += 50) engine.accept({ ...observation(true, t), faceBounds: leaned });
    expect(engine.getState().level).toBe('critical');

    for (let t = 12_150; t <= 22_500; t += 50) engine.accept({ ...observation(true, t), faceBounds: leaned });
    expect(engine.getState().level).toBe('normal');
  });

  it('тонгойсон байрлалд толгой бөхийсөн хэвээр бол шинэ байрлал гэж үзэхгүй', () => {
    const { engine } = setup();
    engine.onCameraStatus('running');
    engine.startCalibration();
    for (let t = 0; t <= 10_000; t += 50) engine.accept(observation(true, t));

    const leaned = { x: 0.29, y: 0.28, width: 0.42, height: 0.52, centerX: 0.5, centerY: 0.54 };
    for (let t = 10_050; t <= 22_500; t += 50) {
      engine.accept({ ...observation(true, t), faceBounds: leaned, headPose: { pitch: 11, yaw: 0, roll: 0 } });
    }
    expect(engine.getState().level).toBe('critical');
  });

  it('critical-аас warning руу буурахыг шинэ анхааруулга гэж тоолохгүй', () => {
    const { engine } = setup();
    engine.onCameraStatus('running');
    engine.startCalibration();
    for (let t = 0; t <= 10_000; t += 50) engine.accept(observation(true, t));

    const closed = (t: number) => ({ ...observation(true, t), leftBlink: 0.8, rightBlink: 0.8 });
    let t = 10_050;
    // Олон богино анилтаас PERCLOS өндөр болж warning гарна.
    for (let cycle = 0; cycle < 15; cycle++) {
      for (const end = t + 800; t < end; t += 50) engine.accept(closed(t));
      for (const end = t + 1_200; t < end; t += 50) engine.accept(observation(true, t));
    }
    expect(engine.getState().level).toBe('warning');
    // Урт анилтаар critical болж, нүд нээгдэхэд warning руу буурна.
    for (const end = t + 1_700; t < end; t += 50) engine.accept(closed(t));
    expect(engine.getState().level).toBe('critical');
    for (const end = t + 600; t < end; t += 50) engine.accept(observation(true, t));
    expect(engine.getState().level).toBe('warning');

    expect(engine.getEvents().map((event) => event.type)).toEqual(['fatigue_warning', 'fatigue_critical']);
    expect(engine.finish()).toMatchObject({ warningCount: 1, criticalCount: 1 });
  });

  it('аяллын дүнд PERCLOS, урт анилт, толгой дохилтын тоог гаргана', () => {
    const { engine } = setup();
    engine.onCameraStatus('running');
    engine.startCalibration();
    for (let t = 0; t <= 10_000; t += 50) engine.accept(observation(true, t));

    let t = 10_050;
    for (const end = t + 2_000; t < end; t += 50) engine.accept(observation(true, t));
    // 2 секунд аньсан нэг урт анилт.
    for (const end = t + 2_000; t < end; t += 50) engine.accept({ ...observation(true, t), leftBlink: 0.8, rightBlink: 0.8 });
    for (const end = t + 2_000; t < end; t += 50) engine.accept(observation(true, t));
    // Унжаад гэнэт өндийх нэг дохилт: 750 мс-т +30°, 400 мс-т буцна.
    const nodStart = t;
    for (; t < nodStart + 750; t += 50) {
      engine.accept({ ...observation(true, t), headPose: { pitch: 3 + (30 * (t - nodStart)) / 750, yaw: 0, roll: 0 } });
    }
    const peakAt = t;
    for (; t < peakAt + 400; t += 50) {
      engine.accept({ ...observation(true, t), headPose: { pitch: 33 - (30 * (t - peakAt)) / 400, yaw: 0, roll: 0 } });
    }
    for (const end = t + 2_000; t < end; t += 50) engine.accept(observation(true, t));

    const summary = engine.finish();
    expect(summary.longClosureCount).toBe(1);
    expect(summary.quickNodCount).toBe(1);
    expect(summary.perclos).toBeGreaterThan(0);
  });

  describe('толь руу харах', () => {
    const calibrated = (yaw = 0) => {
      const { engine } = setup();
      engine.onCameraStatus('running');
      engine.startCalibration();
      for (let t = 0; t <= 10_000; t += 50) {
        engine.accept({ ...observation(true, t), headPose: { pitch: 3, yaw, roll: 0 } });
      }
      return engine;
    };
    /** 1.2 сек-ийн толь харалт: толгой 40° эргэж, бага зэрэг доошилж, eyeBlink өснө. */
    const glance = (t: number, start: number, side: 1 | -1) => {
      const s = Math.sin((Math.PI * (t - start)) / 1_200);
      return {
        ...observation(true, t),
        leftBlink: 0.1 + 0.6 * s,
        rightBlink: 0.1 + 0.6 * s,
        headPose: { pitch: 3 + 12 * s, yaw: side * 40 * s, roll: 0 },
      };
    };

    it('хоёр тийш толь руу харахад ядаргаа гэж илрүүлэхгүй', () => {
      const engine = calibrated();
      const levels = new Set<string>();
      let t = 10_050;
      for (const [start, side] of [[12_000, -1], [16_000, 1], [20_000, -1], [24_000, 1]] as const) {
        for (; t < start; t += 50) engine.accept(observation(true, t));
        for (; t < start + 1_200; t += 50) {
          engine.accept(glance(t, start, side));
          levels.add(engine.getState().level);
        }
      }
      for (; t < 30_000; t += 50) {
        engine.accept(observation(true, t));
        levels.add(engine.getState().level);
      }

      expect([...levels]).toEqual(['normal']);
      expect(engine.getEvents()).toHaveLength(0);
      expect(engine.finish()).toMatchObject({ quickNodCount: 0, longClosureCount: 0 });
    });

    it('хажуу тийш удаан эргэвэл нүүр алга болсонтой адил 2 сек-д warning, 3 сек-д critical болно', () => {
      const engine = calibrated();
      const turned = (t: number) => ({ ...observation(true, t), headPose: { pitch: 3, yaw: 40, roll: 0 } });
      for (let t = 10_050; t <= 12_000; t += 50) engine.accept(turned(t));
      expect(engine.getState().level).toBe('normal');
      engine.accept(turned(12_050));
      expect(engine.getState().level).toBe('warning');
      for (let t = 12_100; t <= 13_050; t += 50) engine.accept(turned(t));
      expect(engine.getState().level).toBe('critical');
    });

    it('утас хажуу талд байрласан ч калибрацийн чиглэлд нүд аньвал critical илрүүлнэ', () => {
      const engine = calibrated(15);
      for (let t = 10_050; t <= 12_100; t += 50) {
        engine.accept({ ...observation(true, t), leftBlink: 0.8, rightBlink: 0.8, headPose: { pitch: 3, yaw: 15, roll: 0 } });
      }
      expect(engine.getState()).toMatchObject({ level: 'critical', alertReason: 'fatigue' });
    });

    it('утас самбарын голд байхад зам руу харахыг анхаарал сарнилт гэж үзэхгүй', () => {
      // Калибрацийн үед жолооч утас (0°) руу, жолоодохдоо зам (30°) руу харна.
      const engine = calibrated();
      const levels = new Set<string>();
      for (let t = 10_050; t <= 70_000; t += 50) {
        engine.accept({ ...observation(true, t), headPose: { pitch: 3, yaw: 30, roll: 0 } });
        levels.add(engine.getState().level);
      }
      expect([...levels]).toEqual(['normal']);
      expect(engine.getEvents()).toHaveLength(0);
    });

    it('хажуу тийш удаан эргэсэн дохиог ядаргаа биш, анхаарал сарнилт гэж тэмдэглэнэ', () => {
      const engine = calibrated();
      const turned = (t: number) => ({ ...observation(true, t), headPose: { pitch: 3, yaw: 40, roll: 0 } });
      for (let t = 10_050; t <= 12_050; t += 50) engine.accept(turned(t));
      expect(engine.getState()).toMatchObject({ level: 'warning', alertReason: 'distraction' });
      for (let t = 12_100; t <= 13_050; t += 50) engine.accept(turned(t));
      expect(engine.getState()).toMatchObject({ level: 'critical', alertReason: 'distraction' });
      for (let t = 13_100; t <= 16_000; t += 50) engine.accept(observation(true, t));
      expect(engine.getState()).toMatchObject({ level: 'normal', alertReason: null });
    });

    it('нүүр эргээгүй алга болбол (толгой унжих) ядаргаа гэж үзнэ', () => {
      const engine = calibrated();
      for (let t = 10_050; t <= 13_050; t += 50) engine.accept(observation(false, t));
      expect(engine.getState()).toMatchObject({ level: 'critical', alertReason: 'fatigue' });
    });

    it('ядаргааны дохионы үеэр толгой эргэвэл ядаргаа гэж харуулсаар байна', () => {
      const engine = calibrated();
      for (let t = 10_050; t <= 12_100; t += 50) {
        engine.accept({ ...observation(true, t), leftBlink: 0.8, rightBlink: 0.8 });
      }
      expect(engine.getState()).toMatchObject({ level: 'critical', alertReason: 'fatigue' });
      for (let t = 12_150; t <= 16_000; t += 50) {
        engine.accept({ ...observation(true, t), headPose: { pitch: 3, yaw: 40, roll: 0 } });
      }
      expect(engine.getState()).toMatchObject({ level: 'critical', alertReason: 'fatigue' });
    });
  });

  describe('хурд', () => {
    const calibrated = () => {
      const context = setup();
      context.engine.onCameraStatus('running');
      context.engine.startCalibration();
      for (let t = 0; t <= 10_000; t += 50) context.engine.accept(observation(true, t));
      return context;
    };
    const headDown = (t: number) => ({ ...observation(true, t), headPose: { pitch: 33, yaw: 0, roll: 0 } });
    const eyesClosed = (t: number) => ({ ...observation(true, t), leftBlink: 0.8, rightBlink: 0.8 });

    it('зогсож байхад толгойн дохиог хасаж, хурд тодорхойгүй болоход сэргээнэ', () => {
      const { engine, tick } = calibrated();
      tick(1_000);
      engine.onSpeed(0);
      expect(engine.getState().stationary).toBe(true);
      // Зогсоод утас руу доош харсан 3 секунд.
      for (let t = 10_050; t <= 13_000; t += 50) engine.accept(headDown(t));
      expect(engine.getState().level).toBe('normal');

      // GPS тасарвал аюулгүйн үүднээс дохиог хэвээр ажиллуулна.
      tick(1_000);
      engine.onSpeed(null);
      expect(engine.getState().stationary).toBe(false);
      for (let t = 13_050; t <= 15_000; t += 50) engine.accept(headDown(t));
      expect(engine.getState().level).toBe('critical');
    });

    it('зогсож байхад удаан анилтад зөвхөн warning өгнө', () => {
      const { engine, tick } = calibrated();
      tick(1_000);
      engine.onSpeed(2);
      for (let t = 10_050; t <= 12_100; t += 50) engine.accept(eyesClosed(t));
      expect(engine.getState().level).toBe('warning');
    });

    it('зогссон эсэхийг гистерезисээр шийднэ', () => {
      const { engine, tick } = calibrated();
      const speeds: [number, boolean][] = [[3, true], [7, true], [12, false], [7, false], [4, true]];
      for (const [kmh, stationary] of speeds) {
        tick(1_000);
        engine.onSpeed(kmh);
        expect(engine.getState().stationary).toBe(stationary);
      }
    });

    it('өндөр хурдад 1.1 сек аньсанд critical өгнө', () => {
      const levelAfterClosure = (kmh: number) => {
        const { engine, tick } = calibrated();
        tick(1_000);
        engine.onSpeed(kmh);
        for (let t = 10_050; t <= 11_150; t += 50) engine.accept(eyesClosed(t));
        return engine.getState().level;
      };
      expect(levelAfterClosure(50)).not.toBe('critical');
      expect(levelAfterClosure(100)).toBe('critical');
    });

    describe('завсарлага', () => {
      const MINUTE = 60_000;
      const driving = () => {
        const context = calibrated();
        const drive = (ms: number, kmh: number | null) => {
          for (let elapsed = 0; elapsed < ms; elapsed += 1_000) {
            context.tick(1_000);
            context.engine.onSpeed(kmh);
          }
        };
        return { ...context, drive };
      };

      it('2 цаг тасралтгүй явсны дараа сануулж, 30 минут тутам давтаж, 15 минут зогсоход цуцална', () => {
        const { engine, drive } = driving();
        drive(120 * MINUTE - 5_000, 60);
        expect(engine.getState()).toMatchObject({ breakDue: false, breakReminders: 0 });
        drive(10_000, 60);
        expect(engine.getState()).toMatchObject({ breakDue: true, breakReminders: 1 });
        drive(30 * MINUTE, 60);
        expect(engine.getState().breakReminders).toBe(2);
        drive(15 * MINUTE + 2_000, 0);
        expect(engine.getState().breakDue).toBe(false);
        // Амарсны дараа дахин 2 цаг хүртэл сануулахгүй.
        drive(119 * MINUTE, 60);
        expect(engine.getState()).toMatchObject({ breakDue: false, breakReminders: 2 });
      });

      it('богино зогсолт амралтад тооцогдохгүй', () => {
        const { engine, drive } = driving();
        drive(60 * MINUTE, 60);
        drive(10 * MINUTE, 0);
        drive(55 * MINUTE, 60);
        expect(engine.getState()).toMatchObject({ breakDue: true, breakReminders: 1 });
      });

      it('зогссоны дараа апп ард гарч GPS тасарсан ч амралтыг тоолно', () => {
        const { engine, tick, drive } = driving();
        drive(125 * MINUTE, 60);
        drive(2_000, 0);
        expect(engine.getState().breakDue).toBe(true);
        tick(20 * MINUTE);
        engine.onSpeed(null);
        expect(engine.getState()).toMatchObject({ breakDue: false, stationary: false });
      });

      it('явж байхад GPS тасрахыг амралт гэж үзэхгүй', () => {
        const { engine, drive } = driving();
        drive(110 * MINUTE, 60);
        drive(20 * MINUTE, null);
        expect(engine.getState().breakDue).toBe(true);
      });

      it('GPS байхгүй ч хяналтын хугацаагаар сануулна', () => {
        const { engine, tick } = calibrated();
        tick(120 * MINUTE);
        engine.accept(observation(true, 10_050));
        expect(engine.getState()).toMatchObject({ breakDue: true, breakReminders: 1 });
      });

      it('апп удаан ард байсны дараа алгассан сануулгуудыг нэг удаа л гаргана', () => {
        const { engine, tick, drive } = driving();
        drive(60 * MINUTE, 60);
        tick(180 * MINUTE);
        drive(5_000, 60);
        expect(engine.getState().breakReminders).toBe(1);
      });
    });

    it('зай, хурд, нүд аньсан үеийн зай болон явдлын хурдыг гаргана', () => {
      const { engine, tick } = calibrated();
      // 36 км/ц = 10 м/с-ээр 60 секунд.
      for (let i = 0; i <= 60; i++) {
        tick(1_000);
        engine.onSpeed(36);
      }
      for (let t = 10_050; t <= 11_650; t += 50) engine.accept(eyesClosed(t));

      const critical = engine.getEvents().find((event) => event.type === 'fatigue_critical');
      expect(critical?.speedKmh).toBe(36);
      const summary = engine.finish();
      expect(summary).toMatchObject({ distanceKm: 0.6, avgSpeedKmh: 36, maxSpeedKmh: 36 });
      expect(summary.maxBlindDistanceM).toBeGreaterThanOrEqual(15);
      expect(summary.maxBlindDistanceM).toBeLessThanOrEqual(16);
    });

    it('хурд хэмжээгүй аялалд хурд, зайг null, 0 гэж гаргана', () => {
      const { engine } = calibrated();
      expect(engine.finish()).toMatchObject({ distanceKm: 0, avgSpeedKmh: null, maxSpeedKmh: null, maxBlindDistanceM: 0 });
    });
  });
});
