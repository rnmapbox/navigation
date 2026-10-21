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

  @objc public static func register() {
    RNMBXMapViewFactory.register(mapViewImpl, factory: { _, parent in
      MainActor.assumeIsolated { makeMapView(in: parent) }
    })
  }

  @MainActor private static func makeMapView(in parent: RNMBXMapView) -> MapView {
    let session = RNMBXNavigationSession.shared
    let navigationMapView = RNMBXNavigationMapView(
      location: session.$location.compactMap { $0 }.eraseToAnyPublisher(),
      routeProgress: session.$routeProgress.eraseToAnyPublisher()
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

  /// The SDK adds the safe area to `viewportPadding`; `<NavigationViewport>` padding already accounts for it.
  override var safeAreaInsets: UIEdgeInsets {
    customViewportPadding == nil ? super.safeAreaInsets : .zero
  }

  static func adopting(_ mapView: MapView) -> RNMBXNavigationMapView? {
    mapView.superview as? RNMBXNavigationMapView
  }
}

/// Mirrors the shared session (preview routes, camera state, stop) onto one `NavigationMapView`.
/// Active-guidance routes and the puck come straight from the publishers passed to `NavigationMapView`.
@MainActor
private final class RNMBXNavigationMapBinding: NSObject {
  private var subscriptions = Set<AnyCancellable>()
  private let session: RNMBXNavigationSession

  init(_ navigationMapView: NavigationMapView, session: RNMBXNavigationSession) {
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
        navigationMapView?.puckType = hasLocation ? .puck3D(.navigationDefault) : nil
      }
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
