const {
  AndroidConfig,
  createRunOncePlugin,
  WarningAggregator,
  withAndroidManifest,
  withAppDelegate,
  withEntitlementsPlist,
  withGradleProperties,
  withInfoPlist,
  withPodfile,
} = require('expo/config-plugins');

const pkg = require('../package.json');

const DEFAULT_LOCATION_USAGE =
  'Shows your location on the map and guides you to your destination.';

/**
 * @typedef {object} MapboxNavigationPluginProps
 * @property {string} [RNMapboxNavigationVersion] Navigation SDK version for both platforms, defaults to
 *   package.json `mapboxNavigation`. Nav 3.N needs Maps 11.N: set `RNMapboxMapsVersion` of the
 *   `@rnmapbox/maps` plugin to match.
 * @property {string | false} [locationWhenInUsePermission] iOS `NSLocationWhenInUseUsageDescription`,
 *   `false` to leave it unset.
 * @property {boolean} [androidAuto] Declares the Android Auto navigation app service, so Android Auto shows the
 *   navigation map that `<CarMap>` adds to.
 * @property {boolean} [carPlay] Adds the CarPlay scene and the `com.apple.developer.carplay-maps` entitlement, so
 *   CarPlay shows the navigation session.
 */

/**
 * Inserts a tagged block of `lines` before (`offset` 0) or after (`offset` 1) the first line matching
 * `anchor`, replacing the block of a previous run.
 * @param {string} src
 * @param {{ tag: string, lines: string[], anchor: RegExp, offset: 0 | 1, comment?: string, file?: string }} options
 */
function addGeneratedBlock(
  src,
  { tag, lines, anchor, offset, comment = '#', file = 'the Podfile' }
) {
  const begin = `${comment} @generated begin ${tag}`;
  const end = `${comment} @generated end ${tag}`;
  const srcLines = src.split('\n');
  const start = srcLines.findIndex((line) => line.trim() === begin);
  if (start !== -1) {
    const stop = srcLines.findIndex(
      (line, index) => index > start && line.trim() === end
    );
    srcLines.splice(start, stop - start + 1);
  }
  const index = srcLines.findIndex((line) => anchor.test(line));
  if (index === -1) {
    throw new Error(`${pkg.name}: no line matching ${anchor} in ${file}`);
  }
  srcLines.splice(index + offset, 0, begin, ...lines, end);
  return srcLines.join('\n');
}

/**
 * @param {string} podfile
 * @param {MapboxNavigationPluginProps} props
 */
function applyPodfileModifications(podfile, { RNMapboxNavigationVersion }) {
  let src = addGeneratedBlock(podfile, {
    tag: '@rnmapbox/navigation',
    lines: [
      // The Navigation SDK's Swift package links MapboxMaps; @rnmapbox/maps must only compile
      // against it, otherwise the app gets two MapboxMaps modules.
      '$RNMapboxMapsSwiftPackageManager = { link: false }',
      ...(RNMapboxNavigationVersion
        ? [`$RNMapboxNavigationVersion = '${RNMapboxNavigationVersion}'`]
        : []),
    ],
    anchor: /^target .+ do/,
    offset: 0,
  });
  src = addGeneratedBlock(src, {
    tag: '@rnmapbox/navigation-post_install',
    lines: [
      // With explicit Swift modules (Xcode 26 and React Native 0.88+), rnmapbox-maps only finds the binary
      // frameworks of the Navigation SDK package (MapboxCommon, MapboxCoreMaps, Turf) on a framework search path.
      "    installer.pods_project.targets.select { |t| t.name == 'rnmapbox-maps' }.each do |target|",
      '      target.build_configurations.each do |config|',
      "        paths = Array(config.build_settings['FRAMEWORK_SEARCH_PATHS'] || '$(inherited)')",
      "        config.build_settings['FRAMEWORK_SEARCH_PATHS'] = paths | ['${SYMROOT}/${CONFIGURATION}${EFFECTIVE_PLATFORM_NAME}/']",
      '      end',
      '    end',
    ],
    anchor: /^\s*post_install do \|installer\|/,
    offset: 1,
  });
  return src;
}

const CARPLAY_SCENE_ROLE = 'CPTemplateApplicationSceneSessionRoleApplication';

/**
 * Adds the CarPlay scene to `UIApplicationSceneManifest`, replacing one of a previous run.
 * @param {Record<string, any>} infoPlist
 */
function applyCarPlayInfoPlist(infoPlist) {
  const configurations =
    infoPlist.UIApplicationSceneManifest?.UISceneConfigurations;
  // Without the phone scene, declaring any scene would leave the app delegate's window unshown.
  if (!configurations?.UIWindowSceneSessionRoleApplication) {
    throw new Error(
      `${pkg.name}: carPlay needs the scene-based life cycle (UIWindowSceneSessionRoleApplication in UIApplicationSceneManifest), which Expo SDK 58 sets up`
    );
  }
  configurations[CARPLAY_SCENE_ROLE] = [
    {
      UISceneClassName: 'CPTemplateApplicationScene',
      UISceneConfigurationName: 'CarPlay',
      UISceneDelegateClassName: 'RNMBXNavigationCarPlaySceneDelegate',
    },
  ];
  return infoPlist;
}

/**
 * Hands the React Native factory the Swift app delegate creates to the CarPlay scene, which starts React Native for
 * `Navigation.registerCarPlayRoot` on it, replacing the lines of a previous run.
 * @param {string} appDelegate
 */
function applyCarPlayAppDelegate(appDelegate) {
  let src = addGeneratedBlock(appDelegate, {
    tag: '@rnmapbox/navigation-import',
    lines: ['import rnmapbox_navigation'],
    anchor: /^import React$/,
    offset: 1,
    comment: '//',
    file: 'AppDelegate.swift',
  });
  return addGeneratedBlock(src, {
    tag: '@rnmapbox/navigation-carplay-root',
    lines: ['    RNMBXNavigationCarPlayRoot.reactNativeFactory = factory'],
    anchor: /^\s*reactNativeFactory = factory$/,
    offset: 1,
    comment: '//',
    file: 'AppDelegate.swift',
  });
}

const CAR_APP_SERVICE = 'com.rnmapbox.rnmbxnav.RNMBXNavigationCarAppService';

/**
 * Adds the Android Auto service, its permissions and metadata, replacing those of a previous run.
 * @param {import('expo/config-plugins').AndroidConfig.Manifest.AndroidManifest} manifest
 */
function applyAndroidAutoManifest(manifest) {
  const root = manifest.manifest;
  const permissions = [
    'androidx.car.app.NAVIGATION_TEMPLATES',
    'androidx.car.app.ACCESS_SURFACE',
  ];
  root['uses-permission'] = [
    ...(root['uses-permission'] ?? []).filter(
      (permission) => !permissions.includes(permission.$['android:name'])
    ),
    ...permissions.map((name) => ({ $: { 'android:name': name } })),
  ];
  const application =
    AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
  const metaData = {
    'com.google.android.gms.car.application': {
      'android:resource': '@xml/rnmbxnav_automotive_app_desc',
    },
    'androidx.car.app.minCarApiLevel': { 'android:value': '1' },
  };
  application['meta-data'] = [
    ...(application['meta-data'] ?? []).filter(
      (item) => !(item.$['android:name'] in metaData)
    ),
    ...Object.entries(metaData).map(([name, value]) => ({
      $: { 'android:name': name, ...value },
    })),
  ];
  application.service = [
    ...(application.service ?? []).filter(
      (service) => service.$['android:name'] !== CAR_APP_SERVICE
    ),
    {
      '$': { 'android:name': CAR_APP_SERVICE, 'android:exported': 'true' },
      'intent-filter': [
        {
          action: [{ $: { 'android:name': 'androidx.car.app.CarAppService' } }],
          category: [
            { $: { 'android:name': 'androidx.car.app.category.NAVIGATION' } },
          ],
        },
      ],
    },
  ];
  return manifest;
}

/** @type {import('expo/config-plugins').ConfigPlugin<MapboxNavigationPluginProps | void>} */
const withMapboxNavigation = (config, props) => {
  const {
    RNMapboxNavigationVersion,
    locationWhenInUsePermission,
    carPlay,
    androidAuto,
  } = props ?? {};

  config = withPodfile(config, (podfileConfig) => {
    podfileConfig.modResults.contents = applyPodfileModifications(
      podfileConfig.modResults.contents,
      { RNMapboxNavigationVersion }
    );
    return podfileConfig;
  });

  config = withInfoPlist(config, (plistConfig) => {
    // The SDK's voice controller asserts on this in debug builds as soon as guidance starts.
    const modes = plistConfig.modResults.UIBackgroundModes ?? [];
    if (!modes.includes('audio')) {
      plistConfig.modResults.UIBackgroundModes = [...modes, 'audio'];
    }
    return plistConfig;
  });

  if (locationWhenInUsePermission !== false) {
    config = withInfoPlist(config, (plistConfig) => {
      plistConfig.modResults.NSLocationWhenInUseUsageDescription =
        locationWhenInUsePermission ??
        plistConfig.modResults.NSLocationWhenInUseUsageDescription ??
        DEFAULT_LOCATION_USAGE;
      return plistConfig;
    });
  }

  if (carPlay) {
    config = withInfoPlist(config, (plistConfig) => {
      plistConfig.modResults = applyCarPlayInfoPlist(plistConfig.modResults);
      return plistConfig;
    });
    config = withEntitlementsPlist(config, (entitlementsConfig) => {
      entitlementsConfig.modResults['com.apple.developer.carplay-maps'] = true;
      return entitlementsConfig;
    });
    config = withAppDelegate(config, (appDelegateConfig) => {
      if (appDelegateConfig.modResults.language !== 'swift') {
        WarningAggregator.addWarningIOS(
          pkg.name,
          'carPlay: only a Swift AppDelegate gets Navigation.registerCarPlayRoot support; set RNMBXNavigationCarPlayRoot.reactNativeFactory yourself'
        );
        return appDelegateConfig;
      }
      appDelegateConfig.modResults.contents = applyCarPlayAppDelegate(
        appDelegateConfig.modResults.contents
      );
      return appDelegateConfig;
    });
  }

  if (androidAuto) {
    config = withAndroidManifest(config, (manifestConfig) => {
      manifestConfig.modResults = applyAndroidAutoManifest(
        manifestConfig.modResults
      );
      return manifestConfig;
    });
  }

  if (RNMapboxNavigationVersion) {
    config = withGradleProperties(config, (gradleConfig) => {
      const key = 'RNMapboxNavigationVersion';
      gradleConfig.modResults = gradleConfig.modResults.filter(
        (item) => !(item.type === 'property' && item.key === key)
      );
      gradleConfig.modResults.push({
        type: 'property',
        key,
        value: RNMapboxNavigationVersion,
      });
      return gradleConfig;
    });
  }

  return config;
};

module.exports = createRunOncePlugin(
  withMapboxNavigation,
  pkg.name,
  pkg.version
);
module.exports.applyPodfileModifications = applyPodfileModifications;
module.exports.applyCarPlayInfoPlist = applyCarPlayInfoPlist;
module.exports.applyCarPlayAppDelegate = applyCarPlayAppDelegate;
module.exports.applyAndroidAutoManifest = applyAndroidAutoManifest;
