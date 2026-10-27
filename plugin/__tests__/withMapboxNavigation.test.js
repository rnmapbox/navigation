const {
  applyAndroidAutoManifest,
  applyCarPlayAppDelegate,
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

describe('applyCarPlayAppDelegate', () => {
  const APP_DELEGATE = `internal import Expo
import React
import ReactAppDependencyProvider

@main
class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {
  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}
`;

  it('imports the module and hands the factory to the CarPlay root', () => {
    expect(applyCarPlayAppDelegate(APP_DELEGATE)).toContain(`import React
// @generated begin @rnmapbox/navigation-import
import rnmapbox_navigation
// @generated end @rnmapbox/navigation-import
import ReactAppDependencyProvider`);
    expect(applyCarPlayAppDelegate(APP_DELEGATE))
      .toContain(`    reactNativeFactory = factory
// @generated begin @rnmapbox/navigation-carplay-root
    RNMBXNavigationCarPlayRoot.reactNativeFactory = factory
// @generated end @rnmapbox/navigation-carplay-root

    return super.application`);
  });

  it('replaces the blocks of a previous run', () => {
    const once = applyCarPlayAppDelegate(APP_DELEGATE);
    expect(applyCarPlayAppDelegate(once)).toBe(once);
  });

  it('throws without the factory assignment', () => {
    expect(() => applyCarPlayAppDelegate('import React\n')).toThrow(
      /AppDelegate\.swift/
    );
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
