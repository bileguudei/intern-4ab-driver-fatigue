# Computer Vision boundary

This module owns measurement extraction only:

1. A platform-specific adapter runs MediaPipe Face Landmarker on a camera frame.
2. `createComputerVisionObservation` converts the native result to a stable contract.
3. Calibration and fatigue logic consume `ComputerVisionObservation`.

The module must not contain fatigue thresholds, calibration state, warning logic,
session persistence, or UI state. Keeping those decisions outside the camera hot
path makes the module independently testable and prevents cyclic ownership between
the Computer Vision, Fatigue Logic, and Mobile UI workstreams.

## Integration contract

```ts
import type { ComputerVisionObservation } from '@/features/computer-vision';

function onObservation(observation: ComputerVisionObservation) {
  // Pass measurements to calibration/fatigue logic.
}
```

`averageEar` is null unless both eyes have valid landmarks. `leftBlink`, `rightBlink`
and `jawOpen` are MediaPipe blendshape scores (0–1) and are null when no face is detected;
field measurements showed eyeBlink to be 3–11× steadier than EAR while the eyes are open. `headPose` is null when
MediaPipe does not return a valid facial transformation matrix. Missing values must
never be interpreted as zero by consumers. `faceConfidence` is currently null
because MediaPipe Face Landmarker does not expose a per-result detection score.

## Verified sign conventions

Checked on an iPhone 13 Pro with `ComputerVisionDebugScreen`:

- `headPose.pitch` is positive when the driver looks **down**.
- `leftEar` / `leftBlink` belong to the driver's **own left** eye (the mirroring is already handled).
- `jawOpen` rises above 0.5 with the mouth wide open.

`timestampMs` is a monotonic device clock (iOS `systemUptime`, Android `uptimeMillis`), not Unix
time. Use it only for durations; stamp persisted events with `Date.now()`.

## Native adapter requirements

- Use the front camera and MediaPipe Face Landmarker in live-stream mode.
- Configure one face and enable the facial transformation matrix.
- Normalize orientation and mirror signs before publishing head pose.
- Prefer the latest frame; never build an inference queue.
- Target 10–15 processed frames per second without blocking the UI thread.
- Do not persist or upload raw frames, video, or face images.

## React Native usage

This requires an Expo development build because MediaPipe and CameraX are
native dependencies; it does not run in Expo Go.

```tsx
const permission = await requestComputerVisionCameraPermission();

<ComputerVisionCamera
  active={permission === 'granted'}
  targetFps={12}
  onObservation={(observation) => fatigueEngine.accept(observation)}
  style={{ flex: 1 }}
/>
```

Create and install a development build on a connected phone:

```bash
bunx expo run:android --device
bunx expo run:ios --device
```

## Device harness

`ComputerVisionDebugScreen` renders the live measurements over the camera preview
so the native adapter can be checked on a phone. It is a measurement readout only
and deliberately contains no fatigue scoring.

Reaching it needs a route, and every file under `src/app/` becomes a screen in the
shared tab navigator: a route with no matching `NativeTabs.Trigger` still renders
as an unlabelled tab. To keep this workstream out of the Mobile UI navigator, the
route file is local-only and git-ignored:

```tsx
// src/app/cv-debug.tsx — not committed
import { ComputerVisionDebugScreen } from '@/features/computer-vision';

export default ComputerVisionDebugScreen;
```

When the Mobile UI workstream is ready to own the route, it can register the screen
itself and add a matching trigger (or pass `hidden` to keep it off the tab bar).

For the first physical-device smoke test, verify that:

1. Permission changes to `granted` before `active` becomes true.
2. `onStatusChange` reaches `running` and the front-camera preview is mirrored.
3. A visible face produces `landmarkCount === 478`, non-null EAR values, and a
   non-null head pose.
4. Covering the camera produces `faceDetected === false`; dim light lowers
   `brightness` without stopping the stream.
5. Backgrounding the app stops capture. Returning to the foreground restarts
   it only while `active` remains true.

The native adapters default to 15 FPS and clamp `targetFps` to 1–15. Android
uses CameraX `KEEP_ONLY_LATEST`; iOS uses
`alwaysDiscardsLateVideoFrames`, so neither platform builds an inference queue.
