#import <UIKit/UIKit.h>

@class RCTReactNativeFactory;

NS_ASSUME_NONNULL_BEGIN

/// Hosts the component registered with `Navigation.registerCarPlayRoot` while CarPlay is connected, so `<CarMap>`
/// children render even when CarPlay launched the app without its phone UI.
@interface RNMBXNavigationCarPlayRoot : NSObject

/// The app's factory, set by the app delegate (the Expo plugin's `carPlayRoot` option adds that). Without it CarPlay
/// shows the map but doesn't start React Native.
@property (class, nonatomic, strong, nullable) RCTReactNativeFactory *reactNativeFactory;

/// Creates the root on the factory's React Native host, starting the host if no scene has yet.
+ (nullable UIView *)makeRootView NS_SWIFT_NAME(makeRootView());

@end

NS_ASSUME_NONNULL_END
