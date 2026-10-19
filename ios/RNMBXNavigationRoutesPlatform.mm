#import "RNMBXNavigationRoutesPlatform.h"

#import "rnmapbox_navigation-Swift.h"

namespace rnmbxnav {

namespace {

class IOSNativeRoute : public NativeRoute {
 public:
  explicit IOSNativeRoute(RNMBXNavigationRoute *route) : route(route) {}

  ~IOSNativeRoute() override
  {
    NSLog(@"[RNMBXNavigation] native route %p released", route);
  }

  RNMBXNavigationRoute *const route;
};

RNMBXNavigationRoute *unwrap(const std::shared_ptr<NativeRoute> &route)
{
  return route ? static_cast<IOSNativeRoute *>(route.get())->route : nil;
}

NSString *toNSString(const std::string &string)
{
  return [NSString stringWithUTF8String:string.c_str()];
}

std::string toString(NSString *string)
{
  return string ? std::string(string.UTF8String) : std::string();
}

RouteResult toResult(RNMBXNavigationRoute *route)
{
  RouteData data;
  data.distance = route.distance;
  data.expectedTravelTime = route.expectedTravelTime;
  data.coordinates.reserve(route.coordinates.count);
  for (NSNumber *value in route.coordinates) {
    data.coordinates.push_back(value.doubleValue);
  }
  for (NSUInteger i = 0; i < route.legDistances.count; i++) {
    data.legs.push_back({
        route.legDistances[i].doubleValue,
        route.legExpectedTravelTimes[i].doubleValue,
        route.legStepCounts[i].intValue,
        toString(route.legSummaries[i]),
    });
  }
  return {std::move(data), std::make_shared<IOSNativeRoute>(route)};
}

NSDictionary *toDictionary(const RouteRequest &request)
{
  NSMutableArray *waypoints = [NSMutableArray new];
  for (const auto &waypoint : request.waypoints) {
    NSMutableDictionary *dictionary =
        [@{@"longitude" : @(waypoint.longitude), @"latitude" : @(waypoint.latitude)} mutableCopy];
    if (waypoint.name) {
      dictionary[@"name"] = toNSString(*waypoint.name);
    }
    [waypoints addObject:dictionary];
  }
  NSMutableArray *exclude = [NSMutableArray new];
  for (const auto &value : request.exclude) {
    [exclude addObject:toNSString(value)];
  }
  NSMutableDictionary *dictionary = [@{
    @"waypoints" : waypoints,
    @"profile" : toNSString(request.profile),
    @"alternatives" : @(request.alternatives),
    @"exclude" : exclude,
  } mutableCopy];
  if (request.language) {
    dictionary[@"language"] = toNSString(*request.language);
  }
  if (request.units) {
    dictionary[@"units"] = toNSString(*request.units);
  }
  return dictionary;
}

class IOSNavigationPlatform : public NavigationPlatform {
 public:
  explicit IOSNavigationPlatform(RNMBXNavigation *navigation) : navigation_(navigation) {}

  void requestRoutes(
      const RouteRequest &request,
      std::function<void(std::vector<RouteResult>)> resolve,
      RejectCallback reject) override
  {
    [navigation_ requestRoutes:toDictionary(request)
        resolve:^(NSArray<RNMBXNavigationRoute *> *routes) {
          std::vector<RouteResult> results;
          for (RNMBXNavigationRoute *route in routes) {
            results.push_back(toResult(route));
          }
          resolve(std::move(results));
        }
        reject:^(NSString *code, NSString *message) {
          reject(toString(code), toString(message));
        }];
  }

  void startActiveGuidance(
      const std::shared_ptr<NativeRoute> &route,
      bool simulate,
      std::function<void()> resolve,
      RejectCallback reject) override
  {
    [navigation_ startActiveGuidance:unwrap(route)
        simulate:simulate
        resolve:^{
          resolve();
        }
        reject:^(NSString *code, NSString *message) {
          reject(toString(code), toString(message));
        }];
  }

  void previewRoute(const std::shared_ptr<NativeRoute> &route) override
  {
    [navigation_ previewRoute:unwrap(route)];
  }

 private:
  RNMBXNavigation *navigation_;
};

} // namespace

std::shared_ptr<NavigationPlatform> makeNavigationPlatform(RNMBXNavigation *navigation)
{
  return std::make_shared<IOSNavigationPlatform>(navigation);
}

} // namespace rnmbxnav
