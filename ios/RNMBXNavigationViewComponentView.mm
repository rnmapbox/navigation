#import "RNMBXNavigationViewComponentView.h"

#import <react/renderer/components/rnmapbox_navigation_specs/ComponentDescriptors.h>
#import <react/renderer/components/rnmapbox_navigation_specs/EventEmitters.h>
#import <react/renderer/components/rnmapbox_navigation_specs/Props.h>
#import <react/renderer/components/rnmapbox_navigation_specs/RCTComponentViewHelpers.h>

#import "RNMBXNavigationRoutesPlatform.h"
#import "rnmapbox_navigation-Swift.h"

using namespace facebook::react;

@interface RNMBXNavigationViewComponentView () <RCTRNMBXNavigationViewViewProtocol>
@end

@implementation RNMBXNavigationViewComponentView {
  RNMBXNavigationView *_view;
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    static const auto defaultProps = std::make_shared<const RNMBXNavigationViewProps>();
    _props = defaultProps;
    _view = [RNMBXNavigationView new];
    __weak RNMBXNavigationViewComponentView *weakSelf = self;
    _view.onRouteProgress = ^(NSDictionary *event) {
      if (auto emitter = [weakSelf eventEmitter]) {
        emitter->onRouteProgress({
            .distanceRemaining = [event[@"distanceRemaining"] doubleValue],
            .distanceTraveled = [event[@"distanceTraveled"] doubleValue],
            .durationRemaining = [event[@"durationRemaining"] doubleValue],
            .fractionTraveled = [event[@"fractionTraveled"] doubleValue],
            .stepDistanceRemaining = [event[@"stepDistanceRemaining"] doubleValue],
            .maneuverInstruction = std::string([event[@"maneuverInstruction"] UTF8String]),
            .maneuverType = std::string([event[@"maneuverType"] UTF8String]),
            .maneuverModifier = std::string([event[@"maneuverModifier"] UTF8String]),
        });
      }
    };
    _view.onArrive = ^(NSDictionary *event) {
      if (auto emitter = [weakSelf eventEmitter]) {
        emitter->onArrive({
            .waypointIndex = [event[@"waypointIndex"] intValue],
            .isFinalDestination = [event[@"isFinalDestination"] boolValue],
        });
      }
    };
    _view.onCancel = ^{
      if (auto emitter = [weakSelf eventEmitter]) {
        emitter->onCancel({});
      }
    };
    _view.onError = ^(NSDictionary *event) {
      [weakSelf emitError:event[@"code"] message:event[@"message"]];
    };
    self.contentView = _view;
  }
  return self;
}

// The embedded view controller and the guidance it started can't be handed to another instance.
+ (BOOL)shouldBeRecycled
{
  return NO;
}

- (void)invalidate
{
  [_view invalidate];
  [super invalidate];
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<RNMBXNavigationViewComponentDescriptor>();
}

- (std::shared_ptr<const RNMBXNavigationViewEventEmitter>)eventEmitter
{
  return std::static_pointer_cast<const RNMBXNavigationViewEventEmitter>(_eventEmitter);
}

- (void)emitError:(NSString *)code message:(NSString *)message
{
  if (auto emitter = [self eventEmitter]) {
    emitter->onError({.code = std::string(code.UTF8String), .message = std::string(message.UTF8String)});
  }
}

- (void)updateProps:(const Props::Shared &)props oldProps:(const Props::Shared &)oldProps
{
  const auto &oldViewProps = static_cast<const RNMBXNavigationViewProps &>(*_props);
  const auto &newProps = static_cast<const RNMBXNavigationViewProps &>(*props);
  _view.simulate = newProps.simulate;
  _view.mute = newProps.mute;
  if (newProps.routeId != oldViewProps.routeId && newProps.routeId != 0) {
    RNMBXNavigationRoute *route = rnmbxnav::findPlatformRoute(newProps.routeId);
    if (route) {
      _view.route = route;
    } else {
      [self emitError:@"route_released" message:@"Route was released"];
    }
  }
  [super updateProps:props oldProps:oldProps];
}

@end
