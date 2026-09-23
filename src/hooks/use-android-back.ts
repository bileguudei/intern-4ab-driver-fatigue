import { useEffect } from 'react';
import { BackHandler } from 'react-native';

/**
 * Android-ийн back товч болон gesture-ийг дэлгэцийн буцах үйлдэлтэй холбоно.
 * Навигацийг state-ээр удирддаг тул барихгүй бол back дарахад аппаас гарна.
 */
export function useAndroidBack(onBack: () => void) {
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => subscription.remove();
  }, [onBack]);
}
