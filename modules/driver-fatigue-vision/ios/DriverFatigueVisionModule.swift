import ExpoModulesCore
import AVFoundation

public class DriverFatigueVisionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DriverFatigueVision")

    Function("getCameraPermissionStatus") {
      Self.cameraPermissionStatus()
    }

    AsyncFunction("requestCameraPermission") { (promise: Promise) in
      let status = AVCaptureDevice.authorizationStatus(for: .video)
      guard status == .notDetermined else {
        promise.resolve(Self.cameraPermissionStatus())
        return
      }

      AVCaptureDevice.requestAccess(for: .video) { granted in
        promise.resolve(granted ? "granted" : "denied")
      }
    }

    View(DriverFatigueVisionView.self) {
      Events("onFrameResult", "onError", "onStatusChange")

      Prop("active") { (view, active: Bool) in
        view.setActive(active)
      }

      Prop("targetFps") { (view, targetFps: Int) in
        view.setTargetFps(targetFps)
      }
    }
  }

  private static func cameraPermissionStatus() -> String {
    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .authorized:
      return "granted"
    case .denied:
      return "denied"
    case .restricted:
      return "restricted"
    case .notDetermined:
      return "undetermined"
    @unknown default:
      return "undetermined"
    }
  }
}
