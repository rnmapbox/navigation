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
  @Published private(set) var routeProgress: RouteProgress? {
    didSet {
      if routeProgress?.legIndex != oldValue?.legIndex { updateSimulation() }
    }
  }
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
  var autoAdvanceLegs = true {
    didSet { updateSimulation() }
  }
  var simulationSpeed = 1.0 {
    didSet { updateSimulation() }
  }
  private var simulating = false
  /// Drives simulated guidance only when the SDK's simulator can't: at a speed other than 1×, whose setter is
  /// internal, or without auto-advancing, since the SDK's simulator drives on past waypoints.
  private var simulator: RNMBXNavigationSimulator?
  private var needsCustomSimulator: Bool { simulationSpeed != 1 || !autoAdvanceLegs }

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
  func setLocationSource(_ source: LocationSource, force: Bool = false) {
    guard let provider, force || provider.coreConfig.locationSource != source else { return }
    var config = provider.coreConfig
    config.locationSource = source
    provider.apply(coreConfig: config)
  }

  /// Nil if guidance stopped or restarted meanwhile.
  func prepareActiveGuidance(_ route: RNMBXNavigationRoute, simulate: Bool) async throws -> MapboxNavigation? {
    let navigation = try mapboxNavigation()
    simulating = simulate
    // Without the origin, the new simulation starts from progress matched against the previous simulation's location.
    let origin = route.routes.mainRoute.route.shape?.coordinates.first.map {
      CLLocation(latitude: $0.latitude, longitude: $0.longitude)
    }
    startSimulation(simulate ? route.routes : nil, from: origin)
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

  /// Simulates `routes` from `location`, or uses live locations without `routes`.
  private func startSimulation(_ routes: NavigationRoutes?, from location: CLLocation?) {
    simulator?.stop()
    simulator = nil
    guard let routes, let provider else {
      setLocationSource(.live)
      return
    }
    if needsCustomSimulator {
      let simulator = RNMBXNavigationSimulator(
        routes: routes,
        from: location?.coordinate,
        speedMultiplier: simulationSpeed,
        routeProgress: provider.mapboxNavigation.navigation().routeProgress.map { $0?.routeProgress }
          .eraseToAnyPublisher()
      )
      self.simulator = simulator
      setLocationSource(.custom(simulator.locationClient))
    } else {
      setLocationSource(.simulation(initialLocation: location), force: true)
    }
  }

  /// Switches the running simulation between the SDK's and ours where needed, carrying on from the current location.
  private func updateSimulation() {
    guard simulating, guidanceRoute != nil, let routeProgress else { return }
    if let simulator, needsCustomSimulator {
      simulator.speedMultiplier = simulationSpeed
      return
    }
    // The SDK's would drive on past the waypoint our simulation waits at; switches once guidance moves on.
    guard needsCustomSimulator != (simulator != nil), simulator?.isWaiting(onLeg: routeProgress.legIndex) != true else { return }
    restartSimulation(routeProgress.navigationRoutes, from: location)
  }

  private func restartSimulation(_ routes: NavigationRoutes, from location: CLLocation?) {
    startSimulation(routes, from: location)
    // The new config also replaces the speech synthesizer.
    Task {
      await Task.yield()
      await Task.yield()
      applyVoiceSettings()
    }
  }

  func advanceToNextLeg() {
    guard guidanceRoute != nil, let provider, let routeProgress, !routeProgress.isFinalLeg else { return }
    provider.mapboxNavigation.navigation().switchLeg(newLegIndex: routeProgress.legIndex + 1)
    // Ours follows the leg index itself; the SDK's would drive on along the skipped leg.
    if simulating, simulator == nil, let start = routeProgress.currentLeg.steps.last?.maneuverLocation {
      restartSimulation(
        routeProgress.navigationRoutes,
        from: CLLocation(latitude: start.latitude, longitude: start.longitude)
      )
    }
  }

  func stop() {
    provider?.mapboxNavigation.tripSession().setToIdle()
    simulating = false
    simulator?.stop()
    simulator = nil
    guidanceRoute = nil
    previewRoutes = nil
    cameraState = .idle
    location = nil
    stopped.send()
  }
}
