import Combine
import CoreLocation
import Foundation
import MapboxDirections
import MapboxNavigationCore

@objc(RNMBXNavigation)
public final class RNMBXNavigation: NSObject {
  @objc public var onRouteProgress: (([String: Any]) -> Void)?
  @objc public var onCameraStateChange: (([String: Any]) -> Void)?
  @objc public var onLocationChange: (([String: Any]) -> Void)?
  @objc public var onArrive: (([String: Any]) -> Void)?
  @objc public var onOffRouteChange: (([String: Any]) -> Void)?
  @objc public var onVoiceInstruction: (([String: Any]) -> Void)?
  @objc public var onRouteChange: ((RNMBXNavigationRoute, String) -> Void)?
  @objc public var onCarPlayConnectionChange: (([String: Any]) -> Void)?
  @objc public var onCarMapChange: (([String: Any]) -> Void)?

  @MainActor private var subscriptions = Set<AnyCancellable>()

  /// `getCameraState` and `isVoiceMuted` are synchronous and run on the JS thread; the session lives on the main thread.
  private let stateLock = NSLock()
  private var _cameraState = "idle"
  private var _voiceMuted = false
  private var _carPlayConnected = false
  private var _carMap: [String: Any] = ["id": 0, "activity": "browsing"]

  override public init() {
    super.init()
    Task { @MainActor in
      let session = RNMBXNavigationSession.shared
      session.$cameraState
        .map(Self.name)
        .removeDuplicates()
        .sink { [weak self] state in
          guard let self else { return }
          self.stateLock.withLock { self._cameraState = state }
          self.onCameraStateChange?(["state": state])
        }
        .store(in: &self.subscriptions)
      session.$routeProgress
        .compactMap { $0 }
        .sink { [weak self] progress in
          self?.onRouteProgress?(Self.progressEvent(progress))
        }
        .store(in: &self.subscriptions)
      session.mapMatching
        .sink { [weak self] state in
          self?.onLocationChange?(Self.locationEvent(state))
        }
        .store(in: &self.subscriptions)
      session.arrivals
        .sink { [weak self] arrival in
          self?.onArrive?(["waypointIndex": arrival.waypointIndex, "isFinalDestination": arrival.isFinalDestination])
        }
        .store(in: &self.subscriptions)
      session.$offRoute
        .removeDuplicates()
        .dropFirst()
        .sink { [weak self] in self?.onOffRouteChange?(["offRoute": $0]) }
        .store(in: &self.subscriptions)
      session.voiceInstructions
        .sink { [weak self] instruction in
          self?.onVoiceInstruction?([
            "text": instruction.text,
            "ssml": instruction.ssmlText,
            "distanceAlongStep": instruction.distanceAlongStep,
          ])
        }
        .store(in: &self.subscriptions)
      session.routeChanges
        .sink { [weak self] routes, reason in
          self?.onRouteChange?(RNMBXNavigationRoute(routes), reason)
        }
        .store(in: &self.subscriptions)
      RNMBXNavigationCarPlay.shared.$connected
        .removeDuplicates()
        .sink { [weak self] connected in
          guard let self else { return }
          self.stateLock.withLock { self._carPlayConnected = connected }
          self.onCarPlayConnectionChange?(["connected": connected])
        }
        .store(in: &self.subscriptions)
      RNMBXNavigationCarPlay.shared.$carMap
        .removeDuplicates { $0.id == $1.id }
        .sink { [weak self] carMap in
          guard let self else { return }
          let event: [String: Any] = ["id": carMap.id, "activity": carMap.activity]
          self.stateLock.withLock { self._carMap = event }
          self.onCarMapChange?(event)
        }
        .store(in: &self.subscriptions)
    }
  }

  @objc public static func sdkVersion() -> String {
    Bundle.mapboxNavigationVersion
  }

  @objc public static func defaultDistanceUnit() -> String {
    if #available(iOS 16, *) {
      return Locale.current.measurementSystem == .metric ? "metric" : "imperial"
    }
    return Locale.current.usesMetricSystem ? "metric" : "imperial"
  }

  @objc public func setAccessToken(_ accessToken: String) {
    Task { @MainActor in
      RNMBXNavigationSession.shared.accessToken = accessToken
      if RNMBXNavigationCarPlay.shared.connected {
        _ = try? RNMBXNavigationSession.shared.mapboxNavigation()
      }
    }
  }

  @objc public func invalidate() {
    Task { @MainActor in
      self.subscriptions.removeAll()
      RNMBXNavigationSession.shared.stop()
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

  @objc public func startActiveGuidance(
    _ route: RNMBXNavigationRoute,
    simulate: Bool,
    resolve: @escaping () -> Void,
    reject: @escaping (String, String) -> Void
  ) {
    Task { @MainActor in
      do {
        let session = RNMBXNavigationSession.shared
        guard let navigation = try await session.prepareActiveGuidance(route, simulate: simulate) else {
          resolve()
          return
        }
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
      RNMBXNavigationSession.shared.stop()
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
    stateLock.withLock { _cameraState }
  }

  @objc public func setVoiceMuted(_ muted: Bool) {
    stateLock.withLock { _voiceMuted = muted }
    Task { @MainActor in
      RNMBXNavigationSession.shared.voiceMuted = muted
    }
  }

  @objc public func isVoiceMuted() -> Bool {
    stateLock.withLock { _voiceMuted }
  }

  @objc public func carMap() -> [String: Any] {
    stateLock.withLock { _carMap }
  }

  @objc public func isCarPlayConnected() -> Bool {
    stateLock.withLock { _carPlayConnected }
  }

  private static func name(_ state: NavigationCameraState) -> String {
    switch state {
    case .following: "following"
    case .overview: "overview"
    case .idle: "idle"
    }
  }

  static func progressEvent(_ progress: RouteProgress) -> [String: Any] {
    let stepProgress = progress.currentLegProgress.currentStepProgress
    let visualInstruction = stepProgress.currentVisualInstruction
    let banner = visualInstruction?.primaryInstruction
    let upcomingStep = progress.currentLegProgress.upcomingStep
    let sub = visualInstruction?.tertiaryInstruction
    let lanes: [[String: Any]] = sub?.components.compactMap { component in
      guard case let .lane(indications, isUsable, preferredDirection) = component else { return nil }
      return [
        "indications": indications.descriptions,
        "valid": isUsable,
        "activeDirection": isUsable ? preferredDirection?.rawValue ?? "" : "",
      ]
    } ?? []
    return [
      "maneuverComponents": bannerComponents(banner),
      "secondaryComponents": bannerComponents(visualInstruction?.secondaryInstruction),
      "secondaryInstruction": visualInstruction?.secondaryInstruction?.text ?? "",
      "subInstruction": lanes.isEmpty ? sub?.text ?? "" : "",
      "lanes": lanes,
      "legIndex": progress.legIndex,
      "stepIndex": progress.currentLegProgress.stepIndex,
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

  private static func bannerComponents(_ instruction: VisualInstruction?) -> [[String: Any]] {
    instruction?.components.compactMap { component -> [String: Any]? in
      switch component {
      case let .text(text):
        ["type": "text", "text": text.text, "imageUrl": ""]
      case let .delimiter(text):
        ["type": "delimiter", "text": text.text, "imageUrl": ""]
      case let .exit(text):
        ["type": "exit", "text": text.text, "imageUrl": ""]
      case let .exitCode(text):
        ["type": "exit-number", "text": text.text, "imageUrl": ""]
      case let .image(image, alternativeText):
        [
          "type": "icon",
          "text": alternativeText.text,
          "imageUrl": image.imageURL(scale: 3, format: .png)?.absoluteString ?? "",
        ]
      case .lane, .guidanceView:
        nil
      }
    } ?? []
  }

  static func locationEvent(_ state: MapMatchingState) -> [String: Any] {
    let location = state.enhancedLocation
    var event: [String: Any] = [
      "latitude": location.coordinate.latitude,
      "longitude": location.coordinate.longitude,
      "speed": location.speed,
      "course": location.course,
      "roadName": state.roadName?.text ?? "",
    ]
    if let limit = state.speedLimit.value {
      let unit: UnitSpeed = limit.unit == .milesPerHour ? .milesPerHour : .kilometersPerHour
      event["speedLimit"] = [
        "speed": limit.converted(to: unit).value.rounded(),
        "unit": unit == .milesPerHour ? "mph" : "km/h",
        "sign": state.speedLimit.signStandard == .mutcd ? "mutcd" : "vienna",
      ]
    }
    return event
  }
}
