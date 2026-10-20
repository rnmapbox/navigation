const {
  createRunOncePlugin,
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
 */

/**
 * Inserts a tagged block of `lines` before (`offset` 0) or after (`offset` 1) the first line matching
 * `anchor`, replacing the block of a previous run.
 * @param {string} src
 * @param {{ tag: string, lines: string[], anchor: RegExp, offset: 0 | 1 }} options
 */
function addGeneratedBlock(src, { tag, lines, anchor, offset }) {
  const begin = `# @generated begin ${tag}`;
  const end = `# @generated end ${tag}`;
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
    throw new Error(`${pkg.name}: no line matching ${anchor} in the Podfile`);
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

/** @type {import('expo/config-plugins').ConfigPlugin<MapboxNavigationPluginProps | void>} */
const withMapboxNavigation = (config, props) => {
  const { RNMapboxNavigationVersion, locationWhenInUsePermission } =
    props ?? {};

  config = withPodfile(config, (podfileConfig) => {
    podfileConfig.modResults.contents = applyPodfileModifications(
      podfileConfig.modResults.contents,
      { RNMapboxNavigationVersion }
    );
    return podfileConfig;
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
