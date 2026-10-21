const { applyPodfileModifications } = require('../withMapboxNavigation');

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
