import AVFoundation
import ExpoModulesCore
import MediaPipeTasksVision
import UIKit

private let modelFileName = "face_landmarker"
private let modelFileExtension = "task"
private let defaultTargetFps = 15
private let minimumTargetFps = 1
private let maximumTargetFps = 15
private let brightnessCacheWindowMs = 2_000
private let publishedBlendshapes: Set<String> = ["eyeBlinkLeft", "eyeBlinkRight", "jawOpen"]

final class DriverFatigueVisionView: ExpoView,
  AVCaptureVideoDataOutputSampleBufferDelegate,
  FaceLandmarkerLiveStreamDelegate
{
  let onFrameResult = EventDispatcher()
  let onError = EventDispatcher()
  let onStatusChange = EventDispatcher()

  private let captureSession = AVCaptureSession()
  private let sessionQueue = DispatchQueue(label: "expo.driver-fatigue-vision.camera")
  private let outputQueue = DispatchQueue(label: "expo.driver-fatigue-vision.frames")
  private let previewLayer: AVCaptureVideoPreviewLayer
  private let cacheLock = NSLock()
  private let stateLock = NSLock()
  private let landmarkerLock = NSLock()

  private var active = false
  private var configured = false
  private var targetFps = defaultTargetFps
  private var lastSubmittedTimestampMs = 0
  private var faceLandmarker: FaceLandmarker?
  private var brightnessByTimestamp: [Int: Double] = [:]

  required init(appContext: AppContext? = nil) {
    previewLayer = AVCaptureVideoPreviewLayer(session: captureSession)
    super.init(appContext: appContext)

    clipsToBounds = true
    previewLayer.videoGravity = .resizeAspectFill
    layer.addSublayer(previewLayer)

    NotificationCenter.default.addObserver(
      self,
      selector: #selector(didEnterBackground),
      name: UIApplication.didEnterBackgroundNotification,
      object: nil
    )
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(willEnterForeground),
      name: UIApplication.willEnterForegroundNotification,
      object: nil
    )
  }

  deinit {
    NotificationCenter.default.removeObserver(self)
    captureSession.stopRunning()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    previewLayer.frame = bounds
  }

  func setActive(_ value: Bool) {
    stateLock.lock()
    let changed = active != value
    active = value
    stateLock.unlock()
    guard changed else { return }

    if value {
      startCamera()
    } else {
      stopCamera()
    }
  }

  func setTargetFps(_ value: Int) {
    stateLock.lock()
    targetFps = min(max(value, minimumTargetFps), maximumTargetFps)
    stateLock.unlock()
  }

  private func startCamera() {
    guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized else {
      emitError(
        code: "camera_permission_missing",
        message: "Camera permission must be granted before monitoring starts."
      )
      return
    }

    emitStatus("starting")
    sessionQueue.async { [weak self] in
      guard let self, self.isActive else { return }
      do {
        try self.ensureFaceLandmarker()
        if !self.configured {
          try self.configureCaptureSession()
        }
        guard self.isActive else { return }
        if !self.captureSession.isRunning {
          self.captureSession.startRunning()
        }
        self.emitStatus("running")
      } catch {
        self.emitError(code: "camera_start_failed", message: error.localizedDescription)
        self.emitStatus("stopped")
      }
    }
  }

  private func stopCamera() {
    sessionQueue.async { [weak self] in
      guard let self else { return }
      if self.captureSession.isRunning {
        self.captureSession.stopRunning()
      }
      self.landmarkerLock.lock()
      self.faceLandmarker = nil
      self.landmarkerLock.unlock()
      self.lastSubmittedTimestampMs = 0
      self.cacheLock.lock()
      self.brightnessByTimestamp.removeAll()
      self.cacheLock.unlock()
      self.emitStatus("stopped")
    }
  }

  private func configureCaptureSession() throws {
    guard let camera = AVCaptureDevice.default(
      .builtInWideAngleCamera,
      for: .video,
      position: .front
    ) else {
      throw VisionAdapterError.frontCameraUnavailable
    }

    let input = try AVCaptureDeviceInput(device: camera)
    let output = AVCaptureVideoDataOutput()
    output.alwaysDiscardsLateVideoFrames = true
    output.videoSettings = [
      kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
    ]
    output.setSampleBufferDelegate(self, queue: outputQueue)

    captureSession.beginConfiguration()
    defer { captureSession.commitConfiguration() }
    captureSession.sessionPreset = .vga640x480

    guard captureSession.canAddInput(input), captureSession.canAddOutput(output) else {
      throw VisionAdapterError.captureConfigurationFailed
    }
    captureSession.addInput(input)
    captureSession.addOutput(output)

    if let connection = output.connection(with: .video) {
      if connection.isVideoOrientationSupported {
        connection.videoOrientation = .portrait
      }
      if connection.isVideoMirroringSupported {
        connection.automaticallyAdjustsVideoMirroring = false
        connection.isVideoMirrored = true
      }
    }
    if let connection = previewLayer.connection, connection.isVideoMirroringSupported {
      connection.automaticallyAdjustsVideoMirroring = false
      connection.isVideoMirrored = true
    }
    configured = true
  }

  private func ensureFaceLandmarker() throws {
    landmarkerLock.lock()
    defer { landmarkerLock.unlock() }
    guard faceLandmarker == nil else { return }
    guard let modelPath = Self.modelPath() else {
      throw VisionAdapterError.modelUnavailable
    }

    let options = FaceLandmarkerOptions()
    options.baseOptions.modelAssetPath = modelPath
    options.runningMode = .liveStream
    options.numFaces = 1
    options.minFaceDetectionConfidence = 0.5
    options.minFacePresenceConfidence = 0.5
    options.minTrackingConfidence = 0.5
    options.outputFaceBlendshapes = true
    options.outputFacialTransformationMatrixes = true
    options.faceLandmarkerLiveStreamDelegate = self
    faceLandmarker = try FaceLandmarker(options: options)
  }

  private static func modelPath() -> String? {
    let containingBundle = Bundle(for: DriverFatigueVisionView.self)
    let resourceBundleUrl = containingBundle.url(
      forResource: "DriverFatigueVisionResources",
      withExtension: "bundle"
    ) ?? Bundle.main.url(
      forResource: "DriverFatigueVisionResources",
      withExtension: "bundle"
    )
    guard let resourceBundleUrl, let resourceBundle = Bundle(url: resourceBundleUrl) else {
      return nil
    }
    return resourceBundle.path(forResource: modelFileName, ofType: modelFileExtension)
  }

  func captureOutput(
    _ output: AVCaptureOutput,
    didOutput sampleBuffer: CMSampleBuffer,
    from connection: AVCaptureConnection
  ) {
    let timestampMs = Int(ProcessInfo.processInfo.systemUptime * 1_000)
    let minimumIntervalMs = 1_000 / currentTargetFps
    guard isActive, timestampMs - lastSubmittedTimestampMs >= minimumIntervalMs else { return }
    lastSubmittedTimestampMs = timestampMs

    guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
    let brightness = pixelBuffer.normalizedBrightness()
    cacheLock.lock()
    brightnessByTimestamp[timestampMs] = brightness
    brightnessByTimestamp = brightnessByTimestamp.filter {
      timestampMs - $0.key <= brightnessCacheWindowMs
    }
    cacheLock.unlock()

    do {
      let image = try MPImage(sampleBuffer: sampleBuffer, orientation: .up)
      landmarkerLock.lock()
      let currentLandmarker = faceLandmarker
      landmarkerLock.unlock()
      try currentLandmarker?.detectAsync(
        image: image,
        timestampInMilliseconds: timestampMs
      )
    } catch {
      emitError(code: "frame_processing_failed", message: error.localizedDescription)
    }
  }

  func faceLandmarker(
    _ faceLandmarker: FaceLandmarker,
    didFinishDetection result: FaceLandmarkerResult?,
    timestampInMilliseconds: Int,
    error: Error?
  ) {
    guard isActive else {
      cacheLock.lock()
      brightnessByTimestamp.removeValue(forKey: timestampInMilliseconds)
      cacheLock.unlock()
      return
    }

    if let error {
      emitError(code: "mediapipe_runtime_error", message: error.localizedDescription)
      return
    }

    cacheLock.lock()
    let brightness = brightnessByTimestamp.removeValue(forKey: timestampInMilliseconds)
    cacheLock.unlock()

    let landmarks: Any
    if let faceLandmarks = result?.faceLandmarks.first {
      landmarks = faceLandmarks.map { landmark in
        [
          "x": Double(landmark.x),
          "y": Double(landmark.y),
          "z": Double(landmark.z),
        ]
      }
    } else {
      landmarks = NSNull()
    }
    let transformationMatrix: Any
    if let matrix = result?.facialTransformationMatrixes.first {
      transformationMatrix = Self.flattenColumnMajor(matrix)
    } else {
      transformationMatrix = NSNull()
    }
    let inferenceTimeMs = max(
      0,
      Int(ProcessInfo.processInfo.systemUptime * 1_000) - timestampInMilliseconds
    )

    onFrameResult([
      "timestampMs": timestampInMilliseconds,
      "faceConfidence": NSNull(),
      "landmarks": landmarks,
      "facialTransformationMatrix": transformationMatrix,
      "blendshapes": Self.selectedBlendshapes(result?.faceBlendshapes.first),
      "brightness": brightness.map { $0 as Any } ?? NSNull(),
      "inferenceTimeMs": inferenceTimeMs,
    ])
  }

  private static func selectedBlendshapes(_ classifications: Classifications?) -> Any {
    guard let classifications else { return NSNull() }
    var scores: [String: Double] = [:]
    for category in classifications.categories {
      guard let name = category.categoryName, publishedBlendshapes.contains(name) else { continue }
      scores[name] = Double(category.score)
    }
    return scores
  }

  private static func flattenColumnMajor(_ matrix: TransformMatrix) -> [Double] {
    var values: [Double] = []
    values.reserveCapacity(Int(matrix.rows * matrix.columns))
    for column in 0..<matrix.columns {
      for row in 0..<matrix.rows {
        values.append(Double(matrix.value(atRow: row, column: column)))
      }
    }
    return values
  }

  @objc private func didEnterBackground() {
    sessionQueue.async { [weak self] in
      guard let self, self.captureSession.isRunning else { return }
      self.captureSession.stopRunning()
      self.emitStatus("stopped")
    }
  }

  @objc private func willEnterForeground() {
    if isActive {
      startCamera()
    }
  }

  private var isActive: Bool {
    stateLock.lock()
    defer { stateLock.unlock() }
    return active
  }

  private var currentTargetFps: Int {
    stateLock.lock()
    defer { stateLock.unlock() }
    return targetFps
  }

  private func emitStatus(_ status: String) {
    onStatusChange(["status": status])
  }

  private func emitError(code: String, message: String) {
    onError(["code": code, "message": message])
  }
}

private enum VisionAdapterError: LocalizedError {
  case frontCameraUnavailable
  case captureConfigurationFailed
  case modelUnavailable

  var errorDescription: String? {
    switch self {
    case .frontCameraUnavailable:
      return "No front camera is available on this device."
    case .captureConfigurationFailed:
      return "The front camera input or frame output could not be configured."
    case .modelUnavailable:
      return "The bundled MediaPipe face landmarker model could not be found."
    }
  }
}

private extension CVPixelBuffer {
  func normalizedBrightness() -> Double {
    CVPixelBufferLockBaseAddress(self, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(self, .readOnly) }

    guard let baseAddress = CVPixelBufferGetBaseAddress(self) else { return 0 }
    let width = CVPixelBufferGetWidth(self)
    let height = CVPixelBufferGetHeight(self)
    let bytesPerRow = CVPixelBufferGetBytesPerRow(self)
    let pixels = baseAddress.assumingMemoryBound(to: UInt8.self)
    let horizontalSamples = 16
    let verticalSamples = 12
    var luminanceSum = 0.0

    for row in 0..<verticalSamples {
      let y = row * (height - 1) / (verticalSamples - 1)
      for column in 0..<horizontalSamples {
        let x = column * (width - 1) / (horizontalSamples - 1)
        let offset = y * bytesPerRow + x * 4
        let blue = Double(pixels[offset])
        let green = Double(pixels[offset + 1])
        let red = Double(pixels[offset + 2])
        luminanceSum += 0.2126 * red + 0.7152 * green + 0.0722 * blue
      }
    }

    return luminanceSum / Double(horizontalSamples * verticalSamples) / 255.0
  }
}
