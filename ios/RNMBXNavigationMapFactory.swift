import Combine
import MapboxMaps
import MapboxNavigationCore
import ObjectiveC
import UIKit
import rnmapbox_maps

/// Lets `<MapView mapViewImpl="rnmbxnav">` from `@rnmapbox/maps` render navigation.
///
/// The factory wraps the map in a `NavigationMapView` and hands its inner `MapView` to rnmapbox, so rnmapbox's
/// props, children and events keep working while the Navigation SDK draws the route line and puck and drives the camera.
@objc(RNMBXNavigationMapFactory)
public final class RNMBXNavigationMapFactory: NSObject {
  /// Keep in sync with `NAVIGATION_MAP_VIEW_IMPL` in src/index.ts.
  @objc public static let mapViewImpl = "rnmbxnav"

  /// Keep in sync with `CAR_MAP_VIEW_IMPL` in src/CarMap.tsx.
  @objc public static let carMapViewImpl = "rnmbxnavcar"

  @objc public static func register() {
    RNMBXMapViewFactory.register(mapViewImpl, factory: { _, parent in
      MainActor.assumeIsolated { makeMapView(in: parent) }
    })
    RNMBXMapViewFactory.register(carMapViewImpl, factory: { impl, parent in
      MainActor.assumeIsolated { carMapView(impl, for: parent) }
    })
  }

  /// `impl` is `rnmbxnavcar:<id>`; the car screen's map stays where it is and `parent` only adds its children.
  @MainActor private static func carMapView(_ impl: String, for parent: RNMBXMapView) -> MapView? {
    guard let id = impl.split(separator: ":").last.flatMap({ Int32($0) }),
          let mapView = RNMBXNavigationCarPlay.shared.mapView(forCarMapId: id)
    else { return nil }
    parent.ownsMapView = false
    return mapView
  }

  @MainActor private static func makeMapView(in parent: RNMBXMapView) -> MapView {
    let session = RNMBXNavigationSession.shared
    let navigationMapView = RNMBXNavigationMapView(
      location: session.$location.compactMap { $0 }.eraseToAnyPublisher(),
      // Starting free drive publishes a nil progress again, which would remove a preview route.
      routeProgress: session.$routeProgress.removeDuplicates { $0 == nil && $1 == nil }.eraseToAnyPublisher()
    )
    navigationMapView.frame = parent.bounds
    navigationMapView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    parent.addSubview(navigationMapView)

    let binding = RNMBXNavigationMapBinding(navigationMapView, session: session)
    parent.addCameraDelegate(binding)
    objc_setAssociatedObject(navigationMapView, &bindingKey, binding, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
    return navigationMapView.mapView
  }
}

private var bindingKey: UInt8 = 0

/// `NavigationMapView` whose viewport padding can be set relative to the map's edges.
final class RNMBXNavigationMapView: NavigationMapView {
  /// Replaces the SDK default (safe area plus `viewportPadding`) when set; see `<NavigationViewport>`.
  var customViewportPadding: UIEdgeInsets? {
    didSet {
      if oldValue == nil {
        sdkViewportPadding = viewportPadding
      }
      viewportPadding = customViewportPadding ?? sdkViewportPadding
    }
  }

  private var sdkViewportPadding: UIEdgeInsets = .zero

  /// Set by `<NavigationViewport routeLineStyle>`; nil colors keep the SDK's.
  var customRouteLineStyle = RNMBXRouteLineStyle() {
    didSet {
      guard customRouteLineStyle != oldValue else { return }
      applyRouteLineStyle()
      redrawRoutes()
    }
  }

  private lazy var sdkRouteLineColors = (
    congestion: congestionConfiguration,
    casing: routeCasingColor,
    traversed: traversedRouteColor
  )

  private func applyRouteLineStyle() {
    let sdk = sdkRouteLineColors
    congestionConfiguration = sdk.congestion
    if let color = customRouteLineStyle.color {
      routeColor = color
    }
    if let color = customRouteLineStyle.alternativeColor {
      routeAlternateColor = color
    }
    routeCasingColor = customRouteLineStyle.casingColor ?? sdk.casing
    traversedRouteColor = customRouteLineStyle.traveledColor ?? sdk.traversed
  }

  /// The SDK only reads route line colors when it shows routes.
  private func redrawRoutes() {
    let session = RNMBXNavigationSession.shared
    if let progress = session.routeProgress {
      show(
        progress.navigationRoutes,
        routeAnnotationKinds: showsRelativeDurationsOnAlternativeManuever ? [.relativeDurationsOnAlternativeManuever] : []
      )
    } else if let routes = session.previewRoutes {
      show(routes, routeAnnotationKinds: [])
    }
  }

  /// `NavigationViewController`'s styles set route line colors through `NavigationMapView.appearance()`, which UIKit
  /// applies to every navigation map when it enters a window.
  override func didMoveToWindow() {
    super.didMoveToWindow()
    if customRouteLineStyle != RNMBXRouteLineStyle() {
      applyRouteLineStyle()
    }
  }

  /// Set by `<NavigationViewport puck>`; nil shows the SDK's puck.
  var customPuck: NSDictionary? {
    didSet {
      guard customPuck != oldValue else { return }
      applyPuck()
    }
  }

  var hasLocation = false {
    didSet { applyPuck() }
  }

  private var puckImagePending = false

  /// `<Images>` can add the puck's image to the style after the puck is set.
  func applyPendingPuckImage() {
    if puckImagePending {
      applyPuck()
    }
  }

  private func applyPuck() {
    let puck = RNMBXPuck(customPuck)
    puckImagePending = false
    guard hasLocation, puck.visible else {
      puckType = nil
      return
    }
    if let model = puck.model {
      puckType = .puck3D(model)
      return
    }
    if let name = puck.bearingImage {
      if let image = mapView.mapboxMap.image(withId: name) {
        var configuration = Puck2DConfiguration.navigationDefault
        configuration.bearingImage = image
        configuration.scale = puck.scale
        puckType = .puck2D(configuration)
        return
      }
      puckImagePending = true
    }
    puckType = .puck3D(.navigationDefault)
  }

  /// The SDK adds the safe area to `viewportPadding`; `<NavigationViewport>` padding already accounts for it.
  override var safeAreaInsets: UIEdgeInsets {
    customViewportPadding == nil ? super.safeAreaInsets : .zero
  }

  static func adopting(_ mapView: MapView) -> RNMBXNavigationMapView? {
    mapView.superview as? RNMBXNavigationMapView
  }
}

struct RNMBXRouteLineStyle: Equatable {
  var color: UIColor?
  var casingColor: UIColor?
  var alternativeColor: UIColor?
  var traveledColor: UIColor?
}

/// `NavigationPuck` from `<NavigationViewport puck>`.
struct RNMBXPuck {
  var visible = true
  var bearingImage: String?
  var scale: Value<Double>?
  var model: Puck3DConfiguration?

  init(_ puck: NSDictionary?) {
    guard let puck else { return }
    visible = puck["visible"] as? Bool ?? true
    bearingImage = puck["bearingImage"] as? String
    scale = Self.value(puck["scale"])
    if let model = puck["model"] as? NSDictionary {
      if let uri = model["uri"] as? String, let url = URL(string: uri) {
        var configuration = Puck3DConfiguration.navigationDefault
        configuration.model = Model(id: url.absoluteString, uri: url)
        configuration.modelScale = Self.value(model["scale"])
        configuration.modelRotation = Self.value(model["rotation"])
        configuration.modelOpacity = Self.value(model["opacity"]) ?? .constant(1)
        self.model = configuration
      } else {
        Logger.error("NavigationViewport puck.model.uri is not a valid URL: \(String(describing: model["uri"]))")
      }
    }
  }

  /// A number, an array of numbers or an expression.
  private static func value<T: Codable>(_ value: Any?) -> Value<T>? {
    guard let value,
          let data = try? JSONSerialization.data(withJSONObject: value, options: .fragmentsAllowed)
    else { return nil }
    return try? JSONDecoder().decode(Value<T>.self, from: data)
  }
}

/// Mirrors the shared session (preview routes, camera state, stop) onto one `NavigationMapView`.
/// Active-guidance routes and the puck come straight from the publishers passed to `NavigationMapView`.
@MainActor
private final class RNMBXNavigationMapBinding: NSObject {
  private var subscriptions = Set<AnyCancellable>()
  private let session: RNMBXNavigationSession

  init(_ navigationMapView: RNMBXNavigationMapView, session: RNMBXNavigationSession) {
    self.session = session
    super.init()

    session.$previewRoutes
      .sink { [weak navigationMapView] routes in
        guard let navigationMapView, session.routeProgress == nil else { return }
        if let routes {
          navigationMapView.showcase(routes, routeAnnotationKinds: [], animated: true)
        } else {
          navigationMapView.removeRoutes()
        }
      }
      .store(in: &subscriptions)

    session.$cameraState
      .removeDuplicates()
      .sink { [weak navigationMapView] state in
        if state == .idle {
          navigationMapView?.navigationCamera.stop()
        } else {
          navigationMapView?.update(navigationCameraState: state)
        }
      }
      .store(in: &subscriptions)

    session.$location
      .map { $0 != nil }
      .removeDuplicates()
      .sink { [weak navigationMapView] hasLocation in
        navigationMapView?.hasLocation = hasLocation
      }
      .store(in: &subscriptions)

    session.$location
      .sink { [weak navigationMapView] _ in navigationMapView?.applyPendingPuckImage() }
      .store(in: &subscriptions)

    session.stopped
      .sink { [weak navigationMapView] in
        guard let mapView = navigationMapView?.mapView else { return }
        mapView.camera.ease(to: CameraOptions(padding: .zero, bearing: 0, pitch: 0), duration: 0.5)
      }
      .store(in: &subscriptions)

    navigationMapView.delegate = self
  }
}

extension RNMBXNavigationMapBinding: NavigationMapViewDelegate {
  func navigationMapViewUserDidStartInteraction(_ navigationMapView: NavigationMapView) {
    session.cameraState = .idle
  }

  func navigationMapView(_ navigationMapView: NavigationMapView, didSelect alternativeRoute: AlternativeRoute) {
    session.provider?.mapboxNavigation.navigation().selectAlternativeRoute(with: alternativeRoute.routeId)
  }
}

extension RNMBXNavigationMapBinding: RNMBXCameraDelegate {
  func cameraWillMoveMap(_ map: RNMBXMapView) {
    session.cameraState = .idle
  }
}
