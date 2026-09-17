import { NativeModule, requireNativeModule } from 'expo';

import type { CameraPermissionStatus } from './DriverFatigueVision.types';

declare class DriverFatigueVisionModule extends NativeModule {
  getCameraPermissionStatus(): CameraPermissionStatus;
  requestCameraPermission(): Promise<CameraPermissionStatus>;
}

export default requireNativeModule<DriverFatigueVisionModule>('DriverFatigueVision');
