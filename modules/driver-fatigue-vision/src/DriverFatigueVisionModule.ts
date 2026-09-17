import { NativeModule, requireOptionalNativeModule } from 'expo';

import type { CameraPermissionStatus } from './DriverFatigueVision.types';

declare class DriverFatigueVisionModule extends NativeModule {
  getCameraPermissionStatus(): CameraPermissionStatus;
  requestCameraPermission(): Promise<CameraPermissionStatus>;
}

const nativeModule = requireOptionalNativeModule<DriverFatigueVisionModule>('DriverFatigueVision');

export const isDriverFatigueVisionAvailable = nativeModule !== null;

export default nativeModule;
