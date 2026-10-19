const fs = require('fs');
const path = require('path');
const { getDefaultConfig } = require('@react-native/metro-config');
const { withMetroConfig } = require('react-native-monorepo-config');

const root = path.resolve(__dirname, '..');
// @rnmapbox/maps is a yarn portal to a local checkout; Metro needs to watch its real path and
// resolve its dependencies from this app's node_modules.
const rnmapboxMaps = fs.realpathSync(
  path.join(__dirname, 'node_modules/@rnmapbox/maps')
);

/**
 * Metro configuration
 * https://facebook.github.io/metro/docs/configuration
 *
 * @type {import('metro-config').MetroConfig}
 */
const config = withMetroConfig(getDefaultConfig(__dirname), {
  root,
  dirname: __dirname,
  conditions: ['rnmapbox-navigation-source'],
});

config.watchFolders = [...(config.watchFolders ?? []), rnmapboxMaps];
config.resolver.nodeModulesPaths = [
  path.join(__dirname, 'node_modules'),
  path.join(root, 'node_modules'),
];
config.resolver.blockList = [
  ...[].concat(config.resolver.blockList ?? []),
  new RegExp(
    `^${rnmapboxMaps}/(example|node_modules|lib|android/build|ios/build)/.*`
  ),
];

// The checkout has no built lib/, so use its TypeScript sources.
const resolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === '@rnmapbox/maps') {
    return {
      type: 'sourceFile',
      filePath: path.join(rnmapboxMaps, 'src/index.ts'),
    };
  }
  return (resolveRequest ?? context.resolveRequest)(
    context,
    moduleName,
    platform
  );
};

module.exports = config;
