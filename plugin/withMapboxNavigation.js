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
 * @property {boolean} [carPlayRoot] With `carPlay`, hands the app delegate's React Native factory to the CarPlay
 *   scene, so the component passed to `Navigation.registerCarPlayRoot` renders, and React Native starts, when CarPlay
 *   launches the app without its phone UI.
 * @property {boolean} [backgroundAudio] Adds `audio` to iOS `UIBackgroundModes`, so voice guidance keeps
 *   speaking in the background; defaults to `true`, `false` leaves the background modes unchanged.
 */

/**
 * Inserts a tagged block of `lines` before (`offset` 0) or after (`offset` 1) the first line matching
 * `anchor`, replacing the block of a previous run.
 * @param {string} src
 * @param {{ tag: string, lines: string[], anchor: RegExp, offset: 0 | 1, comment?: string, file?: string }} options
 */
function addGeneratedBlock(
  src,
  {
    tag,
    lines,
    anchor,
    offset,
    comment = '#',
    indent = '',
    file = 'the Podfile',
  }
) {
  const srcLines = removeGeneratedBlock(src, { tag, comment }).split('\n');
  const index = srcLines.findIndex((line) => anchor.test(line));
  if (index === -1) {
    throw new Error(`${pkg.name}: no line matching ${anchor} in ${file}`);
  }
  srcLines.splice(
    index + offset,
    0,
    `${indent}${comment} @generated begin ${tag}`,
    ...lines,
    `${indent}${comment} @generated end ${tag}`
  );
  return srcLines.join('\n');
}

/**
 * Removes the block `addGeneratedBlock` inserted for `tag`, if any.
 * @param {string} src
 * @param {{ tag: string, comment?: string }} options
 */
function removeGeneratedBlock(src, { tag, comment = '#' }) {
  const srcLines = src.split('\n');
  const start = srcLines.findIndex(
    (line) => line.trim() === `${comment} @generated begin ${tag}`
  );
  if (start === -1) {
    return src;
  }
  const stop = srcLines.findIndex(
    (line, index) =>
      index > start && line.trim() === `${comment} @generated end ${tag}`
  );
  srcLines.splice(start, stop - start + 1);
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

/**
 * Adds `audio` to `UIBackgroundModes` once.
 * @param {Record<string, any>} infoPlist
 */
function applyBackgroundAudio(infoPlist) {
  const modes = infoPlist.UIBackgroundModes ?? [];
  if (!modes.includes('audio')) {
    infoPlist.UIBackgroundModes = [...modes, 'audio'];
  }
  return infoPlist;
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
 * Removes the CarPlay scene `applyCarPlayInfoPlist` added, keeping other CarPlay scenes.
 * @param {Record<string, any>} infoPlist
 */
function removeCarPlayInfoPlist(infoPlist) {
  const configurations =
    infoPlist.UIApplicationSceneManifest?.UISceneConfigurations;
  const scenes = configurations?.[CARPLAY_SCENE_ROLE];
  if (!scenes) {
    return infoPlist;
  }
  const others = scenes.filter(
    (/** @type {Record<string, string>} */ scene) =>
      scene.UISceneDelegateClassName !== 'RNMBXNavigationCarPlaySceneDelegate'
  );
  if (others.length > 0) {
    configurations[CARPLAY_SCENE_ROLE] = others;
  } else {
    delete configurations[CARPLAY_SCENE_ROLE];
  }
  return infoPlist;
}

const APP_DELEGATE_TAGS = [
  '@rnmapbox/navigation-import',
  '@rnmapbox/navigation-carplay-root',
];

/**
 * Hands the React Native factory the Swift app delegate creates to the CarPlay scene, which starts React Native for
 * `Navigation.registerCarPlayRoot` on it, replacing the lines of a previous run.
 * @param {string} appDelegate
 */
function applyCarPlayAppDelegate(appDelegate) {
  const src = addGeneratedBlock(appDelegate, {
    tag: APP_DELEGATE_TAGS[0],
    lines: ['import rnmapbox_navigation'],
    anchor: /^(\w+ )?import React$/,
    offset: 1,
    comment: '//',
    file: 'AppDelegate.swift',
  });
  return addGeneratedBlock(src, {
    tag: APP_DELEGATE_TAGS[1],
    lines: ['    RNMBXNavigationCarPlayRoot.reactNativeFactory = factory'],
    anchor: /^\s*reactNativeFactory = factory$/,
    offset: 1,
    comment: '//',
    indent: '    ',
    file: 'AppDelegate.swift',
  });
}

/**
 * Removes the lines `applyCarPlayAppDelegate` added.
 * @param {string} appDelegate
 */
function removeCarPlayAppDelegate(appDelegate) {
  return APP_DELEGATE_TAGS.reduce(
    (src, tag) => removeGeneratedBlock(src, { tag, comment: '//' }),
    appDelegate
  );
}

/**
 * Applies or removes the `carPlayRoot` lines of the app delegate; returns a warning instead of failing the prebuild
 * when the app delegate isn't one it knows.
 * @param {{ contents: string, language: string }} appDelegate
 * @param {boolean} carPlayRoot
 * @returns {{ contents: string, warning?: string }}
 */
function updateCarPlayAppDelegate({ contents, language }, carPlayRoot) {
  const unchanged = removeCarPlayAppDelegate(contents);
  if (!carPlayRoot) {
    return { contents: unchanged };
  }
  const manual =
    'set RNMBXNavigationCarPlayRoot.reactNativeFactory in the app delegate yourself';
  if (language !== 'swift') {
    return {
      contents: unchanged,
      warning: `carPlayRoot: only a Swift AppDelegate is supported; ${manual}`,
    };
  }
  try {
    return { contents: applyCarPlayAppDelegate(unchanged) };
  } catch (error) {
    return {
      contents: unchanged,
      warning: `carPlayRoot: ${/** @type {Error} */ (error).message}; ${manual}`,
    };
  }
}

const CAR_APP_SERVICE = 'com.rnmapbox.rnmbxnav.RNMBXNavigationCarAppService';
const CAR_APP_META_DATA = [
  'com.google.android.gms.car.application',
  'androidx.car.app.minCarApiLevel',
];

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

/**
 * Removes the Android Auto service and metadata `applyAndroidAutoManifest` added; the permissions stay, as other
 * libraries may need them too.
 * @param {import('expo/config-plugins').AndroidConfig.Manifest.AndroidManifest} manifest
 */
function removeAndroidAutoManifest(manifest) {
  const application = AndroidConfig.Manifest.getMainApplication(manifest);
  if (!application) {
    return manifest;
  }
  if (application.service) {
    application.service = application.service.filter(
      (service) => service.$['android:name'] !== CAR_APP_SERVICE
    );
  }
  if (application['meta-data']) {
    application['meta-data'] = application['meta-data'].filter(
      (item) => !CAR_APP_META_DATA.includes(item.$['android:name'])
    );
  }
  return manifest;
}

/**
 * Returns a warning when the `@rnmapbox/maps` plugin's `RNMapboxMapsVersion` isn't the Maps 11.N that Navigation SDK
 * 3.N pins, which otherwise only fails later, in Gradle or Swift package resolution.
 * @param {{ plugins?: unknown[] }} config
 * @param {string} navigationVersion
 * @returns {string | undefined}
 */
function mapsVersionMismatchWarning(config, navigationVersion) {
  const mapsPlugin = (config.plugins ?? []).find(
    (plugin) => Array.isArray(plugin) && plugin[0] === '@rnmapbox/maps'
  );
  /** @type {string | undefined} */
  const mapsVersion = Array.isArray(mapsPlugin)
    ? mapsPlugin[1]?.RNMapboxMapsVersion
    : undefined;
  const mapsMinor = mapsVersion?.match(/(\d+)\.(\d+)/);
  const navigationMinor = navigationVersion.match(/^3\.(\d+)/);
  if (!mapsMinor || !navigationMinor) {
    return undefined;
  }
  if (mapsMinor[1] === '11' && mapsMinor[2] === navigationMinor[1]) {
    return undefined;
  }
  const expected = navigationVersion.replace(/^3\./, '11.');
  return `Navigation SDK ${navigationVersion} needs Maps SDK ${expected}, but the @rnmapbox/maps plugin sets RNMapboxMapsVersion to ${mapsVersion}`;
}

/** @type {import('expo/config-plugins').ConfigPlugin<MapboxNavigationPluginProps | void>} */
const withMapboxNavigation = (config, props) => {
  const {
    RNMapboxNavigationVersion,
    locationWhenInUsePermission,
    carPlay,
    carPlayRoot,
    androidAuto,
    backgroundAudio = true,
  } = props ?? {};

  config = withPodfile(config, (podfileConfig) => {
    const mapsWarning = mapsVersionMismatchWarning(
      podfileConfig,
      RNMapboxNavigationVersion ?? pkg.mapboxNavigation.ios
    );
    if (mapsWarning) {
      WarningAggregator.addWarningIOS(pkg.name, mapsWarning);
    }
    podfileConfig.modResults.contents = applyPodfileModifications(
      podfileConfig.modResults.contents,
      { RNMapboxNavigationVersion }
    );
    return podfileConfig;
  });

  if (backgroundAudio) {
    // The SDK's voice controller asserts on this in debug builds as soon as guidance starts.
    config = withInfoPlist(config, (plistConfig) => {
      plistConfig.modResults = applyBackgroundAudio(plistConfig.modResults);
      return plistConfig;
    });
  }

  if (locationWhenInUsePermission !== false) {
    config = withInfoPlist(config, (plistConfig) => {
      plistConfig.modResults.NSLocationWhenInUseUsageDescription =
        locationWhenInUsePermission ??
        plistConfig.modResults.NSLocationWhenInUseUsageDescription ??
        DEFAULT_LOCATION_USAGE;
      return plistConfig;
    });
  }

  // Options turned off remove what a previous prebuild added; the entitlement and permissions stay.
  config = withInfoPlist(config, (plistConfig) => {
    plistConfig.modResults = carPlay
      ? applyCarPlayInfoPlist(plistConfig.modResults)
      : removeCarPlayInfoPlist(plistConfig.modResults);
    return plistConfig;
  });
  if (carPlay) {
    config = withEntitlementsPlist(config, (entitlementsConfig) => {
      entitlementsConfig.modResults['com.apple.developer.carplay-maps'] = true;
      return entitlementsConfig;
    });
  }
  if (carPlayRoot && !carPlay) {
    WarningAggregator.addWarningIOS(pkg.name, 'carPlayRoot needs carPlay');
  }
  config = withAppDelegate(config, (appDelegateConfig) => {
    const { contents, warning } = updateCarPlayAppDelegate(
      appDelegateConfig.modResults,
      Boolean(carPlay && carPlayRoot)
    );
    appDelegateConfig.modResults.contents = contents;
    if (warning) {
      WarningAggregator.addWarningIOS(pkg.name, warning);
    }
    return appDelegateConfig;
  });

  config = withAndroidManifest(config, (manifestConfig) => {
    const mapsWarning = mapsVersionMismatchWarning(
      manifestConfig,
      RNMapboxNavigationVersion ?? pkg.mapboxNavigation.android
    );
    if (mapsWarning) {
      WarningAggregator.addWarningAndroid(pkg.name, mapsWarning);
    }
    manifestConfig.modResults = androidAuto
      ? applyAndroidAutoManifest(manifestConfig.modResults)
      : removeAndroidAutoManifest(manifestConfig.modResults);
    return manifestConfig;
  });

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
module.exports.removeCarPlayInfoPlist = removeCarPlayInfoPlist;
module.exports.applyCarPlayAppDelegate = applyCarPlayAppDelegate;
module.exports.updateCarPlayAppDelegate = updateCarPlayAppDelegate;
module.exports.removeAndroidAutoManifest = removeAndroidAutoManifest;
module.exports.applyAndroidAutoManifest = applyAndroidAutoManifest;
module.exports.applyBackgroundAudio = applyBackgroundAudio;
module.exports.mapsVersionMismatchWarning = mapsVersionMismatchWarning;
