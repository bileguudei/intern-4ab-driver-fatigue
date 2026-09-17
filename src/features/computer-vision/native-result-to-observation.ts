import type { NativeFrameResult } from '../../../modules/driver-fatigue-vision';

import { createComputerVisionObservation } from './create-observation';
import type { ComputerVisionObservation } from './types';

export function toComputerVisionObservation(result: NativeFrameResult): ComputerVisionObservation {
  return createComputerVisionObservation(result);
}
