import { type AudioPlayer, createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import Constants from 'expo-constants';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { getLocalSessions } from '@/data/local-db';
import { syncPendingData } from '@/data/sync';
import {
  getComputerVisionCameraPermissionStatus,
  requestComputerVisionCameraPermission,
} from '@/features/computer-vision';
import { clampVolume, MAX_VOLUME, MIN_VOLUME, VOLUME_STEP } from '@/features/fatigue/alert-settings';
import {
  type PermissionState as Permission,
  permissionToggleAction,
  permissionToggleHint,
} from '@/features/fatigue/permission-toggle';
import { alertSettings, useAlertSettings } from '@/features/fatigue/use-alert-settings';
import { Card, Header, SectionTitle } from '../components/ui';
import { colors } from '../theme';

type SyncInfo = Readonly<{ total: number; pending: number }>;

const readCameraPermission = async (): Promise<Permission> => {
  const status = await getComputerVisionCameraPermissionStatus();
  return { granted: status === 'granted', canAsk: status === 'undetermined' };
};

const readNotificationPermission = async (): Promise<Permission> => {
  const permission = await Notifications.getPermissionsAsync();
  return { granted: permission.granted, canAsk: permission.canAskAgain };
};

const readLocationPermission = async (): Promise<Permission> => {
  const permission = await Location.getForegroundPermissionsAsync();
  return { granted: permission.granted, canAsk: permission.canAskAgain };
};

const readSyncInfo = async (): Promise<SyncInfo> => {
  const completed = (await getLocalSessions()).filter((session) => session.status === 'completed');
  return { total: completed.length, pending: completed.filter((session) => !session.synced_at).length };
};

export function SettingsScreen() {
  const settings = useAlertSettings();
  const [camera, setCamera] = useState<Permission | null>(null);
  const [notifications, setNotifications] = useState<Permission | null>(null);
  const [location, setLocation] = useState<Permission | null>(null);
  const [syncInfo, setSyncInfo] = useState<SyncInfo | null>(null);
  const [syncState, setSyncState] = useState<'idle' | 'syncing' | 'failed'>('idle');
  const preview = useRef<AudioPlayer | null>(null);

  const refresh = useCallback(() => {
    void readCameraPermission().then(setCamera).catch((error) => console.warn('Unable to read camera permission:', error));
    void readNotificationPermission().then(setNotifications).catch((error) => console.warn('Unable to read notification permission:', error));
    void readLocationPermission().then(setLocation).catch((error) => console.warn('Unable to read location permission:', error));
    void readSyncInfo().then(setSyncInfo).catch((error) => console.warn('Unable to read trips:', error));
  }, []);

  useEffect(() => {
    refresh();
    // Утасны тохиргооноос зөвшөөрөл өгөөд буцаж ирэхэд дахин шалгана.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  useEffect(() => {
    const player = createAudioPlayer(require('@assets/sounds/fatigue-warning.wav'));
    preview.current = player;
    return () => {
      preview.current = null;
      player.pause();
      player.remove();
    };
  }, []);

  /** Дууны хэмжээг өөрчлөхөд анхааруулгын дууг тэр хэмжээгээр сонсгоно. */
  const changeVolume = (delta: number) => {
    const volume = clampVolume(settings.volume + delta);
    alertSettings.update({ volume });
    const player = preview.current;
    if (!settings.sound || player === null) return;
    void setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'duckOthers' });
    player.volume = volume / 100;
    player.seekTo(0);
    player.play();
  };

  const syncNow = async () => {
    setSyncState('syncing');
    try {
      await syncPendingData();
      setSyncState('idle');
    } catch (error) {
      console.warn('Manual sync failed:', error);
      setSyncState('failed');
    }
    setSyncInfo(await readSyncInfo().catch(() => syncInfo));
  };

  const canSync = syncInfo !== null && syncInfo.pending > 0 && syncState !== 'syncing';
  const syncSubtitle =
    syncState === 'syncing'
      ? 'Илгээж байна…'
      : syncState === 'failed'
        ? 'Илгээж чадсангүй. Сүлжээ сэргэхэд автоматаар илгээнэ.'
        : syncInfo === null
          ? 'Шалгаж байна…'
          : syncInfo.pending > 0
            ? `${syncInfo.pending} аялал илгээгдээгүй`
            : `${syncInfo.total} аялал · бүгд илгээгдсэн`;

  return (
    <View style={styles.screen}>
      <Header title="Тохиргоо" />
      <ScrollView contentContainerStyle={styles.content}>
        <SectionTitle>Дохио & сэрэмжлүүлэг</SectionTitle>
        <Toggle icon="◖" title="Дуут сэрэмжлүүлэг" subtitle="Анхааруулгын үед дуу гаргана. Аюултай үед үргэлж дуугарна." value={settings.sound} onChange={(sound) => alertSettings.update({ sound })} />
        <Toggle icon="≈" title="Чичиргээ" subtitle="Анхааруулгын үед утас чичирнэ. Аюултай үед үргэлж чичирнэ." value={settings.vibration} onChange={(vibration) => alertSettings.update({ vibration })} />
        <Card style={[styles.item, !settings.sound && styles.disabled]}>
          <View style={styles.row}>
            <Text style={styles.icon}>◕</Text>
            <View style={styles.copy}>
              <Text style={styles.itemTitle}>Дохионы дуу чимээ</Text>
              <Text style={styles.subtitle}>{settings.sound ? `${settings.volume}% · анхааруулгын дуу` : 'Дуут сэрэмжлүүлэг унтраалттай'}</Text>
            </View>
            <VolumeButton label="−" disabled={!settings.sound || settings.volume <= MIN_VOLUME} onPress={() => changeVolume(-VOLUME_STEP)} />
            <VolumeButton label="+" disabled={!settings.sound || settings.volume >= MAX_VOLUME} onPress={() => changeVolume(VOLUME_STEP)} />
          </View>
          <View style={styles.volumeTrack}><View style={[styles.volumeFill, { width: `${settings.volume}%` }]} /></View>
        </Card>

        <SectionTitle>Зөвшөөрөл</SectionTitle>
        <PermissionToggle icon="◉" title="Камер" subtitle="Нүд, толгойн хөдөлгөөнийг хянахад шаардлагатай" permission={camera} request={() => requestComputerVisionCameraPermission().then(refresh)} />
        <PermissionToggle icon="✉" title="Мэдэгдэл" subtitle="Апп ард гарахад хяналт зогссоныг сануулна" permission={notifications} request={() => Notifications.requestPermissionsAsync().then(refresh)} />
        <PermissionToggle icon="◎" title="Байршил" subtitle="Хурд, явсан зайг хэмжинэ" permission={location} request={() => Location.requestForegroundPermissionsAsync().then(refresh)} />

        <SectionTitle>Өгөгдөл</SectionTitle>
        <StatusRow
          icon="▣"
          title="Серверт илгээх"
          subtitle={syncSubtitle}
          status={canSync ? { label: 'Илгээх ›', color: colors.primary, onPress: syncNow } : { label: syncInfo?.pending === 0 && syncState === 'idle' ? '✓' : '', color: colors.normal, onPress: undefined }}
        />

        <SectionTitle>Апп тухай</SectionTitle>
        <Card style={styles.item}><View style={styles.row}><Text style={styles.icon}>ⓘ</Text><Text style={[styles.itemTitle, styles.copy]}>Хувилбар</Text><Text style={styles.value}>{Constants.expoConfig?.version ?? '—'}</Text></View></Card>
        <Card style={styles.item}><View style={styles.row}><Text style={styles.icon}>◇</Text><Text style={[styles.itemTitle, styles.copy]}>Нууцлалын бодлого</Text><Text style={styles.value}>›</Text></View></Card>
        <View style={styles.bottomSpace} />
      </ScrollView>
    </View>
  );
}

function Toggle({ icon, title, subtitle, value, onChange }: { icon: string; title: string; subtitle: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <Card style={styles.item}>
      <View style={styles.row}>
        <Text style={styles.icon}>{icon}</Text>
        <View style={styles.copy}><Text style={styles.itemTitle}>{title}</Text><Text style={styles.subtitle}>{subtitle}</Text></View>
        <Switch value={value} onValueChange={onChange} trackColor={{ false: colors.borderBright, true: colors.primaryDark }} thumbColor={value ? colors.primary : colors.textMuted} />
      </View>
    </Card>
  );
}

function VolumeButton({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.volumeButton, disabled && styles.disabled]}>
      <Text style={styles.volumeText}>{label}</Text>
    </Pressable>
  );
}

/**
 * Зөвшөөрлийн switch. Бодит зөвшөөрлийг харуулдаг тул дарахад шууд солигдохгүй:
 * асууж болох бол асууна, бусад үед утасны тохиргоо нээгдэж, буцаж ирэхэд шинэчлэгдэнэ.
 */
function PermissionToggle({ icon, title, subtitle, permission, request }: {
  icon: string;
  title: string;
  subtitle: string;
  permission: Permission | null;
  request: () => Promise<unknown>;
}) {
  const onChange = (turnOn: boolean) => {
    if (permission === null) return;
    const action = permissionToggleAction(permission, turnOn);
    if (action === 'request') void request();
    if (action === 'open-settings') void Linking.openSettings();
  };
  return (
    <Card style={styles.item}>
      <View style={styles.row}>
        <Text style={styles.icon}>{icon}</Text>
        <View style={styles.copy}>
          <Text style={styles.itemTitle}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
          <Text style={[styles.hint, { color: permission?.granted ? colors.normal : colors.warning }]}>
            {permission === null ? 'Шалгаж байна…' : permissionToggleHint(permission)}
          </Text>
        </View>
        <Switch value={permission?.granted ?? false} disabled={permission === null} onValueChange={onChange} trackColor={{ false: colors.borderBright, true: colors.primaryDark }} thumbColor={permission?.granted ? colors.primary : colors.textMuted} />
      </View>
    </Card>
  );
}

function StatusRow({ icon, title, subtitle, status }: {
  icon: string;
  title: string;
  subtitle: string;
  status: { label: string; color: string; onPress: (() => unknown) | undefined };
}) {
  const onPress = status.onPress;
  return (
    <Pressable accessibilityRole={onPress ? 'button' : undefined} disabled={!onPress} onPress={onPress ? () => void onPress() : undefined}>
      <Card style={styles.item}>
        <View style={styles.row}>
          <Text style={styles.icon}>{icon}</Text>
          <View style={styles.copy}><Text style={styles.itemTitle}>{title}</Text><Text style={styles.subtitle}>{subtitle}</Text></View>
          <Text style={[styles.status, { color: status.color }]}>{status.label}</Text>
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({ screen: { flex: 1 }, content: { paddingHorizontal: 20, paddingBottom: 100 }, item: { marginBottom: 10, paddingVertical: 13 }, row: { flexDirection: 'row', alignItems: 'center', gap: 12 }, icon: { width: 32, color: colors.primary, fontSize: 23, textAlign: 'center' }, copy: { flex: 1 }, itemTitle: { color: colors.text, fontSize: 15, fontWeight: '700' }, subtitle: { color: colors.textMuted, fontSize: 11, marginTop: 3 }, value: { color: colors.textMuted, fontSize: 14 }, status: { fontSize: 13, fontWeight: '700' }, hint: { fontSize: 11, fontWeight: '600', marginTop: 4 }, disabled: { opacity: 0.45 }, volumeButton: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }, volumeText: { color: colors.text, fontSize: 20 }, volumeTrack: { height: 4, backgroundColor: colors.borderBright, borderRadius: 2, marginTop: 14, overflow: 'hidden' }, volumeFill: { height: '100%', backgroundColor: colors.primary }, bottomSpace: { height: 20 } });
