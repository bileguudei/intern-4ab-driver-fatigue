import { NativeModule, requireOptionalNativeModule } from 'expo';

import type { CameraPermissionStatus } from './DriverFatigueVision.types';

export declare class DriverFatigueVisionModule extends NativeModule {
  getCameraPermissionStatus(): CameraPermissionStatus;
  requestCameraPermission(): Promise<CameraPermissionStatus>;
}

/**
 * Expo Go does not include this app-specific native module. Keep the module
 * optional so the JavaScript bundle can still load there; a development build
 * or production build provides the real implementation.
 */
const nativeModule = requireOptionalNativeModule<DriverFatigueVisionModule>('DriverFatigueVision');

export const isDriverFatigueVisionAvailable = nativeModule !== null;

export default nativeModule;
