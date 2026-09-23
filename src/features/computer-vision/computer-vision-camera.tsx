import * as React from 'react';
import { PermissionsAndroid, Platform } from 'react-native';

import DriverFatigueVision, {
  DriverFatigueVisionView,
  isDriverFatigueVisionAvailable,
  type CameraPermissionStatus,
  type DriverFatigueVisionViewProps,
  type NativeFrameResult,
  type VisionError,
  type VisionStatus,
} from '../../../modules/driver-fatigue-vision';

import { createFrameWatchdog } from './frame-watchdog';
import { toComputerVisionObservation } from './native-result-to-observation';
import type { ComputerVisionObservation } from './types';

/** Фрэйм зогссон эсэхийг шалгах давтамж. */
const WATCHDOG_INTERVAL_MS = 500;

export type ComputerVisionCameraProps = Omit<
  DriverFatigueVisionViewProps,
  'onFrameResult' | 'onError' | 'onStatusChange'
> & {
  onObservation: (observation: ComputerVisionObservation) => void;
  onError?: (error: VisionError) => void;
  onStatusChange?: (status: VisionStatus) => void;
};

export { isDriverFatigueVisionAvailable };

export async function getComputerVisionCameraPermissionStatus(): Promise<CameraPermissionStatus> {
  if (Platform.OS === 'web') {
    if (!navigator.mediaDevices?.getUserMedia) return 'denied';
    try {
      const permission = await navigator.permissions?.query({ name: 'camera' as PermissionName });
      return permission?.state === 'granted' ? 'granted' : permission?.state === 'denied' ? 'denied' : 'undetermined';
    } catch {
      return 'undetermined';
    }
  }

  if (!isDriverFatigueVisionAvailable) {
    return 'denied';
  }

  if (Platform.OS === 'android') {
    return (await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CAMERA))
      ? 'granted'
      : 'undetermined';
  }

  if (Platform.OS === 'ios') {
    return DriverFatigueVision?.getCameraPermissionStatus() ?? 'denied';
  }

  return 'denied';
}

export async function requestComputerVisionCameraPermission(): Promise<CameraPermissionStatus> {
  if (Platform.OS === 'web') {
    if (!navigator.mediaDevices?.getUserMedia) return 'denied';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach((track) => track.stop());
      return 'granted';
    } catch {
      return 'denied';
    }
  }

  if (!isDriverFatigueVisionAvailable) {
    return 'denied';
  }

  if (Platform.OS === 'android') {
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
    return result === PermissionsAndroid.RESULTS.GRANTED ? 'granted' : 'denied';
  }

  if (Platform.OS === 'ios') {
    return DriverFatigueVision?.requestCameraPermission() ?? 'denied';
  }

  return 'denied';
}

export function ComputerVisionCamera({
  onObservation,
  onError,
  onStatusChange,
  ...viewProps
}: ComputerVisionCameraProps) {
  const [watchdog] = React.useState(() => createFrameWatchdog());

  React.useEffect(() => {
    const timer = setInterval(() => {
      const stalled = watchdog.check(Date.now());
      if (stalled) onStatusChange?.(stalled);
    }, WATCHDOG_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [onStatusChange, watchdog]);

  const handleFrameResult = React.useCallback(
    ({ nativeEvent }: { nativeEvent: NativeFrameResult }) => {
      const resumed = watchdog.frame(Date.now());
      if (resumed) onStatusChange?.(resumed);
      onObservation(toComputerVisionObservation(nativeEvent));
    },
    [onObservation, onStatusChange, watchdog],
  );

  const handleError = React.useCallback(
    ({ nativeEvent }: { nativeEvent: VisionError }) => onError?.(nativeEvent),
    [onError],
  );

  const handleStatusChange = React.useCallback(
    ({ nativeEvent }: { nativeEvent: { status: VisionStatus } }) => {
      watchdog.status(nativeEvent.status, Date.now());
      onStatusChange?.(nativeEvent.status);
    },
    [onStatusChange, watchdog],
  );

  return (
    <DriverFatigueVisionView
      {...viewProps}
      onError={handleError}
      onFrameResult={handleFrameResult}
      onStatusChange={handleStatusChange}
    />
  );
}
