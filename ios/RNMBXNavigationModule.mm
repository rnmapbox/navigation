#import "RNMBXNavigationModule.h"

#import <ReactCommon/RCTTurboModuleWithJSIBindings.h>

#import "RNMBXNavigationRoutesPlatform.h"
#import "rnmapbox_navigation-Swift.h"

@interface RNMBXNavigationModule () <RCTTurboModuleWithJSIBindings>
@end

@implementation RNMBXNavigationModule {
  RNMBXNavigation *_navigation;
}

+ (void)load
{
  // Must be registered before any <MapView mapViewImpl="rnmbxnav"> is created, which can be
  // earlier than the first JS call into this module.
  [RNMBXNavigationMapFactory register];
}

- (instancetype)init
{
  if (self = [super init]) {
    _navigation = [RNMBXNavigation new];
    __weak RNMBXNavigationModule *weakSelf = self;
    _navigation.onSessionStateChange = ^(NSDictionary *event) {
      [weakSelf emitOnSessionStateChange:event];
    };
    _navigation.onRouteProgress = ^(NSDictionary *event) {
      [weakSelf emitOnRouteProgress:event];
    };
    _navigation.onCameraStateChange = ^(NSDictionary *event) {
      [weakSelf emitOnCameraStateChange:event];
    };
    _navigation.onLocationChange = ^(NSDictionary *event) {
      [weakSelf emitOnLocationChange:event];
    };
    _navigation.onArrive = ^(NSDictionary *event) {
      [weakSelf emitOnArrive:event];
    };
    _navigation.onOffRouteChange = ^(NSDictionary *event) {
      [weakSelf emitOnOffRouteChange:event];
    };
    _navigation.onVoiceInstruction = ^(NSDictionary *event) {
      [weakSelf emitOnVoiceInstruction:event];
    };
    _navigation.onCarPlayConnectionChange = ^(NSDictionary *event) {
      [weakSelf emitOnCarPlayConnectionChange:event];
    };
    _navigation.onCarMapChange = ^(NSDictionary *event) {
      [weakSelf emitOnCarMapChange:event];
    };
  }
  return self;
}

+ (NSString *)moduleName
{
  return @"RNMBXNavigationModule";
}

- (void)invalidate
{
  [_navigation invalidate];
}

- (void)setAccessToken:(NSString *)accessToken
{
  [_navigation setAccessToken:accessToken];
}

- (NSString *)getSdkVersion
{
  return [RNMBXNavigation sdkVersion];
}

- (NSString *)getDefaultDistanceUnit
{
  return [RNMBXNavigation defaultDistanceUnit];
}

- (void)startFreeDrive:(BOOL)simulate
             longitude:(double)longitude
              latitude:(double)latitude
               resolve:(RCTPromiseResolveBlock)resolve
                reject:(RCTPromiseRejectBlock)reject
{
  [_navigation startFreeDrive:simulate
      longitude:longitude
      latitude:latitude
      resolve:^{
        resolve(nil);
      }
      reject:^(NSString *code, NSString *message) {
        reject(code, message, nil);
      }];
}

- (void)stopNavigation:(BOOL)freeDrive
{
  [_navigation stopNavigation:freeDrive];
}

- (NSString *)getSessionState
{
  return [_navigation sessionState];
}

- (void)setCameraState:(NSString *)state
{
  [_navigation setCameraState:state];
}

- (NSString *)getCameraState
{
  return [_navigation cameraState];
}

- (void)setVoiceMuted:(BOOL)muted
{
  [_navigation setVoiceMuted:muted];
}

- (void)setRerouteEnabled:(BOOL)enabled
{
  [_navigation setRerouteEnabled:enabled];
}

- (NSNumber *)isVoiceMuted
{
  return @([_navigation isVoiceMuted]);
}

- (void)setVoiceVolume:(double)volume
{
  [_navigation setVoiceVolume:volume];
}

- (void)advanceToNextLeg
{
  [_navigation advanceToNextLeg];
}

- (void)setAutoAdvanceLegs:(BOOL)enabled
{
  [_navigation setAutoAdvanceLegs:enabled];
}

- (void)setSimulationSpeed:(double)multiplier
{
  [_navigation setSimulationSpeed:multiplier];
}

- (void)setKeepScreenOn:(BOOL)keepScreenOn
{
  [_navigation setKeepScreenOn:keepScreenOn];
}

- (NSNumber *)isCarPlayConnected
{
  return @([_navigation isCarPlayConnected]);
}

- (NSDictionary *)getCarMap
{
  return [_navigation carMap];
}

- (void)installJSIBindingsWithRuntime:(facebook::jsi::Runtime &)runtime
                          callInvoker:(const std::shared_ptr<facebook::react::CallInvoker> &)callInvoker
{
  rnmbxnav::install(runtime, callInvoker, rnmbxnav::makeNavigationPlatform(_navigation));
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeRNMBXNavigationModuleSpecJSI>(params);
}

@end
