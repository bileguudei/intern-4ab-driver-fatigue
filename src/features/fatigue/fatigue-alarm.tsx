import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
import { Vibration } from 'react-native';

import { createAlarmController } from './alarm';
import { createBackgroundAlert } from './background-alert';
import type { FatigueEngine } from './engine';

const CRITICAL_VIBRATION = [0, 500, 300];
/** iOS давтах мэдэгдэлд доод тал нь 60 сек шаарддаг. */
const REMINDER_SECONDS = 120;
const STOPPED_NOTICE = { title: '⚠ Ядаргааны хяналт зогслоо', body: 'Апп руу буцаж орвол хяналт үргэлжилнэ', sound: true };

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
    let reminderId: string | null = null;
    // Анхны жолоодлого эхлэхэд мэдэгдлийн зөвшөөрөл асууна; татгалзвал зөвхөн дуу үлдэнэ.
    Notifications.requestPermissionsAsync();
    const onBackground = createBackgroundAlert({
      alertNow: () => {
        warning.seekTo(0);
        warning.play();
        Notifications.scheduleNotificationAsync({ content: STOPPED_NOTICE, trigger: null });
      },
      scheduleReminders: async () => {
        const trigger = { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: REMINDER_SECONDS, repeats: true } as const;
        reminderId = await Notifications.scheduleNotificationAsync({ content: STOPPED_NOTICE, trigger });
      },
      cancelReminders: () => {
        if (reminderId !== null) Notifications.cancelScheduledNotificationAsync(reminderId);
        reminderId = null;
      },
    });
    const unsubscribe = engine.subscribe((state) => {
      onState(state);
      onBackground(state);
    });

    return () => {
      unsubscribe();
      if (reminderId !== null) Notifications.cancelScheduledNotificationAsync(reminderId);
      criticalOn = false;
      keepPlaying.remove();
      Vibration.cancel();
      warning.remove();
      critical.remove();
    };
  }, [engine]);

  return null;
}
