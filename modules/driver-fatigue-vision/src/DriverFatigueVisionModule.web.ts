import { NativeModule, registerWebModule } from 'expo';

import type { CameraPermissionStatus } from './DriverFatigueVision.types';

class DriverFatigueVisionModule extends NativeModule {
  getCameraPermissionStatus(): CameraPermissionStatus {
    return 'denied';
  }

  async requestCameraPermission(): Promise<CameraPermissionStatus> {
    return 'denied';
  }
}

export default registerWebModule(DriverFatigueVisionModule, 'DriverFatigueVision');
