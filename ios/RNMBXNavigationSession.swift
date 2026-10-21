import Combine
import CoreLocation
import Foundation
import MapboxNavigationCore

/// Process-wide navigation state shared by the TurboModule and every adopted map.
/// The SDK allows one `MapboxNavigationProvider` per process; it outlives JS reloads.
@MainActor
final class RNMBXNavigationSession {
  static let shared = RNMBXNavigationSession()

  @Published private(set) var location: CLLocation?
  @Published private(set) var routeProgress: RouteProgress?
  /// Routes from the last `requestRoute`, shown on adopted maps until guidance starts or stops.
  @Published var previewRoutes: NavigationRoutes?
  @Published var cameraState: NavigationCameraState = .idle
  /// Fires when navigation stops, so adopted maps can reset their camera.
  let stopped = PassthroughSubject<Void, Never>()

  private(set) var provider: MapboxNavigationProvider?
  private var subscriptions = Set<AnyCancellable>()
  /// Kept until navigation stops, whether or not JS releases its `Route`.
  private var guidanceRoute: RNMBXNavigationRoute?

  var accessToken: String?

  func mapboxNavigation() throws -> MapboxNavigation {
    if let provider {
      return provider.mapboxNavigation
    }
    guard let accessToken, !accessToken.isEmpty else {
      throw NSError(
        domain: "RNMBXNavigation",
        code: 1,
        userInfo: [NSLocalizedDescriptionKey: "Call Navigation.setAccessToken before using navigation"]
      )
    }
    let provider = MapboxNavigationProvider(
      coreConfig: CoreConfig(credentials: NavigationCoreApiConfiguration(accessToken: accessToken))
    )
    self.provider = provider
    let navigation = provider.mapboxNavigation.navigation()
    navigation.locationMatching
      .map(\.enhancedLocation)
      .sink { [weak self] in self?.location = $0 }
      .store(in: &subscriptions)
    navigation.routeProgress
      .map { $0?.routeProgress }
      .sink { [weak self] in self?.routeProgress = $0 }
      .store(in: &subscriptions)
    return provider.mapboxNavigation
  }

  /// Applying the config replaces the location client and the speech synthesizer on a later main actor turn.
  func setLocationSource(_ source: LocationSource, force: Bool = false) {
    guard let provider, force || provider.coreConfig.locationSource != source else { return }
    var config = provider.coreConfig
    config.locationSource = source
    provider.apply(coreConfig: config)
  }

  /// Nil if guidance stopped or restarted meanwhile.
  func prepareActiveGuidance(_ route: RNMBXNavigationRoute, simulate: Bool) async throws -> MapboxNavigation? {
    let navigation = try mapboxNavigation()
    // Without the origin, the new simulation starts from progress matched against the previous simulation's location.
    let origin = route.routes.mainRoute.route.shape?.coordinates.first.map {
      CLLocation(latitude: $0.latitude, longitude: $0.longitude)
    }
    setLocationSource(simulate ? .simulation(initialLocation: origin) : .live, force: simulate)
    guidanceRoute = route
    // `apply(coreConfig:)` swaps the location client two main actor turns later; guidance started before that is
    // matched against the previous client's location.
    await Task.yield()
    await Task.yield()
    return guidanceRoute === route ? navigation : nil
  }

  func stop() {
    provider?.mapboxNavigation.tripSession().setToIdle()
    guidanceRoute = nil
    previewRoutes = nil
    cameraState = .idle
    location = nil
    stopped.send()
  }
}
