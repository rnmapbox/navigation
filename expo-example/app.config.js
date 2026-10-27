const env = require('./env.json');

// CarPlay can launch the app without React Native, so the native side reads the token from Info.plist.
module.exports = ({ config }) => ({
  ...config,
  ios: {
    ...config.ios,
    infoPlist: { ...config.ios?.infoPlist, MBXAccessToken: env.accessToken },
  },
});
