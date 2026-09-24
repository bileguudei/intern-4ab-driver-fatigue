import { describe, expect, it } from 'bun:test';

import { assessReadiness } from '../readiness';

describe('assessReadiness', () => {
  it('камер, мэдэгдэл зөвшөөрөгдсөн бол бэлэн', () => {
    expect(assessReadiness('granted', 'granted')).toMatchObject({ level: 'ready', title: 'Систем бэлэн', openSettings: false });
    // Мэдэгдлийг анхны жолоодлогод асуух тул асуугаагүй нь асуудал биш.
    expect(assessReadiness('granted', 'undetermined').level).toBe('ready');
  });

  it('камер хаалттай бол хяналт ажиллахгүй гэж тохиргоо руу явуулна', () => {
    expect(assessReadiness('denied', 'granted')).toMatchObject({ level: 'blocked', title: 'Камер хаалттай', openSettings: true });
    expect(assessReadiness('restricted', 'denied').level).toBe('blocked');
  });

  it('камерын зөвшөөрөл асуугаагүй бол жолоодлого эхлүүлэхэд асууна', () => {
    expect(assessReadiness('undetermined', 'denied')).toMatchObject({ level: 'attention', title: 'Камерын зөвшөөрөл хэрэгтэй', openSettings: false });
  });

  it('мэдэгдэл хаалттай бол анхааруулж, тохиргоо руу явуулна', () => {
    expect(assessReadiness('granted', 'denied')).toMatchObject({ level: 'attention', title: 'Мэдэгдэл хаалттай', openSettings: true });
  });
});
