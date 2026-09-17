import { requireNativeView } from 'expo';
import * as React from 'react';

import type { DriverFatigueVisionViewProps } from './DriverFatigueVision.types';

const NativeView: React.ComponentType<DriverFatigueVisionViewProps> = requireNativeView('DriverFatigueVision');

export default function DriverFatigueVisionView(props: DriverFatigueVisionViewProps) {
  return <NativeView {...props} />;
}
