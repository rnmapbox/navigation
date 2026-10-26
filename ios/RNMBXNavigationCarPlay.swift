import CarPlay
import Combine
import MapboxNavigationCore
// Some CarPlayManagerDelegate requirements have their default implementations only in this SPI.
@_spi(MapboxInternal) import MapboxNavigationUIKit

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

  private var manager: CarPlayManager?
  private var subscriptions = Set<AnyCancellable>()

  func connect(_ scene: CPTemplateApplicationScene, _ interfaceController: CPInterfaceController, _ window: CPWindow) {
    connected = true
    // The provider exists once JS has set the access token, which can be after the car connects.
    RNMBXNavigationSession.shared.$provider
      .compactMap { $0 }
      .first()
      .sink { [weak self] provider in
        self?.start(provider, scene, interfaceController, window)
      }
      .store(in: &subscriptions)
  }

  func disconnect(_ scene: CPTemplateApplicationScene, _ interfaceController: CPInterfaceController, _ window: CPWindow) {
    subscriptions.removeAll()
    manager?.templateApplicationScene(scene, didDisconnect: interfaceController, from: window)
    manager = nil
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

  private func followGuidance(_ guiding: Bool) {
    guard let manager else { return }
    if guiding, manager.carPlayNavigationViewController == nil {
      let location = RNMBXNavigationSession.shared.location?.coordinate ?? kCLLocationCoordinate2DInvalid
      manager.beginNavigationWithCarPlay(using: location)
    } else if !guiding, let navigationViewController = manager.carPlayNavigationViewController {
      navigationViewController.exitNavigation(byCanceling: true)
    }
  }
}

extension RNMBXNavigationCarPlay: CarPlayManagerDelegate {
  nonisolated func carPlayManagerDidEndNavigation(_ carPlayManager: CarPlayManager, byCanceling canceled: Bool) {
    MainActor.assumeIsolated {
      // Ending the trip on the car ends it on the phone too; it already has if the phone stopped it.
      if case .activeGuidance = RNMBXNavigationSession.shared.provider?.mapboxNavigation.tripSession().currentSession.state {
        RNMBXNavigationSession.shared.stop()
      }
    }
  }
}
