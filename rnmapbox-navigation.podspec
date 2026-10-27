# Customization (set in your Podfile before `use_native_modules!`):
#  $RNMapboxNavigationVersion = '3.33.0' - Navigation SDK version, defaults to package.json `mapboxNavigation.ios`.
#     Nav 3.N pins Mapbox Maps 11.N exactly.
#  $RNMapboxNavigationSwiftPackageManager = "manual" - don't add the Swift package; you add
#     mapbox-navigation-ios (products MapboxNavigationCore and MapboxNavigationUIKit) yourself.
#
# This pod links the Navigation SDK and, through it, MapboxMaps. @rnmapbox/maps must only compile against that
# MapboxMaps, or the app links two copies:
#   $RNMapboxMapsSwiftPackageManager = { link: false }

require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))
rnMapboxNavigationUseSPM = $RNMapboxNavigationSwiftPackageManager != 'manual'

if rnMapboxNavigationUseSPM
  # The app's @rnmapbox/maps, whose rnmapbox-maps pod this pod depends on.
  rnmapbox_maps_dir = File.dirname(Pod::Executable.execute_command('node', ['-p',
    "require.resolve('@rnmapbox/maps/package.json', {paths: [process.argv[1]]})",
    Pod::Config.instance.installation_root.to_s]).strip)
  require File.join(rnmapbox_maps_dir, 'ios', 'rnmapbox_spm')
end

Pod::Spec.new do |s|
  s.name         = 'rnmapbox-navigation'
  s.version      = package['version']
  s.summary      = package['description']
  s.homepage     = package['homepage']
  s.license      = package['license']
  s.authors      = package['author']

  s.platforms    = { :ios => min_ios_version_supported }
  s.source       = { :git => 'https://github.com/rnmapbox/navigation.git', :tag => "v#{s.version}" }

  s.source_files = 'ios/*.{h,m,mm,swift}', 'cpp/*.{h,cpp}'
  s.private_header_files = 'ios/*.h', 'cpp/*.h'

  if rnMapboxNavigationUseSPM
    # The Navigation SDK v3 ships only as a Swift package.
    spm_dependency(s,
      url: 'https://github.com/mapbox/mapbox-navigation-ios.git',
      requirement: { kind: 'exactVersion', version: $RNMapboxNavigationVersion || package['mapboxNavigation']['ios'] },
      products: ['MapboxNavigationCore', 'MapboxNavigationUIKit']
    )
    RNMapboxSPM.embed_frameworks(s.name, ['MapboxCommon', 'MapboxCoreMaps', 'MapboxNavigationNative', 'Turf'])
    s.script_phase = RNMapboxSPM.signature_cleanup_script_phase(s.name)
  end

  # RNMBXNavigationMapFactory registers with @rnmapbox/maps' RNMBXMapViewFactory.
  s.dependency 'rnmapbox-maps'

  install_modules_dependencies(s)
end
