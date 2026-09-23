import * as Notifications from 'expo-notifications';

/** Жолоодлогын үед камер зогсоход гарах мэдэгдэл. */
export const STOPPED_NOTICE = { title: '⚠ Ядаргааны хяналт зогслоо', body: 'Апп руу буцаж орвол хяналт үргэлжилнэ', sound: true };
/**
 * Хяналт зогссоноос хойш сануулах хугацаа, секундээр. Апп руу буцаж ороогүй ч
 * 2 удаа сануулаад зогсоно. Өмнө нь үүрд давтагддаг байсан тул апп хаагдахад
 * сануулга 2 минут тутам дуусахгүй ирдэг байв.
 */
const REMINDER_DELAYS_SECONDS = [120, 240];
/** Сануулга бүрийн тогтмол id. Дахин товлоход хуучин нь солигдож, давхардахгүй. */
export const STOPPED_REMINDER_IDS = REMINDER_DELAYS_SECONDS.map((_, index) => `fatigue-monitoring-stopped-${index + 1}`);

/** Хяналт зогссоныг шууд мэдэгдэнэ. */
export function notifyMonitoringStopped() {
  return Notifications.scheduleNotificationAsync({ content: STOPPED_NOTICE, trigger: null });
}

/**
 * Сануулгыг товлох, цуцлах дуудлагуудыг дарааллаар нь гүйцэтгэнэ. Камер
 * хурдан сэргэхэд цуцлах дуудлага товлохоос түрүүлж, сануулга цуцлагдалгүй
 * үлдэж болох байсан.
 */
export function createStoppedReminders(onError: (error: unknown) => void = () => {}) {
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = (task: () => Promise<unknown>) => {
    queue = queue.then(task).catch(onError);
    return queue;
  };

  return {
    schedule: () =>
      enqueue(() =>
        Promise.all(
          REMINDER_DELAYS_SECONDS.map((seconds, index) =>
            Notifications.scheduleNotificationAsync({
              identifier: STOPPED_REMINDER_IDS[index],
              content: STOPPED_NOTICE,
              trigger: {
                type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
                seconds,
                repeats: false,
              },
            }),
          ),
        ),
      ),
    cancel: () =>
      enqueue(() => Promise.all(STOPPED_REMINDER_IDS.map((id) => Notifications.cancelScheduledNotificationAsync(id)))),
  };
}

/**
 * Апп эхлэхэд идэвхтэй жолоодлого байхгүй тул өмнө нь үлдсэн сануулгуудыг
 * цуцална. Хуучин хувилбарын санамсаргүй id-тай сануулгыг гарчгаар нь олно.
 */
export async function cancelLeftoverStoppedReminders() {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter(
        (request) =>
          STOPPED_REMINDER_IDS.includes(request.identifier) || request.content.title === STOPPED_NOTICE.title,
      )
      .map((request) => Notifications.cancelScheduledNotificationAsync(request.identifier)),
  );
}
