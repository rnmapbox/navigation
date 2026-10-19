import Foundation
import MapboxDirections
import MapboxNavigationCore

/// One route of a `requestRoutes` response, held by a JS `Route` host object through ObjC++.
///
/// `routes` has this route selected as the main route, so guidance and preview can use it as is.
/// The summary properties are copied once so the C++ side can cache them without touching Swift again.
@objc(RNMBXNavigationRoute)
public final class RNMBXNavigationRoute: NSObject, @unchecked Sendable {
  let routes: NavigationRoutes

  @objc public let distance: Double
  @objc public let expectedTravelTime: Double
  /// Longitude, latitude pairs.
  @objc public let coordinates: [NSNumber]
  @objc public let legDistances: [NSNumber]
  @objc public let legExpectedTravelTimes: [NSNumber]
  @objc public let legStepCounts: [NSNumber]
  @objc public let legSummaries: [String]

  init(_ routes: NavigationRoutes) {
    self.routes = routes
    let route = routes.mainRoute.route
    distance = route.distance
    expectedTravelTime = route.expectedTravelTime
    coordinates = (route.shape?.coordinates ?? []).flatMap {
      [NSNumber(value: $0.longitude), NSNumber(value: $0.latitude)]
    }
    legDistances = route.legs.map { NSNumber(value: $0.distance) }
    legExpectedTravelTimes = route.legs.map { NSNumber(value: $0.expectedTravelTime) }
    legStepCounts = route.legs.map { NSNumber(value: $0.steps.count) }
    legSummaries = route.legs.map(\.name)
  }
}
