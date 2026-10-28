package com.rnmapbox.rnmbxnav

import android.content.Intent
import android.content.pm.ApplicationInfo
import androidx.car.app.AppManager
import androidx.car.app.CarAppService
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.Session
import androidx.car.app.SurfaceCallback
import androidx.car.app.SurfaceContainer
import androidx.car.app.model.Action
import androidx.car.app.model.ActionStrip
import androidx.car.app.model.Template
import androidx.car.app.navigation.NavigationManager
import androidx.car.app.navigation.NavigationManagerCallback
import androidx.car.app.navigation.model.NavigationTemplate
import androidx.car.app.validation.HostValidator
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import com.mapbox.common.location.Location
import com.mapbox.navigation.base.route.NavigationRoute
import com.mapbox.navigation.base.trip.model.RouteProgress

/**
 * Android Auto entry point, declared by the Expo config plugin's `androidAuto` option: shows the navigation map,
 * which `<CarMap>` adds to, under a `NavigationTemplate`.
 */
class RNMBXNavigationCarAppService : CarAppService() {
  override fun createHostValidator(): HostValidator =
    if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) {
      HostValidator.ALLOW_ALL_HOSTS_VALIDATOR
    } else {
      HostValidator.Builder(applicationContext)
        .addAllowedHosts(androidx.car.app.R.array.hosts_allowlist_sample)
        .build()
    }

  override fun onCreateSession(): Session = RNMBXNavigationCarSession()
}

class RNMBXNavigationCarSession : Session() {
  init {
    lifecycle.addObserver(object : DefaultLifecycleObserver {
      private lateinit var navigationGuidance: RNMBXNavigationCarGuidance

      override fun onCreate(owner: LifecycleOwner) {
        navigationGuidance = RNMBXNavigationCarGuidance(carContext.getCarService(NavigationManager::class.java))
      }

      override fun onDestroy(owner: LifecycleOwner) {
        navigationGuidance.close()
      }
    })
  }

  override fun onCreateScreen(intent: Intent): Screen = RNMBXNavigationCarScreen(carContext)
}

/** Tells the car host when the shared navigation session guides, and lets it stop guidance. */
private class RNMBXNavigationCarGuidance(
  private val navigationManager: NavigationManager
) : RNMBXNavigationSession.Listener, NavigationManagerCallback {
  private var navigating = false

  init {
    // The host requires the callback before navigationStarted.
    navigationManager.setNavigationManagerCallback(this)
    RNMBXNavigationSession.addListener(this)
  }

  fun close() {
    RNMBXNavigationSession.removeListener(this)
    RNMBXNavigationSession.autoDrive = false
    setNavigating(false)
    navigationManager.clearNavigationManagerCallback()
  }

  private fun setNavigating(navigating: Boolean) {
    if (navigating == this.navigating) return
    this.navigating = navigating
    if (navigating) navigationManager.navigationStarted() else navigationManager.navigationEnded()
  }

  override fun onRoutes(routes: List<NavigationRoute>, preview: Boolean) {
    if (routes.isNotEmpty() && !preview) setNavigating(true)
  }

  override fun onStopped() = setNavigating(false)

  override fun onStopNavigation() {
    navigating = false
    RNMBXNavigationSession.stopNavigation()
  }

  override fun onAutoDriveEnabled() {
    RNMBXNavigationSession.autoDrive = true
  }

  override fun onLocation(location: Location, keyPoints: List<Location>) = Unit
  override fun onRouteProgress(progress: RouteProgress) = Unit
  override fun onCameraState(state: RNMBXNavigationCameraState) = Unit
}

class RNMBXNavigationCarScreen(carContext: CarContext) : Screen(carContext) {
  private val carMapSurface = RNMBXNavigationCarMapSurface(carContext)

  private val surfaceCallback = object : SurfaceCallback {
    override fun onSurfaceAvailable(surfaceContainer: SurfaceContainer) {
      val surface = surfaceContainer.surface ?: return
      carMapSurface.surfaceAvailable(surface, surfaceContainer.width, surfaceContainer.height, surfaceContainer.dpi)
    }

    override fun onSurfaceDestroyed(surfaceContainer: SurfaceContainer) {
      carMapSurface.surfaceDestroyed()
    }

    override fun onScroll(distanceX: Float, distanceY: Float) {
      carMapSurface.scrollBy(distanceX, distanceY)
    }

    override fun onScale(focusX: Float, focusY: Float, scaleFactor: Float) {
      carMapSurface.scaleBy(scaleFactor)
    }
  }

  init {
    lifecycle.addObserver(object : DefaultLifecycleObserver {
      override fun onCreate(owner: LifecycleOwner) {
        carContext.getCarService(AppManager::class.java).setSurfaceCallback(surfaceCallback)
      }

      override fun onDestroy(owner: LifecycleOwner) {
        carContext.getCarService(AppManager::class.java).setSurfaceCallback(null)
        carMapSurface.surfaceDestroyed()
      }
    })
  }

  override fun onGetTemplate(): Template =
    NavigationTemplate.Builder()
      .setActionStrip(ActionStrip.Builder().addAction(Action.APP_ICON).build())
      .build()
}
