import * as React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { CameraPermissionStatus, VisionError, VisionStatus } from '../../../modules/driver-fatigue-vision';

import {
  ComputerVisionCamera,
  getComputerVisionCameraPermissionStatus,
  requestComputerVisionCameraPermission,
} from './computer-vision-camera';
import type { ComputerVisionObservation } from './types';

const READOUT_INTERVAL_MS = 250;

function formatNumber(value: number | null, fractionDigits: number): string {
  return value === null ? '—' : value.toFixed(fractionDigits);
}

type Readout = {
  observation: ComputerVisionObservation | null;
  observedFps: number;
};

export function ComputerVisionDebugScreen() {
  const insets = useSafeAreaInsets();
  const [permission, setPermission] = React.useState<CameraPermissionStatus>('undetermined');
  const [status, setStatus] = React.useState<VisionStatus>('idle');
  const [error, setError] = React.useState<VisionError | null>(null);
  const [readout, setReadout] = React.useState<Readout>({ observation: null, observedFps: 0 });

  const latestObservation = React.useRef<ComputerVisionObservation | null>(null);
  const framesSinceLastReadout = React.useRef(0);

  React.useEffect(() => {
    let cancelled = false;

    getComputerVisionCameraPermissionStatus().then((current) => {
      if (!cancelled) {
        setPermission(current);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    const intervalId = setInterval(() => {
      const framesPerInterval = framesSinceLastReadout.current;
      framesSinceLastReadout.current = 0;

      setReadout({
        observation: latestObservation.current,
        observedFps: (framesPerInterval * 1000) / READOUT_INTERVAL_MS,
      });
    }, READOUT_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, []);

  const handleObservation = React.useCallback((observation: ComputerVisionObservation) => {
    latestObservation.current = observation;
    framesSinceLastReadout.current += 1;
  }, []);

  const handleRequestPermission = React.useCallback(async () => {
    setError(null);
    setPermission(await requestComputerVisionCameraPermission());
  }, []);

  const isActive = permission === 'granted';
  const { observation, observedFps } = readout;

  return (
    <View style={styles.container}>
      <ComputerVisionCamera
        active={isActive}
        style={styles.camera}
        targetFps={12}
        onObservation={handleObservation}
        onStatusChange={setStatus}
        onError={setError}
      />

      <View style={[styles.overlay, { top: insets.top }]} pointerEvents="box-none">
        <Text style={styles.heading}>Computer Vision debug</Text>

        <Row label="permission" value={permission} />
        <Row label="status" value={status} />
        <Row label="observed fps" value={observedFps.toFixed(1)} />
        <Row
          label="face"
          value={observation === null ? '—' : observation.faceDetected ? 'detected' : 'lost'}
        />
        <Row label="landmarks" value={observation === null ? '—' : String(observation.landmarkCount)} />
        <Row label="left EAR" value={formatNumber(observation?.leftEar ?? null, 3)} />
        <Row label="right EAR" value={formatNumber(observation?.rightEar ?? null, 3)} />
        <Row label="avg EAR" value={formatNumber(observation?.averageEar ?? null, 3)} />
        <Row label="pitch" value={formatNumber(observation?.headPose?.pitch ?? null, 1)} />
        <Row label="yaw" value={formatNumber(observation?.headPose?.yaw ?? null, 1)} />
        <Row label="roll" value={formatNumber(observation?.headPose?.roll ?? null, 1)} />
        <Row label="brightness" value={formatNumber(observation?.brightness ?? null, 2)} />
        <Row label="inference ms" value={formatNumber(observation?.inferenceTimeMs ?? null, 1)} />

        {error !== null && <Text style={styles.error}>{`${error.code}: ${error.message}`}</Text>}

        {!isActive && (
          <Pressable style={styles.button} onPress={handleRequestPermission}>
            <Text style={styles.buttonLabel}>Grant camera permission</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  camera: {
    flex: 1,
  },
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    margin: 16,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  heading: {
    marginBottom: 8,
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 1,
  },
  label: {
    color: '#B0B8C4',
    fontSize: 13,
  },
  value: {
    color: '#FFFFFF',
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
  error: {
    marginTop: 8,
    color: '#FF6B6B',
    fontSize: 13,
  },
  button: {
    marginTop: 12,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#208AEF',
    alignItems: 'center',
  },
  buttonLabel: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
});
