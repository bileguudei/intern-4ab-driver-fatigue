import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
import { Vibration } from 'react-native';

import { createAlarmController } from './alarm';
import { createBackgroundAlert } from './background-alert';
import type { FatigueEngine } from './engine';
import { createStoppedReminders, notifyMonitoringStopped } from './stopped-reminders';

const CRITICAL_VIBRATION = [0, 500, 300];

/**
 * Жолоодлогын үед түвшин өсөхөд дуу, чичиргээ өгнө. Утас машинтай Bluetooth
 * аудиогоор холбогдсон бол iOS, Android дууг машины чанга яригч руу өөрөө
 * чиглүүлнэ; холбогдоогүй бол утасны чанга яригчаар дуугарна.
 */
export function FatigueAlarm({ engine }: { engine: FatigueEngine }) {
  useEffect(() => {
    // duckOthers — YouTube, хөгжмийг зогсоохгүй, дохионы үед намсгана.
    // playsInSilentMode — iPhone-ийн дуугүй товч асаалттай ч дуугарна.
    setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'duckOthers', shouldPlayInBackground: true });
    const warning = createAudioPlayer(require('@assets/sounds/fatigue-warning.wav'));
    const critical = createAudioPlayer(require('@assets/sounds/fatigue-critical.wav'));
    critical.loop = true;
    let criticalOn = false;

    // Bluetooth салахад тоглуулалт зогсдог — critical хэвээр бол утасны чанга яригчаар үргэлжлүүлнэ.
    const keepPlaying = critical.addListener('playbackStatusUpdate', (status) => {
      if (criticalOn && !status.playing) critical.play();
    });

    const onState = createAlarmController({
      playWarning: () => {
        warning.seekTo(0);
        warning.play();
        Vibration.vibrate(400);
      },
      startCritical: () => {
        criticalOn = true;
        critical.seekTo(0);
        critical.play();
        Vibration.vibrate(CRITICAL_VIBRATION, true);
      },
      stopCritical: () => {
        criticalOn = false;
        critical.pause();
        Vibration.cancel();
      },
    });
    const reminders = createStoppedReminders((error) => console.warn('Unable to update monitoring reminder:', error));
    // Анхны жолоодлого эхлэхэд мэдэгдлийн зөвшөөрөл асууна; татгалзвал зөвхөн дуу үлдэнэ.
    Notifications.requestPermissionsAsync();
    const onBackground = createBackgroundAlert({
      alertNow: () => {
        warning.seekTo(0);
        warning.play();
        void notifyMonitoringStopped();
      },
      scheduleReminders: () => {
        void reminders.schedule();
      },
      cancelReminders: () => {
        void reminders.cancel();
      },
    });
    const unsubscribe = engine.subscribe((state) => {
      onState(state);
      onBackground(state);
    });

    return () => {
      unsubscribe();
      void reminders.cancel();
      criticalOn = false;
      keepPlaying.remove();
      Vibration.cancel();
      // expo-audio-ийн remove() тоглуулагчийг зөвхөн registry-ээс хасдаг, дууг
      // зогсоодоггүй. Зогсоохгүй бол давтагддаг critical дохио жолоодлого
      // дууссаны дараа ч дуугарсаар байна.
      warning.pause();
      critical.pause();
      warning.remove();
      critical.remove();
    };
  }, [engine]);

  return null;
}
