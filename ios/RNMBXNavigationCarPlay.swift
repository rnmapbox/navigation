import CarPlay
import Combine
import MapboxMaps
import MapboxNavigationCore
// Some CarPlayManagerDelegate requirements have their default implementations only in this SPI.
@_spi(MapboxCarPlayInternal) import MapboxNavigationUIKit

/// `UISceneDelegateClassName` of the CarPlay scene in Info.plist, set by the Expo config plugin's `carPlay` option.
@objc(RNMBXNavigationCarPlaySceneDelegate)
final class RNMBXNavigationCarPlaySceneDelegate: NSObject, CPTemplateApplicationSceneDelegate {
  func templateApplicationScene(
    _ templateApplicationScene: CPTemplateApplicationScene,
    didConnect interfaceController: CPInterfaceController,
    to window: CPWindow
  ) {
    RNMBXNavigationCarPlay.shared.connect(templateApplicationScene, interfaceController, window)
  }

  func templateApplicationScene(
    _ templateApplicationScene: CPTemplateApplicationScene,
    didDisconnect interfaceController: CPInterfaceController,
    from window: CPWindow
  ) {
    RNMBXNavigationCarPlay.shared.disconnect(templateApplicationScene, interfaceController, window)
  }
}

/// Shows the shared navigation session on CarPlay: the map while idle, turn-by-turn guidance while the phone guides.
@MainActor
final class RNMBXNavigationCarPlay: NSObject {
  static let shared = RNMBXNavigationCarPlay()

  @Published private(set) var connected = false
  /// The map the car screen shows; its id changes with every switch so `<CarMap>` re-adds its children.
  @Published private(set) var carMap = CarMap(id: 0, activity: "browsing")

  struct CarMap {
    let id: Int32
    let activity: String
    weak var mapView: MapView?
  }

  private var nextCarMapId: Int32 = 1
  private weak var browsingMapView: MapView?

  private var manager: CarPlayManager?
  /// Created on the first connect and kept across reconnects, so there is only ever one `<CarMap>` root.
  private var reactRootView: UIView?
  private var subscriptions = Set<AnyCancellable>()

  /// `beginNavigationWithCarPlay` runs asynchronously and ends in `startActiveGuidance` from leg 0.
  private struct PendingGuidance {
    var legIndex: Int
    var cancelled = false
  }

  private var pendingGuidance: PendingGuidance?

  func connect(_ scene: CPTemplateApplicationScene, _ interfaceController: CPInterfaceController, _ window: CPWindow) {
    connected = true
    let session = RNMBXNavigationSession.shared
    // CarPlay can launch the app without its phone UI, so the Info.plist token shows the map before JS sets one, if ever.
    if session.accessToken == nil {
      session.accessToken = MapboxOptions.accessToken
    }
    _ = try? session.mapboxNavigation()
    session.$provider
      .compactMap { $0 }
      .first()
      // `@Published` emits before the property is set; start once the session's own setup has finished.
      .receive(on: DispatchQueue.main)
      .sink { [weak self] provider in
        self?.start(provider, scene, interfaceController, window)
      }
      .store(in: &subscriptions)

    if reactRootView == nil, let rootView = RNMBXNavigationCarPlayRoot.makeRootView() {
      rootView.frame = .zero
      rootView.isUserInteractionEnabled = false
      reactRootView = rootView
    }
    if let reactRootView {
      window.insertSubview(reactRootView, at: 0)
    }
  }

  func disconnect(_ scene: CPTemplateApplicationScene, _ interfaceController: CPInterfaceController, _ window: CPWindow) {
    subscriptions.removeAll()
    pendingGuidance = nil
    reactRootView?.removeFromSuperview()
    manager?.templateApplicationScene(scene, didDisconnect: interfaceController, from: window)
    manager = nil
    browsingMapView = nil
    carMap = CarMap(id: 0, activity: "browsing")
    connected = false
  }

  private func start(
    _ provider: MapboxNavigationProvider,
    _ scene: CPTemplateApplicationScene,
    _ interfaceController: CPInterfaceController,
    _ window: CPWindow
  ) {
    let manager = CarPlayManager(navigationProvider: provider)
    manager.delegate = self
    self.manager = manager
    manager.templateApplicationScene(scene, didConnect: interfaceController, to: window)

    provider.mapboxNavigation.tripSession().session
      .map { session in
        if case .activeGuidance = session.state { return true }
        return false
      }
      .removeDuplicates()
      .receive(on: DispatchQueue.main)
      .sink { [weak self] guiding in self?.followGuidance(guiding) }
      .store(in: &subscriptions)
  }

  /// For the `rnmbxnavcar:<id>` map view factory; nil once the car screen has moved on to another map.
  func mapView(forCarMapId id: Int32) -> MapView? {
    carMap.id == id ? carMap.mapView : nil
  }

  private func show(_ mapView: MapView?, activity: String) {
    guard let mapView else { return }
    carMap = CarMap(id: nextCarMapId, activity: activity, mapView: mapView)
    nextCarMapId += 1
  }

  private func followGuidance(_ guiding: Bool) {
    guard let manager else { return }
    if guiding {
      guard manager.carPlayNavigationViewController == nil, pendingGuidance == nil else { return }
      let session = RNMBXNavigationSession.shared
      pendingGuidance = PendingGuidance(legIndex: session.routeProgress?.legIndex ?? 0)
      manager.beginNavigationWithCarPlay(using: session.location?.coordinate ?? kCLLocationCoordinate2DInvalid)
    } else if let navigationViewController = manager.carPlayNavigationViewController {
      navigationViewController.exitNavigation(byCanceling: true)
    } else {
      pendingGuidance?.cancelled = true
    }
  }

  /// The view controller has just restarted guidance from leg 0; put the phone's trip back as it was.
  private func takeOverGuidance() {
    guard let pending = pendingGuidance, !pending.cancelled, pending.legIndex > 0,
          let tripSession = RNMBXNavigationSession.shared.provider?.mapboxNavigation.tripSession(),
          let routes = tripSession.currentNavigationRoutes
    else { return }
    tripSession.startActiveGuidance(with: routes, startLegIndex: pending.legIndex)
  }
}

extension RNMBXNavigationCarPlay: CarPlayManagerDelegate {
  nonisolated func carPlayManager(_ carPlayManager: CarPlayManager, didSetup navigationMapView: NavigationMapView) {
    MainActor.assumeIsolated {
      browsingMapView = navigationMapView.mapView
      show(navigationMapView.mapView, activity: "browsing")
    }
  }

  nonisolated func carPlayManager(
    _ carPlayManager: CarPlayManager,
    willPresent navigationViewController: CarPlayNavigationViewController
  ) {
    MainActor.assumeIsolated {
      takeOverGuidance()
      show(navigationViewController.navigationMapView?.mapView, activity: "navigating")
    }
  }

  nonisolated func carPlayManager(
    _ carPlayManager: CarPlayManager,
    didPresent navigationViewController: CarPlayNavigationViewController
  ) {
    MainActor.assumeIsolated {
      let cancelled = pendingGuidance?.cancelled ?? false
      pendingGuidance = nil
      // The phone stopped while CarPlay was still starting; ending here stops the guidance CarPlay restarted.
      if cancelled {
        navigationViewController.exitNavigation(byCanceling: true)
      }
    }
  }

  nonisolated func carPlayManagerDidEndNavigation(_ carPlayManager: CarPlayManager, byCanceling canceled: Bool) {
    MainActor.assumeIsolated {
      show(browsingMapView, activity: "browsing")
      // Ending the trip on the car ends it on the phone too; it already has if the phone stopped it.
      if case .activeGuidance = RNMBXNavigationSession.shared.provider?.mapboxNavigation.tripSession().currentSession.state {
        RNMBXNavigationSession.shared.stop()
      }
    }
  }
}
