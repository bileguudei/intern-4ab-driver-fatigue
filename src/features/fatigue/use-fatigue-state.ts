import { useSyncExternalStore } from 'react';

import type { FatigueEngine, FatigueEngineState } from './engine';

/** Engine-ийн төлөвийг React дэлгэцэд уншина. Төлөв өөрчлөгдөхөд л дахин зурна. */
export function useFatigueState(engine: FatigueEngine): FatigueEngineState {
  return useSyncExternalStore(engine.subscribe, engine.getState);
}
