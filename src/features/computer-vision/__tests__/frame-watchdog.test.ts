import { describe, expect, it } from 'bun:test';

import { createFrameWatchdog, FRAME_STALL_MS } from '../frame-watchdog';

describe('createFrameWatchdog', () => {
  it('running үед фрэйм зогсвол нэг удаа stopped, фрэйм ирэхэд running буцаана', () => {
    const watchdog = createFrameWatchdog();
    watchdog.status('running', 0);
    expect(watchdog.frame(100)).toBeNull();
    expect(watchdog.check(100 + FRAME_STALL_MS)).toBeNull();

    expect(watchdog.check(101 + FRAME_STALL_MS)).toBe('stopped');
    expect(watchdog.check(5_000)).toBeNull();

    expect(watchdog.frame(5_100)).toBe('running');
    expect(watchdog.frame(5_200)).toBeNull();
  });

  it('камер running биш үед фрэйм ирээгүйг зогссон гэж үзэхгүй', () => {
    const watchdog = createFrameWatchdog();
    watchdog.status('starting', 0);
    expect(watchdog.check(10_000)).toBeNull();
    watchdog.status('stopped', 10_000);
    expect(watchdog.check(20_000)).toBeNull();
  });

  it('running болсон даруй анхны фрэйм хүлээх хугацааг тоолж эхэлнэ', () => {
    const watchdog = createFrameWatchdog();
    watchdog.status('running', 1_000);
    expect(watchdog.check(1_000 + FRAME_STALL_MS)).toBeNull();
    expect(watchdog.check(1_001 + FRAME_STALL_MS)).toBe('stopped');
  });

  it('native статус шинээр ирэхэд зогссон төлвийг цэвэрлэнэ', () => {
    const watchdog = createFrameWatchdog();
    watchdog.status('running', 0);
    expect(watchdog.check(5_000)).toBe('stopped');
    watchdog.status('running', 6_000);
    expect(watchdog.frame(6_100)).toBeNull();
  });
});
