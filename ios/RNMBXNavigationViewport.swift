import MapboxMaps
import UIKit
import rnmapbox_maps

/// Native side of `<NavigationViewport>`: applies its settings to the navigation map it's a child of.
@objc(RNMBXNavigationViewport)
public final class RNMBXNavigationViewport: UIView, RNMBXMapAndMapViewComponent {
  @objc public var viewportPadding: UIEdgeInsets = .zero {
    didSet { navigationMapView?.customViewportPadding = viewportPadding }
  }

  private weak var navigationMapView: RNMBXNavigationMapView?

  public func addToMap(_ map: RNMBXMapView, mapView: MapView, style: Style) {
    guard let navigationMapView = RNMBXNavigationMapView.adopting(mapView) else {
      Logger.error("NavigationViewport must be a child of <MapView mapViewImpl=\"rnmbxnav\">")
      return
    }
    self.navigationMapView = navigationMapView
    navigationMapView.customViewportPadding = viewportPadding
  }

  public func removeFromMap(_ map: RNMBXMapView, mapView: MapView, reason: RemovalReason) -> Bool {
    if reason != .StyleChange {
      navigationMapView?.customViewportPadding = nil
      navigationMapView = nil
    }
    return true
  }
}
