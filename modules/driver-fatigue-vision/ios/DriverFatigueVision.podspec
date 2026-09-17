Pod::Spec.new do |s|
  s.name           = 'DriverFatigueVision'
  s.version        = '1.0.0'
  s.summary        = 'On-device driver face landmark measurements for Expo'
  s.description    = 'Camera and MediaPipe Face Landmarker adapter for driver fatigue measurements.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.dependency 'MediaPipeTasksVision', '0.10.35'
  s.resource_bundles = {
    'DriverFatigueVisionResources' => ['Resources/*.task']
  }

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
