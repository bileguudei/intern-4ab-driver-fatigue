import type { FatigueEngineState } from './engine';

export type BackgroundAlertOutputs = {
  /** Камер зогсмогц — дуу ба мэдэгдэл. */
  alertNow: () => void;
  /** Буцаж ортол давтан сануулна. */
  scheduleReminders: () => void;
  cancelReminders: () => void;
};

/**
 * Жолоодлогын үед апп ард гарах, дэлгэц түгжигдэхэд iOS камерыг зогсооно.
 * Жолооч хамгаалалтгүй болсноо мэдэхгүй байх нь аюултай тул анхааруулна.
 */
export function createBackgroundAlert(outputs: BackgroundAlertOutputs) {
  let alerted = false;

  return (state: FatigueEngineState) => {
    const stopped = state.cameraStatus === 'stopped';
    if (stopped === alerted) return;
    if (stopped) outputs.alertNow();
    if (stopped) outputs.scheduleReminders();
    if (!stopped) outputs.cancelReminders();
    alerted = stopped;
  };
}
