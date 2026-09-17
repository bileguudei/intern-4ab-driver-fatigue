import { requireNativeView } from 'expo';
import * as React from 'react';

import { isDriverFatigueVisionAvailable } from './DriverFatigueVisionModule';
import type { DriverFatigueVisionViewProps } from './DriverFatigueVision.types';

const NativeView: React.ComponentType<DriverFatigueVisionViewProps> | null = isDriverFatigueVisionAvailable
  ? requireNativeView('DriverFatigueVision')
  : null;

export default function DriverFatigueVisionView(props: DriverFatigueVisionViewProps) {
  return NativeView ? <NativeView {...props} /> : null;
}
