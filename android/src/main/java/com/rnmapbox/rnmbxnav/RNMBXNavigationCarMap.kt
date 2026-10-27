package com.rnmapbox.rnmbxnav

import android.content.Context
import android.view.Surface
import com.mapbox.common.location.Location
import com.mapbox.geojson.Point
import com.mapbox.maps.CameraOptions
import com.mapbox.maps.MapInitOptions
import com.mapbox.maps.MapSurface
import com.mapbox.maps.Style
import com.mapbox.maps.plugin.PuckBearing
import com.mapbox.maps.plugin.animation.MapAnimationOptions
import com.mapbox.maps.plugin.animation.easeTo
import com.mapbox.maps.plugin.locationcomponent.createDefault2DPuck
import com.mapbox.maps.plugin.locationcomponent.location
import com.mapbox.navigation.base.route.NavigationRoute
import com.mapbox.navigation.base.trip.model.RouteProgress
import com.mapbox.navigation.ui.maps.location.NavigationLocationProvider
import com.rnmapbox.rnmbx.components.mapview.RNMBXExternalMap
import com.rnmapbox.rnmbx.components.mapview.RNMBXMapViewFactory

/**
 * The map on the car screen, for `<CarMap>`: hands it to `<MapView mapViewImpl="rnmbxnavcar:<id>">` from
 * `@rnmapbox/maps`, which adds its children to it. Main thread only, except [current].
 */
object RNMBXNavigationCarMaps : RNMBXNavigationSession.Listener {
  /** Keep in sync with `CAR_MAP_VIEW_IMPL` in src/CarMap.tsx. */
  const val MAP_VIEW_IMPL = "rnmbxnavcar"

  data class CarMap(val id: Int, val activity: String)

  /** Read on the JS thread by `getCarMap`. */
  @Volatile var current = CarMap(0, BROWSING)
    private set

  var observer: ((CarMap) -> Unit)? = null

  private var map: RNMBXExternalMap? = null
  private var lastId = 0
  private var navigating = false

  fun register() {
    RNMBXMapViewFactory.registerExternalMap(MAP_VIEW_IMPL) { impl, _ ->
      // A `<CarMap>` still rendering a map that was replaced meanwhile gets no map until it remounts with the new id.
      map.takeIf { impl.substringAfter(":", "").toIntOrNull() == current.id }
    }
    RNMBXNavigationSession.addListener(this)
  }

  fun attach(map: RNMBXExternalMap) {
    this.map = map
    lastId += 1
    update(CarMap(lastId, if (navigating) NAVIGATING else BROWSING))
  }

  fun detach(map: RNMBXExternalMap) {
    if (this.map !== map) return
    this.map = null
    update(CarMap(0, current.activity))
  }

  private fun update(carMap: CarMap) {
    if (carMap == current) return
    current = carMap
    observer?.invoke(carMap)
  }

  override fun onRoutes(routes: List<NavigationRoute>, preview: Boolean) {
    navigating = routes.isNotEmpty() && !preview
    update(current.copy(activity = if (navigating) NAVIGATING else BROWSING))
  }

  override fun onStopped() {
    navigating = false
    update(current.copy(activity = BROWSING))
  }

  override fun onLocation(location: Location, keyPoints: List<Location>) = Unit
  override fun onRouteProgress(progress: RouteProgress) = Unit
  override fun onCameraState(state: RNMBXNavigationCameraState) = Unit

  const val BROWSING = "browsing"
  const val NAVIGATING = "navigating"
}

/**
 * Draws the navigation map onto a car screen's [Surface]: Android Auto's `SurfaceCallback` and the debug car preview
 * both drive it. Shows the Mapbox Standard style and the puck, and follows the location while guidance runs.
 */
class RNMBXNavigationCarMapSurface(private val context: Context) : RNMBXNavigationSession.Listener {
  private var mapSurface: MapSurface? = null
  private var externalMap: RNMBXExternalMap? = null
  private val locationProvider = NavigationLocationProvider()
  private var navigating = false

  var followLocation = true

  /** [dpi] of the car screen, 160 for a pixel ratio of 1. */
  fun surfaceAvailable(surface: Surface, width: Int, height: Int, dpi: Int, initialCamera: CameraOptions? = null) {
    surfaceDestroyed()
    val options = MapInitOptions(
      context,
      mapOptions = MapInitOptions.getDefaultMapOptions(context).toBuilder().pixelRatio(dpi / 160f).build()
    )
    val mapSurface = MapSurface(context, surface, options)
    this.mapSurface = mapSurface
    mapSurface.onStart()
    mapSurface.surfaceCreated()
    mapSurface.surfaceChanged(width, height)
    initialCamera?.let { mapSurface.getMapboxMap().setCamera(it) }
    mapSurface.location.setLocationProvider(locationProvider)
    mapSurface.location.updateSettings {
      locationPuck = createDefault2DPuck(withBearing = true)
      puckBearing = PuckBearing.COURSE
      puckBearingEnabled = true
      enabled = true
    }
    mapSurface.getMapboxMap().loadStyle(Style.STANDARD) {
      val externalMap = RNMBXExternalMap(mapSurface.getMapboxMap(), mapSurface)
      this.externalMap = externalMap
      RNMBXNavigationCarMaps.attach(externalMap)
    }
    RNMBXNavigationSession.addListener(this)
  }

  fun surfaceChanged(width: Int, height: Int) {
    mapSurface?.surfaceChanged(width, height)
  }

  fun surfaceDestroyed() {
    val mapSurface = mapSurface ?: return
    RNMBXNavigationSession.removeListener(this)
    externalMap?.let {
      RNMBXNavigationCarMaps.detach(it)
      it.invalidate()
    }
    externalMap = null
    mapSurface.surfaceDestroyed()
    mapSurface.onStop()
    mapSurface.onDestroy()
    this.mapSurface = null
  }

  fun scrollBy(distanceX: Float, distanceY: Float) {
    val map = mapSurface?.getMapboxMap() ?: return
    val center = map.cameraState.center
    val screenCenter = map.pixelForCoordinate(center)
    val target = map.coordinateForPixel(
      com.mapbox.maps.ScreenCoordinate(screenCenter.x + distanceX, screenCenter.y + distanceY)
    )
    map.setCamera(CameraOptions.Builder().center(target).build())
  }

  fun scaleBy(factor: Float) {
    val map = mapSurface?.getMapboxMap() ?: return
    map.setCamera(CameraOptions.Builder().zoom(map.cameraState.zoom + Math.log(factor.toDouble()) / Math.log(2.0)).build())
  }

  override fun onLocation(location: Location, keyPoints: List<Location>) {
    locationProvider.changePosition(location, keyPoints)
    if (navigating && followLocation) {
      mapSurface?.getMapboxMap()?.easeTo(
        CameraOptions.Builder()
          .center(Point.fromLngLat(location.longitude, location.latitude))
          .bearing(location.bearing)
          .zoom(16.0)
          .pitch(45.0)
          .build(),
        MapAnimationOptions.mapAnimationOptions { duration(1000) }
      )
    }
  }

  override fun onRoutes(routes: List<NavigationRoute>, preview: Boolean) {
    navigating = routes.isNotEmpty() && !preview
  }

  override fun onStopped() {
    navigating = false
  }

  override fun onRouteProgress(progress: RouteProgress) = Unit
  override fun onCameraState(state: RNMBXNavigationCameraState) = Unit
}
