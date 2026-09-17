import type { StyleProp, ViewStyle } from 'react-native';

export type CameraPermissionStatus = 'granted' | 'denied' | 'undetermined' | 'restricted';

export type NativeNormalizedLandmark = Readonly<{
  x: number;
  y: number;
  z: number;
}>;

export type NativeFrameResult = Readonly<{
  timestampMs: number;
  faceConfidence: null;
  landmarks: readonly NativeNormalizedLandmark[] | null;
  facialTransformationMatrix: readonly number[] | null;
  brightness: number | null;
  inferenceTimeMs: number;
}>;

export type VisionStatus = 'idle' | 'starting' | 'running' | 'stopped';

export type VisionError = Readonly<{
  code: string;
  message: string;
}>;

export type DriverFatigueVisionViewProps = {
  active?: boolean;
  targetFps?: number;
  onFrameResult?: (event: { nativeEvent: NativeFrameResult }) => void;
  onError?: (event: { nativeEvent: VisionError }) => void;
  onStatusChange?: (event: { nativeEvent: { status: VisionStatus } }) => void;
  style?: StyleProp<ViewStyle>;
};
