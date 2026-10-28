const withMapboxNavigation = require('../withMapboxNavigation');
const {
  applyAndroidAutoManifest,
  applyBackgroundAudio,
  applyCarPlayAppDelegate,
  applyCarPlayInfoPlist,
  removeAndroidAutoManifest,
  removeCarPlayInfoPlist,
  updateCarPlayAppDelegate,
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

describe('applyBackgroundAudio', () => {
  it('adds audio next to existing modes', () => {
    expect(
      applyBackgroundAudio({ UIBackgroundModes: ['location'] })
        .UIBackgroundModes
    ).toEqual(['location', 'audio']);
  });

  it('adds it only once', () => {
    expect(
      applyBackgroundAudio(applyBackgroundAudio({})).UIBackgroundModes
    ).toEqual(['audio']);
  });
});

describe('withMapboxNavigation', () => {
  const run = (props) =>
    withMapboxNavigation({ name: 'App', slug: 'app' }, props);

  afterEach(() => jest.restoreAllMocks());

  it('warns that backgroundAudio is ignored', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    run({ backgroundAudio: false });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/backgroundAudio was removed/);
  });

  it("doesn't warn without backgroundAudio", () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    run();
    run({});
    expect(warn).not.toHaveBeenCalled();
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

  it('accepts an import with an access level', () => {
    expect(
      applyCarPlayAppDelegate(
        APP_DELEGATE.replace('\nimport React\n', '\ninternal import React\n')
      )
    ).toContain('internal import React\n// @generated begin');
  });

  describe('updateCarPlayAppDelegate', () => {
    const swift = (contents) => ({ contents, language: 'swift' });

    it('removes the lines when carPlayRoot is off', () => {
      const applied = applyCarPlayAppDelegate(APP_DELEGATE);
      expect(updateCarPlayAppDelegate(swift(applied), false)).toEqual({
        contents: APP_DELEGATE,
      });
    });

    it('leaves an app delegate without them alone when carPlayRoot is off', () => {
      expect(updateCarPlayAppDelegate(swift(APP_DELEGATE), false)).toEqual({
        contents: APP_DELEGATE,
      });
    });

    it('warns instead of failing for an app delegate it does not know', () => {
      const result = updateCarPlayAppDelegate(swift('import React\n'), true);
      expect(result.contents).toBe('import React\n');
      expect(result.warning).toMatch(/reactNativeFactory = factory/);
    });

    it('warns for an Objective-C app delegate', () => {
      const result = updateCarPlayAppDelegate(
        { contents: '@implementation AppDelegate\n@end\n', language: 'objcpp' },
        true
      );
      expect(result.contents).toBe('@implementation AppDelegate\n@end\n');
      expect(result.warning).toMatch(/Swift/);
    });
  });
});

describe('removeCarPlayInfoPlist', () => {
  it('removes only its own CarPlay scene', () => {
    const other = { UISceneDelegateClassName: 'OtherCarPlayDelegate' };
    const infoPlist = applyCarPlayInfoPlist({
      UIApplicationSceneManifest: {
        UISceneConfigurations: { UIWindowSceneSessionRoleApplication: [{}] },
      },
    });
    infoPlist.UIApplicationSceneManifest.UISceneConfigurations.CPTemplateApplicationSceneSessionRoleApplication.push(
      other
    );
    expect(
      removeCarPlayInfoPlist(infoPlist).UIApplicationSceneManifest
        .UISceneConfigurations.CPTemplateApplicationSceneSessionRoleApplication
    ).toEqual([other]);
  });

  it('leaves an Info.plist without scenes alone', () => {
    expect(removeCarPlayInfoPlist({ CFBundleName: 'App' })).toEqual({
      CFBundleName: 'App',
    });
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

describe('removeAndroidAutoManifest', () => {
  it('removes the service and metadata but keeps the permissions', () => {
    const manifest = applyAndroidAutoManifest({
      manifest: {
        $: {},
        application: [{ $: { 'android:name': '.MainApplication' } }],
      },
    });
    const application =
      removeAndroidAutoManifest(manifest).manifest.application[0];
    expect(application.service).toEqual([]);
    expect(application['meta-data']).toEqual([]);
    expect(manifest.manifest['uses-permission']).toHaveLength(2);
  });
});
