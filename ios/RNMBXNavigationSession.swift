import Combine
import CoreLocation
import Foundation
import MapboxDirections
import MapboxNavigationCore
import rnmapbox_maps

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
  @Published private(set) var offRoute = false
  /// Fires when navigation stops, so adopted maps can reset their camera.
  let stopped = PassthroughSubject<Void, Never>()
  let mapMatching = PassthroughSubject<MapMatchingState, Never>()
  let arrivals = PassthroughSubject<(waypointIndex: Int, isFinalDestination: Bool), Never>()
  let voiceInstructions = PassthroughSubject<SpokenInstruction, Never>()
  let routeChanges = PassthroughSubject<(NavigationRoutes, String), Never>()

  @Published var voiceMuted = false {
    didSet { applyVoiceSettings() }
  }
  /// `nil` leaves the SDK's default, the system volume.
  var voiceVolume: Float? {
    didSet { applyVoiceSettings() }
  }
  var autoAdvanceLegs = true
  var simulationSpeed = 1.0 {
    didSet { simulator?.speedMultiplier = simulationSpeed }
  }
  private var simulator: RNMBXNavigationSimulator?

  @Published private(set) var provider: MapboxNavigationProvider?
  private var subscriptions = Set<AnyCancellable>()
  /// Kept until navigation stops, whether or not JS releases its `Route`.
  private var guidanceRoute: RNMBXNavigationRoute?

  var accessToken: String? {
    didSet {
      if let provider, let accessToken, accessToken != provider.coreConfig.credentials.navigation.accessToken {
        Logger.log(level: .warn, message: "Navigation.setAccessToken: the session already uses another token, e.g. from Info.plist")
      }
    }
  }

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
      coreConfig: CoreConfig(
        credentials: NavigationCoreApiConfiguration(accessToken: accessToken),
        multilegAdvancing: .manually { _ in await MainActor.run { RNMBXNavigationSession.shared.autoAdvanceLegs } }
      )
    )
    self.provider = provider
    let navigation = provider.mapboxNavigation.navigation()
    navigation.locationMatching
      .sink { [weak self] state in
        self?.location = state.enhancedLocation
        self?.mapMatching.send(state)
      }
      .store(in: &subscriptions)
    navigation.routeProgress
      .map { $0?.routeProgress }
      .sink { [weak self] in self?.routeProgress = $0 }
      .store(in: &subscriptions)
    navigation.waypointsArrival
      .sink { [weak self] status in
        switch status.event {
        case let event as WaypointArrivalStatus.Events.ToWaypoint:
          self?.arrivals.send((event.legIndex + 1, false))
        case is WaypointArrivalStatus.Events.ToFinalDestination:
          let legCount = self?.routeProgress?.route.legs.count ?? 1
          self?.arrivals.send((legCount, true))
        default:
          break
        }
      }
      .store(in: &subscriptions)
    navigation.voiceInstructions
      .sink { [weak self] in self?.voiceInstructions.send($0.spokenInstruction) }
      .store(in: &subscriptions)
    navigation.rerouting
      .sink { [weak self, weak provider] status in
        guard status.event is ReroutingStatus.Events.Fetched,
              let routes = provider?.mapboxNavigation.tripSession().currentNavigationRoutes
        else { return }
        self?.routeChanges.send((routes, "reroute"))
      }
      .store(in: &subscriptions)
    navigation.continuousAlternatives
      .sink { [weak self] status in
        guard let event = status.event as? AlternativesStatus.Events.SwitchedToAlternative else { return }
        self?.routeChanges.send((event.navigationRoutes, "alternative"))
      }
      .store(in: &subscriptions)
    provider.mapboxNavigation.tripSession().session
      .map { session in
        if case .activeGuidance(.offRoute) = session.state { return true }
        return false
      }
      .removeDuplicates()
      .sink { [weak self] in self?.offRoute = $0 }
      .store(in: &subscriptions)
    return provider.mapboxNavigation
  }

  /// Applying the config replaces the location client and the speech synthesizer on a later main actor turn.
  func setLocationSource(_ source: LocationSource) {
    guard let provider, provider.coreConfig.locationSource != source else { return }
    var config = provider.coreConfig
    config.locationSource = source
    provider.apply(coreConfig: config)
  }

  /// Nil if guidance stopped or restarted meanwhile.
  func prepareActiveGuidance(_ route: RNMBXNavigationRoute, simulate: Bool) async throws -> MapboxNavigation? {
    let navigation = try mapboxNavigation()
    simulator?.stop()
    simulator = simulate
      ? RNMBXNavigationSimulator(
        routes: route.routes,
        speedMultiplier: simulationSpeed,
        routeProgress: navigation.navigation().routeProgress.map { $0?.routeProgress }.eraseToAnyPublisher()
      )
      : nil
    setLocationSource(simulator.map { .custom($0.locationClient) } ?? .live)
    guidanceRoute = route
    // `apply(coreConfig:)` swaps the location client and the speech synthesizer two main actor turns later; guidance
    // started before that is matched against the previous client's location.
    await Task.yield()
    await Task.yield()
    applyVoiceSettings()
    return guidanceRoute === route ? navigation : nil
  }

  /// Creates the SDK speech player on first use, which then speaks for any guidance.
  private func applyVoiceSettings() {
    guard let provider else { return }
    let synthesizer = provider.routeVoiceController.speechSynthesizer
    if synthesizer.muted != voiceMuted {
      synthesizer.muted = voiceMuted
    }
    let volume: VolumeMode = voiceVolume.map { .override($0) } ?? .system
    if synthesizer.volume != volume {
      synthesizer.volume = volume
    }
  }

  func advanceToNextLeg() {
    guard guidanceRoute != nil, let provider, let routeProgress, !routeProgress.isFinalLeg else { return }
    provider.mapboxNavigation.navigation().switchLeg(newLegIndex: routeProgress.legIndex + 1)
  }

  func stop() {
    provider?.mapboxNavigation.tripSession().setToIdle()
    simulator?.stop()
    simulator = nil
    guidanceRoute = nil
    previewRoutes = nil
    cameraState = .idle
    location = nil
    stopped.send()
  }
}
