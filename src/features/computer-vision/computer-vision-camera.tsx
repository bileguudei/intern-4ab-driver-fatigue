import * as React from 'react';
import { PermissionsAndroid, Platform } from 'react-native';

import DriverFatigueVision, {
  DriverFatigueVisionView,
  type CameraPermissionStatus,
  type DriverFatigueVisionViewProps,
  type NativeFrameResult,
  type VisionError,
  type VisionStatus,
} from '../../../modules/driver-fatigue-vision';

import { toComputerVisionObservation } from './native-result-to-observation';
import type { ComputerVisionObservation } from './types';

export type ComputerVisionCameraProps = Omit<
  DriverFatigueVisionViewProps,
  'onFrameResult' | 'onError' | 'onStatusChange'
> & {
  onObservation: (observation: ComputerVisionObservation) => void;
  onError?: (error: VisionError) => void;
  onStatusChange?: (status: VisionStatus) => void;
};

export async function getComputerVisionCameraPermissionStatus(): Promise<CameraPermissionStatus> {
  if (Platform.OS === 'android') {
    return (await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CAMERA))
      ? 'granted'
      : 'undetermined';
  }

  if (Platform.OS === 'ios') {
    return DriverFatigueVision.getCameraPermissionStatus();
  }

  return 'denied';
}

export async function requestComputerVisionCameraPermission(): Promise<CameraPermissionStatus> {
  if (Platform.OS === 'android') {
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
    return result === PermissionsAndroid.RESULTS.GRANTED ? 'granted' : 'denied';
  }

  if (Platform.OS === 'ios') {
    return DriverFatigueVision.requestCameraPermission();
  }

  return 'denied';
}

export function ComputerVisionCamera({
  onObservation,
  onError,
  onStatusChange,
  ...viewProps
}: ComputerVisionCameraProps) {
  const handleFrameResult = React.useCallback(
    ({ nativeEvent }: { nativeEvent: NativeFrameResult }) => {
      onObservation(toComputerVisionObservation(nativeEvent));
    },
    [onObservation],
  );

  const handleError = React.useCallback(
    ({ nativeEvent }: { nativeEvent: VisionError }) => onError?.(nativeEvent),
    [onError],
  );

  const handleStatusChange = React.useCallback(
    ({ nativeEvent }: { nativeEvent: { status: VisionStatus } }) =>
      onStatusChange?.(nativeEvent.status),
    [onStatusChange],
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
