import Combine
import CoreLocation
import Foundation
import MapboxDirections
import MapboxNavigationCore

@objc(RNMBXNavigation)
public final class RNMBXNavigation: NSObject {
  @objc public var onRouteProgress: (([String: Any]) -> Void)?
  @objc public var onCameraStateChange: (([String: Any]) -> Void)?

  @MainActor private var guidanceRoute: RNMBXNavigationRoute?
  @MainActor private var progressSubscription: AnyCancellable?
  @MainActor private var cameraStateSubscription: AnyCancellable?

  /// `getCameraState` is synchronous and runs on the JS thread; the session lives on the main thread.
  private let cameraStateLock = NSLock()
  private var _cameraState = "idle"

  override public init() {
    super.init()
    Task { @MainActor in
      self.cameraStateSubscription = RNMBXNavigationSession.shared.$cameraState
        .map(Self.name)
        .removeDuplicates()
        .sink { [weak self] state in
          guard let self else { return }
          self.cameraStateLock.withLock { self._cameraState = state }
          self.onCameraStateChange?(["state": state])
        }
    }
  }

  @objc public static func sdkVersion() -> String {
    Bundle.mapboxNavigationVersion
  }

  @objc public func setAccessToken(_ accessToken: String) {
    Task { @MainActor in
      RNMBXNavigationSession.shared.accessToken = accessToken
    }
  }

  @objc public func invalidate() {
    Task { @MainActor in
      self.cameraStateSubscription = nil
      self.stopNavigationOnMain()
    }
  }

  /// `request` has the shape of `RouteRequest` in cpp/RNMBXNavigationRoutes.h. `resolve` gets the main route first.
  @objc public func requestRoutes(
    _ request: [String: Any],
    resolve: @escaping ([RNMBXNavigationRoute]) -> Void,
    reject: @escaping (String, String) -> Void
  ) {
    let waypoints = (request["waypoints"] as? [[String: Any]] ?? []).compactMap { waypoint -> Waypoint? in
      guard let longitude = (waypoint["longitude"] as? NSNumber)?.doubleValue,
            let latitude = (waypoint["latitude"] as? NSNumber)?.doubleValue
      else { return nil }
      return Waypoint(
        coordinate: CLLocationCoordinate2D(latitude: latitude, longitude: longitude),
        name: waypoint["name"] as? String
      )
    }
    guard waypoints.count >= 2 else {
      reject("invalid_waypoints", "requestRoutes needs at least an origin and a destination")
      return
    }
    let options = NavigationRouteOptions(
      waypoints: waypoints,
      profileIdentifier: ProfileIdentifier(rawValue: "mapbox/\(request["profile"] as? String ?? "driving-traffic")")
    )
    options.includesAlternativeRoutes = request["alternatives"] as? Bool ?? false
    if let exclude = request["exclude"] as? [String], !exclude.isEmpty {
      guard let roadClasses = RoadClasses(descriptions: exclude) else {
        reject("invalid_exclude", "Unknown exclude value in \(exclude)")
        return
      }
      options.roadClassesToAvoid = roadClasses
    }
    if let language = request["language"] as? String {
      options.locale = Locale(identifier: language)
    }
    switch request["units"] as? String {
    case "imperial":
      options.distanceUnit = .mile
      options.unitMeasurementSystem = .imperial
    case "metric":
      options.distanceUnit = .kilometer
      options.unitMeasurementSystem = .metric
    default: break
    }

    Task { @MainActor in
      do {
        let navigation = try RNMBXNavigationSession.shared.mapboxNavigation()
        let routes = try await navigation.routingProvider().calculateRoutes(options: options).value
        var result = [RNMBXNavigationRoute(routes)]
        for index in routes.alternativeRoutes.indices {
          if let alternative = await routes.selectingAlternativeRoute(at: index) {
            result.append(RNMBXNavigationRoute(alternative))
          }
        }
        resolve(result)
      } catch {
        reject("route_request_failed", error.localizedDescription)
      }
    }
  }

  /// Guidance keeps `route` until `stopNavigation`, whether or not JS releases its `Route`.
  @objc public func startActiveGuidance(
    _ route: RNMBXNavigationRoute,
    simulate: Bool,
    resolve: @escaping () -> Void,
    reject: @escaping (String, String) -> Void
  ) {
    Task { @MainActor in
      do {
        let session = RNMBXNavigationSession.shared
        let navigation = try session.mapboxNavigation()
        session.setLocationSource(simulate ? .simulation(initialLocation: nil) : .live)
        self.progressSubscription = session.$routeProgress
          .compactMap { $0 }
          .sink { [weak self] progress in
            self?.onRouteProgress?(Self.progressEvent(progress))
          }
        self.guidanceRoute = route
        navigation.tripSession().startActiveGuidance(with: route.routes, startLegIndex: 0)
        session.cameraState = .following
        resolve()
      } catch {
        reject("start_failed", error.localizedDescription)
      }
    }
  }

  /// Shows `route` on navigation maps until guidance starts or stops; `nil` removes it.
  @objc public func previewRoute(_ route: RNMBXNavigationRoute?) {
    Task { @MainActor in
      RNMBXNavigationSession.shared.previewRoutes = route?.routes
    }
  }

  @objc public func stopNavigation() {
    Task { @MainActor in
      self.stopNavigationOnMain()
    }
  }

  @objc public func setCameraState(_ state: String) {
    Task { @MainActor in
      let session = RNMBXNavigationSession.shared
      switch state {
      case "following": session.cameraState = .following
      case "overview": session.cameraState = .overview
      default: session.cameraState = .idle
      }
    }
  }

  @objc public func cameraState() -> String {
    cameraStateLock.withLock { _cameraState }
  }

  private static func name(_ state: NavigationCameraState) -> String {
    switch state {
    case .following: "following"
    case .overview: "overview"
    case .idle: "idle"
    }
  }

  @MainActor private func stopNavigationOnMain() {
    progressSubscription = nil
    guidanceRoute = nil
    RNMBXNavigationSession.shared.stop()
  }

  private static func progressEvent(_ progress: RouteProgress) -> [String: Any] {
    let stepProgress = progress.currentLegProgress.currentStepProgress
    let banner = stepProgress.currentVisualInstruction?.primaryInstruction
    let upcomingStep = progress.currentLegProgress.upcomingStep
    return [
      "distanceRemaining": progress.distanceRemaining,
      "distanceTraveled": progress.distanceTraveled,
      "durationRemaining": progress.durationRemaining,
      "fractionTraveled": progress.fractionTraveled,
      "stepDistanceRemaining": stepProgress.distanceRemaining,
      "maneuverInstruction": banner?.text ?? upcomingStep?.instructions ?? progress.currentLegProgress.currentStep.instructions,
      "maneuverType": banner?.maneuverType?.rawValue ?? upcomingStep?.maneuverType.rawValue ?? "",
      "maneuverModifier": banner?.maneuverDirection?.rawValue ?? upcomingStep?.maneuverDirection?.rawValue ?? "",
    ]
  }
}
