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
import androidx.car.app.navigation.model.NavigationTemplate
import androidx.car.app.validation.HostValidator
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner

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
  override fun onCreateScreen(intent: Intent): Screen = RNMBXNavigationCarScreen(carContext)
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
        carMapSurface.surfaceDestroyed()
      }
    })
  }

  override fun onGetTemplate(): Template =
    NavigationTemplate.Builder()
      .setActionStrip(ActionStrip.Builder().addAction(Action.APP_ICON).build())
      .build()
}
