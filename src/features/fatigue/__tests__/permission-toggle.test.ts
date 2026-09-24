import { describe, expect, it } from 'bun:test';

import { permissionToggleAction, permissionToggleHint } from '../permission-toggle';

const granted = { granted: true, canAsk: false };
const undetermined = { granted: false, canAsk: true };
const denied = { granted: false, canAsk: false };

describe('permissionToggleAction', () => {
  it('асуугаагүй зөвшөөрлийг асаахад шууд асууна', () => {
    expect(permissionToggleAction(undetermined, true)).toBe('request');
  });

  it('татгалзсан зөвшөөрлийг асаахад утасны тохиргоо нээнэ', () => {
    expect(permissionToggleAction(denied, true)).toBe('open-settings');
  });

  it('апп зөвшөөрлөө өөрөө цуцалж чадахгүй тул унтраахад тохиргоо нээнэ', () => {
    expect(permissionToggleAction(granted, false)).toBe('open-settings');
  });

  it('төлөв өөрчлөгдөхгүй бол юу ч хийхгүй', () => {
    expect(permissionToggleAction(granted, true)).toBe('none');
    expect(permissionToggleAction(denied, false)).toBe('none');
  });
});

describe('permissionToggleHint', () => {
  it('дарахад юу болохыг төлөв бүрт хэлнэ', () => {
    expect(permissionToggleHint(granted)).toContain('унтраахад утасны тохиргоо');
    expect(permissionToggleHint(undetermined)).toContain('асаахад зөвшөөрөл асууна');
    expect(permissionToggleHint(denied)).toContain('асаахад утасны тохиргоо');
  });
});
