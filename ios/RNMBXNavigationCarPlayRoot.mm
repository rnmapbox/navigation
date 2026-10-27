#import "RNMBXNavigationCarPlayRoot.h"

#import <objc/message.h>

#if __has_include(<React_RCTAppDelegate/RCTReactNativeFactory.h>)
#import <React_RCTAppDelegate/RCTReactNativeFactory.h>
#elif __has_include(<React-RCTAppDelegate/RCTReactNativeFactory.h>)
#import <React-RCTAppDelegate/RCTReactNativeFactory.h>
#else
#import <React/RCTReactNativeFactory.h>
#endif

/// Keep in sync with `CARPLAY_ROOT_MODULE` in src/Navigation.ts.
static NSString *const kModuleName = @"RNMBXNavigationCarPlayRoot";

static RCTReactNativeFactory *sReactNativeFactory;

@implementation RNMBXNavigationCarPlayRoot

+ (RCTReactNativeFactory *)reactNativeFactory
{
  return sReactNativeFactory;
}

+ (void)setReactNativeFactory:(RCTReactNativeFactory *)reactNativeFactory
{
  sReactNativeFactory = reactNativeFactory;
}

+ (UIView *)makeRootView
{
  RCTReactNativeFactory *factory = sReactNativeFactory;
  if (factory == nil) {
    return nil;
  }
  RCTRootViewFactory *rootViewFactory = factory.rootViewFactory;
  // React Native 0.84+ takes the factory's configurations, as `startReactNativeWithModuleName:` passes them; they are
  // nil in release builds.
  SEL configured =
      NSSelectorFromString(@"viewWithModuleName:initialProperties:launchOptions:bundleConfiguration:devMenuConfiguration:");
  if ([rootViewFactory respondsToSelector:configured] &&
      [factory respondsToSelector:NSSelectorFromString(@"bundleConfiguration")] &&
      [factory respondsToSelector:NSSelectorFromString(@"devMenuConfiguration")]) {
    id bundleConfiguration = [factory valueForKey:@"bundleConfiguration"];
    id devMenuConfiguration = [factory valueForKey:@"devMenuConfiguration"];
    return ((UIView * (*)(id, SEL, NSString *, NSDictionary *, NSDictionary *, id, id)) objc_msgSend)(
        rootViewFactory, configured, kModuleName, nil, nil, bundleConfiguration, devMenuConfiguration);
  }
  return [rootViewFactory viewWithModuleName:kModuleName initialProperties:nil launchOptions:nil];
}

@end
