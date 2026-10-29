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
  NSUInteger step = 0;
  for (NSUInteger i = 0; i < route.legDistances.count; i++) {
    RouteLeg leg{route.legDistances[i].doubleValue, route.legExpectedTravelTimes[i].doubleValue, toString(route.legSummaries[i])};
    for (int j = 0; j < route.legStepCounts[i].intValue; j++, step++) {
      leg.steps.push_back({
          toString(route.stepInstructions[step]),
          route.stepDistances[step].doubleValue,
          route.stepExpectedTravelTimes[step].doubleValue,
          toString(route.stepManeuverTypes[step]),
          toString(route.stepManeuverModifiers[step]),
          toString(route.stepNames[step]),
      });
    }
    data.legs.push_back(std::move(leg));
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
    dictionary[@"silent"] = @(waypoint.silent);
    if (waypoint.approach) {
      dictionary[@"approach"] = toNSString(*waypoint.approach);
    }
    [waypoints addObject:dictionary];
  }
  NSMutableArray *exclude = [NSMutableArray new];
  for (const auto &value : request.exclude) {
    [exclude addObject:toNSString(value)];
  }
  NSMutableArray *excludePoints = [NSMutableArray new];
  for (const auto &point : request.excludePoints) {
    [excludePoints addObject:@{@"longitude" : @(point.longitude), @"latitude" : @(point.latitude)}];
  }
  NSMutableDictionary *dictionary = [@{
    @"waypoints" : waypoints,
    @"profile" : toNSString(request.profile),
    @"alternatives" : @(request.alternatives),
    @"exclude" : exclude,
    @"excludePoints" : excludePoints,
  } mutableCopy];
  auto setString = [&](NSString *key, const std::optional<std::string> &value) {
    if (value) {
      dictionary[key] = toNSString(*value);
    }
  };
  auto setNumber = [&](NSString *key, const std::optional<double> &value) {
    if (value) {
      dictionary[key] = @(*value);
    }
  };
  setString(@"language", request.language);
  setString(@"units", request.units);
  setNumber(@"maxHeight", request.maxHeight);
  setNumber(@"maxWidth", request.maxWidth);
  setNumber(@"maxWeight", request.maxWeight);
  setString(@"departAt", request.departAt);
  setString(@"arriveBy", request.arriveBy);
  return dictionary;
}

NSArray<NSNumber *> *toArray(const std::vector<double> &values)
{
  NSMutableArray *array = [NSMutableArray arrayWithCapacity:values.size()];
  for (auto value : values) {
    [array addObject:@(value)];
  }
  return array;
}

NSDictionary *toDictionary(const MatchRequest &request)
{
  NSMutableArray *waypointIndices = [NSMutableArray new];
  for (auto index : request.waypointIndices) {
    [waypointIndices addObject:@(index)];
  }
  NSMutableDictionary *dictionary = [@{
    @"coordinates" : toArray(request.coordinates),
    @"profile" : toNSString(request.profile),
    @"waypointIndices" : waypointIndices,
    @"radiuses" : toArray(request.radiuses),
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

  void requestMatchedRoutes(
      const MatchRequest &request,
      std::function<void(std::vector<RouteResult>)> resolve,
      RejectCallback reject) override
  {
    [navigation_ requestMatchedRoutes:toDictionary(request)
        resolve:^(RNMBXNavigationRoute *route) {
          resolve({toResult(route)});
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

  void setRouteChangeHandler(RouteChangeHandler handler) override
  {
    if (!handler) {
      navigation_.onRouteChange = nil;
      return;
    }
    navigation_.onRouteChange = ^(RNMBXNavigationRoute *route, NSString *reason) {
      handler(toResult(route), toString(reason));
    };
  }

 private:
  RNMBXNavigation *navigation_;
};

} // namespace

RNMBXNavigationRoute *findPlatformRoute(double id)
{
  return unwrap(findRoute(id));
}

std::shared_ptr<NavigationPlatform> makeNavigationPlatform(RNMBXNavigation *navigation)
{
  return std::make_shared<IOSNavigationPlatform>(navigation);
}

} // namespace rnmbxnav
