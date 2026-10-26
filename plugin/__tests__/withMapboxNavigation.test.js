const {
  applyAndroidAutoManifest,
  applyCarPlayInfoPlist,
  applyPodfileModifications,
} = require('../withMapboxNavigation');

const PODFILE = `platform :ios, '16.4'

target 'App' do
  use_expo_modules!

  post_install do |installer|
    react_native_post_install(installer)
  end
end
`;

describe('applyPodfileModifications', () => {
  it('disables linking MapboxMaps before the target', () => {
    const podfile = applyPodfileModifications(PODFILE, {});
    expect(podfile).toContain(`# @generated begin @rnmapbox/navigation
$RNMapboxMapsSwiftPackageManager = { link: false }
# @generated end @rnmapbox/navigation
target 'App' do`);
    expect(podfile).not.toContain('$RNMapboxNavigationVersion');
  });

  it('adds the framework search path in post_install', () => {
    const podfile = applyPodfileModifications(PODFILE, {});
    expect(podfile).toMatch(
      /post_install do \|installer\|\n# @generated begin @rnmapbox\/navigation-post_install\n.*'rnmapbox-maps'/
    );
  });

  it('sets the Navigation SDK version', () => {
    expect(
      applyPodfileModifications(PODFILE, {
        RNMapboxNavigationVersion: '3.24.0',
      })
    ).toContain(`$RNMapboxNavigationVersion = '3.24.0'`);
  });

  it('replaces the blocks of a previous run', () => {
    const once = applyPodfileModifications(PODFILE, {
      RNMapboxNavigationVersion: '3.24.0',
    });
    expect(applyPodfileModifications(once, {})).toBe(
      applyPodfileModifications(PODFILE, {})
    );
  });

  it('throws without a target', () => {
    expect(() => applyPodfileModifications('platform :ios', {})).toThrow(
      /no line matching/
    );
  });
});

describe('applyCarPlayInfoPlist', () => {
  const phoneScene = {
    UISceneConfigurationName: 'Default Configuration',
    UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
  };
  const infoPlist = () => ({
    UIApplicationSceneManifest: {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [phoneScene],
      },
    },
  });

  it('adds the CarPlay scene next to the phone scene', () => {
    const configurations =
      applyCarPlayInfoPlist(infoPlist()).UIApplicationSceneManifest
        .UISceneConfigurations;
    expect(configurations.UIWindowSceneSessionRoleApplication).toEqual([
      phoneScene,
    ]);
    expect(
      configurations.CPTemplateApplicationSceneSessionRoleApplication
    ).toEqual([
      {
        UISceneClassName: 'CPTemplateApplicationScene',
        UISceneConfigurationName: 'CarPlay',
        UISceneDelegateClassName: 'RNMBXNavigationCarPlaySceneDelegate',
      },
    ]);
  });

  it('replaces the scene of a previous run', () => {
    const once = applyCarPlayInfoPlist(infoPlist());
    expect(applyCarPlayInfoPlist(JSON.parse(JSON.stringify(once)))).toEqual(
      once
    );
  });

  it('throws without the scene-based life cycle', () => {
    expect(() => applyCarPlayInfoPlist({})).toThrow(/scene-based life cycle/);
  });
});

describe('applyAndroidAutoManifest', () => {
  const manifest = () => ({
    manifest: {
      '$': { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
      'uses-permission': [
        { $: { 'android:name': 'android.permission.INTERNET' } },
      ],
      'application': [
        { $: { 'android:name': '.MainApplication' }, activity: [] },
      ],
    },
  });

  it('declares the car app service, permissions and metadata', () => {
    const result = applyAndroidAutoManifest(manifest()).manifest;
    expect(result['uses-permission'].map((p) => p.$['android:name'])).toEqual([
      'android.permission.INTERNET',
      'androidx.car.app.NAVIGATION_TEMPLATES',
      'androidx.car.app.ACCESS_SURFACE',
    ]);
    const application = result.application[0];
    expect(application.service).toEqual([
      expect.objectContaining({
        $: {
          'android:name': 'com.rnmapbox.rnmbxnav.RNMBXNavigationCarAppService',
          'android:exported': 'true',
        },
      }),
    ]);
    expect(application['meta-data'].map((m) => m.$['android:name'])).toEqual([
      'com.google.android.gms.car.application',
      'androidx.car.app.minCarApiLevel',
    ]);
  });

  it('replaces the entries of a previous run', () => {
    const once = applyAndroidAutoManifest(manifest());
    expect(applyAndroidAutoManifest(JSON.parse(JSON.stringify(once)))).toEqual(
      once
    );
  });
});
