package expo.modules.driverfatiguevision

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Matrix
import android.os.SystemClock
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.LifecycleOwner
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.framework.image.MPImage
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarker
import com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarkerResult
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import kotlin.math.max

private const val MODEL_ASSET_PATH = "face_landmarker.task"
private const val DEFAULT_TARGET_FPS = 15
private const val MIN_TARGET_FPS = 1
private const val MAX_TARGET_FPS = 15
private const val RESULT_CACHE_WINDOW_MS = 2_000L
private val PUBLISHED_BLENDSHAPES = setOf("eyeBlinkLeft", "eyeBlinkRight", "jawOpen")

class DriverFatigueVisionView(
  context: Context,
  private val moduleAppContext: AppContext,
) : ExpoView(context, moduleAppContext) {
  private val onFrameResult by EventDispatcher<Map<String, Any?>>()
  private val onError by EventDispatcher<Map<String, String>>()
  private val onStatusChange by EventDispatcher<Map<String, String>>()

  private val previewView = PreviewView(context).apply {
    implementationMode = PreviewView.ImplementationMode.PERFORMANCE
    scaleType = PreviewView.ScaleType.FILL_CENTER
  }
  private val brightnessByTimestamp = ConcurrentHashMap<Long, Double>()

  @Volatile
  private var active = false
  private var attached = false
  @Volatile
  private var targetFps = DEFAULT_TARGET_FPS
  private var lastSubmittedTimestampMs = 0L
  private var cameraProvider: ProcessCameraProvider? = null
  @Volatile
  private var faceLandmarker: FaceLandmarker? = null
  private var analysisExecutor: ExecutorService? = null
  private var observedLifecycle: Lifecycle? = null

  // Апп ард гарахад CameraX камерыг lifecycle-ээр өөрөө зогсоодог ч статус
  // илгээдэггүй. iOS-той адил JS-д мэдэгдэж, хяналт зогссоныг анхааруулна.
  private val lifecycleObserver = LifecycleEventObserver { _, event ->
    val cameraBound = cameraProvider != null
    if (cameraBound && event == Lifecycle.Event.ON_STOP) {
      emitStatus("stopped")
    } else if (cameraBound && active && event == Lifecycle.Event.ON_START) {
      emitStatus("running")
    }
  }

  init {
    addView(previewView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
  }

  fun setActive(value: Boolean) {
    if (active == value) return
    active = value
    if (active && attached) {
      startCamera()
    } else if (!active) {
      stopCamera()
    }
  }

  fun setTargetFps(value: Int) {
    targetFps = value.coerceIn(MIN_TARGET_FPS, MAX_TARGET_FPS)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    attached = true
    if (active) startCamera()
  }

  override fun onDetachedFromWindow() {
    attached = false
    stopCamera()
    super.onDetachedFromWindow()
  }

  private fun startCamera() {
    if (cameraProvider != null) return
    if (
      ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) !=
        PackageManager.PERMISSION_GRANTED
    ) {
      emitError("camera_permission_missing", "Camera permission must be granted before monitoring starts.")
      return
    }

    emitStatus("starting")
    try {
      ensureFaceLandmarker()
    } catch (error: Exception) {
      emitError("mediapipe_initialization_failed", error.message ?: "MediaPipe initialization failed.")
      emitStatus("stopped")
      return
    }

    val providerFuture = ProcessCameraProvider.getInstance(context)
    providerFuture.addListener(
      {
        if (!active || !attached) return@addListener
        try {
          val lifecycleOwner = moduleAppContext.currentActivity as? LifecycleOwner
          if (lifecycleOwner == null) {
            emitError("lifecycle_unavailable", "Unable to bind the camera to the current activity.")
            emitStatus("stopped")
            return@addListener
          }

          val provider = providerFuture.get()
          val executor = ensureAnalysisExecutor()
          val preview = Preview.Builder().build().also {
            it.surfaceProvider = previewView.surfaceProvider
          }
          val analysis = ImageAnalysis.Builder()
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
            .setResolutionSelector(
              ResolutionSelector.Builder()
                .setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY)
                .build(),
            )
            .build()
            .also { useCase -> useCase.setAnalyzer(executor, ::analyzeFrame) }

          provider.unbindAll()
          provider.bindToLifecycle(
            lifecycleOwner,
            CameraSelector.DEFAULT_FRONT_CAMERA,
            preview,
            analysis,
          )
          // cameraProvider онооход өмнө бүртгэнэ: addObserver-ийн нөхөж ирдэг
          // ON_START үйл явдал давхар "running" илгээхгүй.
          observeLifecycle(lifecycleOwner.lifecycle)
          cameraProvider = provider
          emitStatus("running")
        } catch (error: Exception) {
          emitError("camera_start_failed", error.message ?: "Unable to start the front camera.")
          emitStatus("stopped")
        }
      },
      ContextCompat.getMainExecutor(context),
    )
  }

  private fun observeLifecycle(lifecycle: Lifecycle) {
    if (observedLifecycle === lifecycle) return
    observedLifecycle?.removeObserver(lifecycleObserver)
    lifecycle.addObserver(lifecycleObserver)
    observedLifecycle = lifecycle
  }

  private fun stopCamera() {
    observedLifecycle?.removeObserver(lifecycleObserver)
    observedLifecycle = null
    cameraProvider?.unbindAll()
    cameraProvider = null
    lastSubmittedTimestampMs = 0L
    brightnessByTimestamp.clear()
    val landmarkerToClose = faceLandmarker
    faceLandmarker = null
    val executorToShutdown = analysisExecutor
    analysisExecutor = null
    if (executorToShutdown != null && !executorToShutdown.isShutdown) {
      executorToShutdown.execute {
        landmarkerToClose?.close()
        brightnessByTimestamp.clear()
      }
      executorToShutdown.shutdown()
    } else {
      landmarkerToClose?.close()
    }
    emitStatus("stopped")
  }

  private fun ensureAnalysisExecutor(): ExecutorService {
    val current = analysisExecutor
    if (current != null && !current.isShutdown) return current

    return Executors.newSingleThreadExecutor().also { analysisExecutor = it }
  }

  private fun ensureFaceLandmarker() {
    if (faceLandmarker != null) return

    val baseOptions = BaseOptions.builder()
      .setModelAssetPath(MODEL_ASSET_PATH)
      .build()
    val options = FaceLandmarker.FaceLandmarkerOptions.builder()
      .setBaseOptions(baseOptions)
      .setRunningMode(RunningMode.LIVE_STREAM)
      .setNumFaces(1)
      .setMinFaceDetectionConfidence(0.5f)
      .setMinFacePresenceConfidence(0.5f)
      .setMinTrackingConfidence(0.5f)
      .setOutputFaceBlendshapes(true)
      .setOutputFacialTransformationMatrixes(true)
      .setResultListener(::handleResult)
      .setErrorListener { error ->
        emitError("mediapipe_runtime_error", error.message ?: "MediaPipe inference failed.")
      }
      .build()

    faceLandmarker = FaceLandmarker.createFromOptions(context, options)
  }

  private fun analyzeFrame(imageProxy: ImageProxy) {
    val timestampMs = SystemClock.uptimeMillis()
    val minimumIntervalMs = 1_000L / targetFps
    if (!active || timestampMs - lastSubmittedTimestampMs < minimumIntervalMs) {
      imageProxy.close()
      return
    }
    lastSubmittedTimestampMs = timestampMs

    var imageClosed = false
    try {
      val sourceBitmap = imageProxy.toRgbaBitmap()
      val processedBitmap = sourceBitmap.rotateAndMirror(imageProxy.imageInfo.rotationDegrees)
      brightnessByTimestamp[timestampMs] = processedBitmap.calculateBrightness()
      discardStaleBrightness(timestampMs)

      imageProxy.close()
      imageClosed = true
      val mpImage = BitmapImageBuilder(processedBitmap).build()
      faceLandmarker?.detectAsync(mpImage, timestampMs)
    } catch (error: Exception) {
      emitError("frame_processing_failed", error.message ?: "Unable to process camera frame.")
    } finally {
      if (!imageClosed) imageProxy.close()
    }
  }

  private fun handleResult(result: FaceLandmarkerResult, @Suppress("UNUSED_PARAMETER") input: MPImage) {
    if (!active) {
      brightnessByTimestamp.remove(result.timestampMs())
      return
    }
    val landmarks = result.faceLandmarks().firstOrNull()?.map { landmark ->
      mapOf(
        "x" to landmark.x().toDouble(),
        "y" to landmark.y().toDouble(),
        "z" to landmark.z().toDouble(),
      )
    }
    val matrix = result.facialTransformationMatrixes().orElse(emptyList()).firstOrNull()
      ?.map(Float::toDouble)
    val blendshapes = result.faceBlendshapes().orElse(emptyList()).firstOrNull()
      ?.filter { category -> category.categoryName() in PUBLISHED_BLENDSHAPES }
      ?.associate { category -> category.categoryName() to category.score().toDouble() }
    val timestampMs = result.timestampMs()

    onFrameResult(
      mapOf(
        "timestampMs" to timestampMs.toDouble(),
        "faceConfidence" to null,
        "landmarks" to landmarks,
        "facialTransformationMatrix" to matrix,
        "blendshapes" to blendshapes,
        "brightness" to brightnessByTimestamp.remove(timestampMs),
        "inferenceTimeMs" to max(0L, SystemClock.uptimeMillis() - timestampMs).toDouble(),
      ),
    )
  }

  private fun discardStaleBrightness(nowMs: Long) {
    brightnessByTimestamp.keys.removeIf { timestamp -> nowMs - timestamp > RESULT_CACHE_WINDOW_MS }
  }

  private fun emitStatus(status: String) {
    onStatusChange(mapOf("status" to status))
  }

  private fun emitError(code: String, message: String) {
    onError(mapOf("code" to code, "message" to message))
  }
}

private fun ImageProxy.toRgbaBitmap(): Bitmap {
  val plane = planes[0]
  val buffer = plane.buffer.apply { rewind() }
  val paddedWidth = plane.rowStride / plane.pixelStride
  val paddedBitmap = Bitmap.createBitmap(paddedWidth, height, Bitmap.Config.ARGB_8888)
  paddedBitmap.copyPixelsFromBuffer(buffer)
  if (paddedWidth == width) return paddedBitmap

  return Bitmap.createBitmap(paddedBitmap, 0, 0, width, height).also {
    paddedBitmap.recycle()
  }
}

private fun Bitmap.rotateAndMirror(rotationDegrees: Int): Bitmap {
  val transform = Matrix().apply {
    postRotate(rotationDegrees.toFloat())
    postScale(-1f, 1f)
  }
  val transformed = Bitmap.createBitmap(this, 0, 0, width, height, transform, true)
  if (transformed !== this) recycle()
  return transformed
}

private fun Bitmap.calculateBrightness(): Double {
  val horizontalSamples = 16
  val verticalSamples = 12
  var luminanceSum = 0.0

  for (row in 0 until verticalSamples) {
    val y = row * (height - 1) / (verticalSamples - 1)
    for (column in 0 until horizontalSamples) {
      val x = column * (width - 1) / (horizontalSamples - 1)
      val pixel = getPixel(x, y)
      val red = android.graphics.Color.red(pixel)
      val green = android.graphics.Color.green(pixel)
      val blue = android.graphics.Color.blue(pixel)
      luminanceSum += 0.2126 * red + 0.7152 * green + 0.0722 * blue
    }
  }

  return luminanceSum / (horizontalSamples * verticalSamples * 255.0)
}
