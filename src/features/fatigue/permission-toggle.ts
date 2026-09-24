/** Тохиргооны зөвшөөрлийн switch-ийн бодит төлөв. */
export type PermissionState = Readonly<{ granted: boolean; canAsk: boolean }>;

export type PermissionToggleAction = 'none' | 'request' | 'open-settings';

/**
 * iOS, Android дээр апп олгогдсон зөвшөөрлөө өөрөө цуцалж чадахгүй, татгалзсан
 * зөвшөөрлийг дахин асууж болохгүй. Тиймээс switch-ийг асаахад асууж болох бол
 * асууна, бусад үед утасны тохиргоог нээж хэрэглэгч тэндээс өөрчилнө.
 */
export function permissionToggleAction(permission: PermissionState, turnOn: boolean): PermissionToggleAction {
  if (turnOn === permission.granted) return 'none';
  return turnOn && permission.canAsk ? 'request' : 'open-settings';
}

/** Switch-ийн доорх тайлбар — дарахад юу болохыг урьдчилан хэлнэ. */
export function permissionToggleHint(permission: PermissionState): string {
  if (permission.granted) return 'Асаалттай · унтраахад утасны тохиргоо нээгдэнэ';
  if (permission.canAsk) return 'Унтраалттай · асаахад зөвшөөрөл асууна';
  return 'Хаалттай · асаахад утасны тохиргоо нээгдэнэ';
}
