package expo.modules.driverfatiguevision

import android.Manifest
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class DriverFatigueVisionModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("DriverFatigueVision")

    Function("getCameraPermissionStatus") {
      cameraPermissionStatus()
    }

    AsyncFunction("requestCameraPermission") {
      cameraPermissionStatus()
    }

    View(DriverFatigueVisionView::class) {
      Events("onFrameResult", "onError", "onStatusChange")

      Prop("active") { view: DriverFatigueVisionView, active: Boolean ->
        view.setActive(active)
      }

      Prop("targetFps") { view: DriverFatigueVisionView, targetFps: Int ->
        view.setTargetFps(targetFps)
      }
    }
  }

  private fun cameraPermissionStatus(): String {
    val context = appContext.reactContext ?: return "undetermined"
    return if (
      ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
        PackageManager.PERMISSION_GRANTED
    ) {
      "granted"
    } else {
      "undetermined"
    }
  }
}
