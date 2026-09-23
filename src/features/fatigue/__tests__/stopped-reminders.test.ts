import { beforeEach, describe, expect, it, mock } from 'bun:test';

type Request = { identifier?: string; trigger: { seconds: number; repeats: boolean } | null };

const calls: string[] = [];
const requests: Request[] = [];
let scheduled: { identifier: string; content: { title: string | null } }[] = [];
let failNextSchedule = false;

// Native дуудлага удаан дуусдагийг дуурайлгана.
mock.module('expo-notifications', () => ({
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval' },
  scheduleNotificationAsync: async (request: Request) => {
    if (failNextSchedule) {
      failNextSchedule = false;
      throw new Error('denied');
    }
    const id = request.identifier ?? 'immediate';
    requests.push(request);
    calls.push(`schedule-start:${id}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
    calls.push(`schedule-done:${id}`);
    return id;
  },
  cancelScheduledNotificationAsync: async (id: string) => {
    calls.push(`cancel:${id}`);
  },
  getAllScheduledNotificationsAsync: async () => scheduled,
}));

const { cancelLeftoverStoppedReminders, createStoppedReminders, STOPPED_NOTICE, STOPPED_REMINDER_IDS } =
  await import('../stopped-reminders');

const cancelled = () => calls.filter((call) => call.startsWith('cancel:')).sort();

beforeEach(() => {
  calls.length = 0;
  requests.length = 0;
  scheduled = [];
});

describe('stopped reminders', () => {
  it('2, 4 дэх минутад давтагдахгүй 2 сануулга товлоно', async () => {
    await createStoppedReminders().schedule();

    expect(requests.map((request) => [request.identifier, request.trigger?.seconds, request.trigger?.repeats])).toEqual([
      [STOPPED_REMINDER_IDS[0], 120, false],
      [STOPPED_REMINDER_IDS[1], 240, false],
    ]);
  });

  it('товлосны даруй цуцлахад цуцлалт товлолт дууссаны дараа хийгдэнэ', async () => {
    const reminders = createStoppedReminders();
    void reminders.schedule();
    await reminders.cancel();

    const lastScheduleDone = Math.max(...STOPPED_REMINDER_IDS.map((id) => calls.indexOf(`schedule-done:${id}`)));
    const firstCancel = Math.min(...STOPPED_REMINDER_IDS.map((id) => calls.indexOf(`cancel:${id}`)));
    expect(lastScheduleDone).toBeGreaterThanOrEqual(0);
    expect(firstCancel).toBeGreaterThan(lastScheduleDone);
  });

  it('нэг дуудлага алдаа өгсөн ч дараагийнх нь ажиллана', async () => {
    const errors: unknown[] = [];
    const reminders = createStoppedReminders((error) => errors.push(error));
    failNextSchedule = true;
    void reminders.schedule();
    await reminders.cancel();

    expect(errors).toHaveLength(1);
    expect(cancelled()).toEqual(STOPPED_REMINDER_IDS.map((id) => `cancel:${id}`).sort());
  });

  it('апп эхлэхэд үлдсэн сануулгуудыг, хуучин санамсаргүй id-тайг ч цуцална', async () => {
    scheduled = [
      { identifier: STOPPED_REMINDER_IDS[1], content: { title: STOPPED_NOTICE.title } },
      { identifier: 'legacy-random-id', content: { title: STOPPED_NOTICE.title } },
      { identifier: 'other', content: { title: 'Өөр мэдэгдэл' } },
    ];
    await cancelLeftoverStoppedReminders();

    expect(cancelled()).toEqual([`cancel:${STOPPED_REMINDER_IDS[1]}`, 'cancel:legacy-random-id'].sort());
  });
});
