import Combine
import CoreLocation
import Foundation
import MapboxDirections
import MapboxNavigationCore
import Turf

/// Drives simulated guidance along its route. Used instead of `LocationSource.simulation`, whose speed isn't public;
/// like Android's replay, it waits at the end of each leg until guidance moves on to the next one.
@MainActor
final class RNMBXNavigationSimulator {
  var speedMultiplier: Double {
    didSet { if timer != nil, speedMultiplier != oldValue { start() } }
  }

  private let locations = PassthroughSubject<CLLocation, Never>()
  private var timer: Timer?
  private var route: Route
  private var routeId: RouteId
  private var legIndex = 0
  private var step: RouteStep?
  /// Along `route.shape`.
  private var distance: CLLocationDistance = 0
  /// Distances along `route.shape` at which each leg ends.
  private var legEnds: [CLLocationDistance] = []
  private var coordinate: CLLocationCoordinate2D?
  private var course: CLLocationDirection = -1
  /// Progress of the guidance this replaces can still arrive first.
  private var synced = false
  private var subscription: AnyCancellable?

  /// Starts at the point of the route closest to `start`, or at its origin.
  init(
    routes: NavigationRoutes,
    from start: CLLocationCoordinate2D?,
    speedMultiplier: Double,
    routeProgress: AnyPublisher<RouteProgress?, Never>
  ) {
    route = routes.mainRoute.route
    routeId = routes.mainRoute.routeId
    self.speedMultiplier = speedMultiplier
    legEnds = Self.legEnds(route)
    let closest = start.flatMap { route.shape?.closestCoordinate(to: $0) }
    distance = closest?.distance ?? 0
    coordinate = closest?.coordinate ?? route.shape?.coordinates.first
    subscription = routeProgress
      .compactMap { $0 }
      .sink { [weak self] in self?.update($0) }
  }

  var locationClient: LocationClient {
    LocationClient(
      locations: locations.eraseToAnyPublisher(),
      headings: Empty().eraseToAnyPublisher(),
      startUpdatingLocation: { [weak self] in MainActor.assumeIsolated { self?.start() } },
      stopUpdatingLocation: { [weak self] in MainActor.assumeIsolated { self?.stop() } },
      startUpdatingHeading: {},
      stopUpdatingHeading: {}
    )
  }

  /// At the end of `legIndex`, unless it's the last leg.
  func isWaiting(onLeg legIndex: Int) -> Bool {
    legIndex < legEnds.count - 1 && distance >= legEnds[legIndex]
  }

  func stop() {
    timer?.invalidate()
    timer = nil
  }

  private func start() {
    stop()
    let interval = min(1, max(0.2, 1 / speedMultiplier))
    let timer = Timer(timeInterval: interval, repeats: true) { [weak self] _ in
      MainActor.assumeIsolated { self?.tick(interval) }
    }
    // Keeps driving while a map gesture tracks the run loop.
    RunLoop.main.add(timer, forMode: .common)
    self.timer = timer
    tick(0)
  }

  private func update(_ progress: RouteProgress) {
    synced = synced || progress.routeId == routeId
    guard synced else { return }
    if progress.routeId != routeId {
      // A reroute or an alternative: carry on from the same place on the new route.
      route = progress.route
      routeId = progress.routeId
      legEnds = Self.legEnds(route)
      legIndex = progress.legIndex
      distance = coordinate.flatMap { route.shape?.closestCoordinate(to: $0)?.distance } ?? 0
    }
    if progress.legIndex > legIndex, progress.legIndex > 0, legEnds.indices ~= progress.legIndex - 1 {
      distance = max(distance, legEnds[progress.legIndex - 1])
    }
    legIndex = progress.legIndex
    step = progress.currentLegProgress.currentStep
  }

  private func tick(_ interval: TimeInterval) {
    guard let shape = route.shape, let start = shape.coordinates.first else { return }
    let legEnd = legEnds.indices ~= legIndex ? legEnds[legIndex] : shape.distance() ?? 0
    let speed = step.map { $0.expectedTravelTime > 0 ? $0.distance / $0.expectedTravelTime : 0 } ?? 0
    let clampedSpeed = min(max(speed, 6), 30)
    distance = min(distance + clampedSpeed * interval * speedMultiplier, legEnd)
    let current = shape.coordinateFromStart(distance: distance) ?? start
    let ahead = shape.coordinateFromStart(distance: distance + 10) ?? current
    let moving = distance < legEnd
    if moving, ahead != current {
      course = current.direction(to: ahead).wrap(min: 0, max: 360)
    }
    coordinate = current
    // Like Android's replay, reports the route's speed rather than how fast the simulation moves.
    locations.send(CLLocation(
      coordinate: current,
      altitude: 0,
      horizontalAccuracy: 5,
      verticalAccuracy: 5,
      course: course,
      speed: moving ? clampedSpeed : 0,
      timestamp: Date()
    ))
  }

  private static func legEnds(_ route: Route) -> [CLLocationDistance] {
    var end: CLLocationDistance = 0
    return route.legs.map { leg in
      end += leg.steps.reduce(0) { $0 + ($1.shape?.distance() ?? $1.distance) }
      return end
    }
  }
}
