package com.rnmapbox.rnmbxnav

import android.graphics.Bitmap
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import com.mapbox.common.location.Location
import com.mapbox.maps.CameraOptions
import com.mapbox.maps.EdgeInsets
import com.mapbox.maps.ImageHolder
import com.mapbox.maps.MapView
import com.mapbox.maps.Style
import com.mapbox.maps.plugin.LocationPuck
import com.mapbox.maps.plugin.LocationPuck2D
import com.mapbox.maps.plugin.LocationPuck3D
import com.mapbox.maps.plugin.PuckBearing
import com.mapbox.maps.plugin.animation.MapAnimationOptions
import com.mapbox.maps.plugin.animation.camera
import com.mapbox.maps.plugin.animation.easeTo
import com.mapbox.maps.plugin.gestures.OnMapClickListener
import com.mapbox.maps.plugin.gestures.gestures
import com.mapbox.maps.plugin.locationcomponent.OnIndicatorPositionChangedListener
import com.mapbox.maps.plugin.locationcomponent.createDefault2DPuck
import com.mapbox.maps.plugin.locationcomponent.location
import com.mapbox.navigation.base.route.NavigationRoute
import com.mapbox.navigation.base.trip.model.RouteProgress
import com.mapbox.navigation.base.utils.DecodeUtils.completeGeometryToPoints
import com.mapbox.navigation.ui.maps.camera.NavigationCamera
import com.mapbox.navigation.ui.maps.camera.data.MapboxNavigationViewportDataSource
import com.mapbox.navigation.ui.maps.camera.lifecycle.NavigationBasicGesturesHandler
import com.mapbox.navigation.ui.maps.camera.state.NavigationCameraState
import com.mapbox.navigation.ui.maps.camera.state.NavigationCameraStateChangedObserver
import com.mapbox.navigation.ui.maps.location.NavigationLocationProvider
import com.mapbox.navigation.ui.maps.route.arrow.api.MapboxRouteArrowApi
import com.mapbox.navigation.ui.maps.route.arrow.api.MapboxRouteArrowView
import com.mapbox.navigation.ui.maps.route.arrow.model.RouteArrowOptions
import com.mapbox.navigation.ui.maps.route.line.api.MapboxRouteLineApi
import com.mapbox.navigation.ui.maps.route.line.api.MapboxRouteLineView
import com.mapbox.navigation.ui.maps.route.line.model.MapboxRouteLineApiOptions
import com.mapbox.navigation.ui.maps.route.line.model.MapboxRouteLineViewOptions
import com.mapbox.navigation.ui.maps.route.line.model.RouteLineColorResources
import com.rnmapbox.rnmbx.components.images.Subscription
import com.rnmapbox.rnmbx.components.mapview.Cancelable
import com.rnmapbox.rnmbx.components.mapview.OnCameraWillMoveMapListener
import com.rnmapbox.rnmbx.components.mapview.RNMBXMapView
import com.rnmapbox.rnmbx.components.mapview.RNMBXMapViewFactory
import com.rnmapbox.rnmbx.v11compat.image.toImageHolder
import java.lang.ref.WeakReference
import java.util.WeakHashMap
import org.json.JSONArray

/**
 * Lets `<MapView mapViewImpl="rnmbxnav">` from `@rnmapbox/maps` render navigation: the factory creates the
 * MapView rnmapbox uses and binds the Navigation SDK's route line, puck and camera to it.
 */
object RNMBXNavigationMapFactory {
  /** Keep in sync with `NAVIGATION_MAP_VIEW_IMPL` in src/index.ts. */
  const val MAP_VIEW_IMPL = "rnmbxnav"

  fun register() {
    RNMBXMapViewFactory.register(MAP_VIEW_IMPL) { _, parent -> createMapView(parent) }
  }

  private fun createMapView(parent: RNMBXMapView): MapView {
    val mapView = MapView(parent.context)
    mapView.layoutParams = FrameLayout.LayoutParams(
      ViewGroup.LayoutParams.MATCH_PARENT,
      ViewGroup.LayoutParams.MATCH_PARENT
    )
    parent.addView(mapView)
    val binding = RNMBXNavigationMapBinding(mapView, parent)
    bindings[mapView] = WeakReference(binding)
    return mapView
  }

  // The binding references its map, so a strong value would keep the key alive.
  private val bindings = WeakHashMap<MapView, WeakReference<RNMBXNavigationMapBinding>>()

  /** The binding of a map created by this factory, or null for other maps. */
  fun binding(mapView: MapView): RNMBXNavigationMapBinding? = bindings[mapView]?.get()
}

/** Mirrors [RNMBXNavigationSession] onto one MapView while it's attached to a window. */
class RNMBXNavigationMapBinding(
  private val mapView: MapView,
  private val parent: RNMBXMapView? = null
) :
  RNMBXNavigationSession.Listener, View.OnAttachStateChangeListener, OnCameraWillMoveMapListener {

  private val locationProvider = NavigationLocationProvider()
  private val viewportDataSource = MapboxNavigationViewportDataSource(mapView.mapboxMap)
  private val navigationCamera = NavigationCamera(mapView.mapboxMap, mapView.camera, viewportDataSource)
  private val routeLineApi = MapboxRouteLineApi(
    MapboxRouteLineApiOptions.Builder().vanishingRouteLineEnabled(true).build()
  )
  private val routeLineView = MapboxRouteLineView(MapboxRouteLineViewOptions.Builder(mapView.context).build())
  private val arrowApi = MapboxRouteArrowApi()
  private val arrowView = MapboxRouteArrowView(RouteArrowOptions.Builder(mapView.context).build())

  private var cameraWillMoveMapRegistration: Cancelable? = null

  private var navigationCameraState = NavigationCameraState.IDLE
  private val onNavigationCameraState = NavigationCameraStateChangedObserver { state ->
    val wasActive = navigationCameraState != NavigationCameraState.IDLE
    navigationCameraState = state
    // NavigationBasicGesturesHandler drops the camera to idle on gestures and on camera animations it doesn't own.
    if (wasActive && state == NavigationCameraState.IDLE) {
      RNMBXNavigationSession.updateCameraState(RNMBXNavigationCameraState.IDLE)
    }
  }

  private val onMapClick = OnMapClickListener { point ->
    routeLineApi.findClosestRoute(point, mapView.mapboxMap, ROUTE_CLICK_PADDING) { result ->
      result.onValue { RNMBXNavigationSession.selectAlternativeRoute(it.navigationRoute) }
    }
    false
  }

  private val onPuckPosition = OnIndicatorPositionChangedListener { point ->
    val result = routeLineApi.updateTraveledRouteLine(point)
    mapView.mapboxMap.style?.let { routeLineView.renderRouteLineUpdate(it, result) }
  }

  init {
    mapView.location.setLocationProvider(locationProvider)
    mapView.location.updateSettings {
      locationPuck = defaultPuck
      puckBearing = PuckBearing.COURSE
      puckBearingEnabled = true
      enabled = false
    }
    mapView.camera.addCameraAnimationsLifecycleListener(NavigationBasicGesturesHandler(navigationCamera))
    // Style reloads drop the route layers.
    mapView.mapboxMap.subscribeStyleLoaded {
      mapView.mapboxMap.style?.let { applyRouteLineStyle(it) }
      routeLineApi.getRouteDrawData { data ->
        mapView.mapboxMap.style?.let { routeLineView.renderRouteDrawData(it, data) }
      }
      mapView.mapboxMap.style?.let { arrowView.render(it, arrowApi.redraw()) }
    }
    mapView.addOnAttachStateChangeListener(this)
    if (mapView.isAttachedToWindow) onViewAttachedToWindow(mapView)
  }

  private var viewportPadding = NO_PADDING

  /** Pixels; null restores the SDK default of no padding. */
  fun setViewportPadding(padding: EdgeInsets?) {
    viewportPadding = padding ?: NO_PADDING
    viewportDataSource.followingPadding = viewportPadding
    viewportDataSource.overviewPadding = viewportPadding
    viewportDataSource.evaluate()
  }

  private var routeLineStyle = RNMBXRouteLineStyle()

  fun setRouteLineStyle(style: RNMBXRouteLineStyle) {
    if (style == routeLineStyle) return
    routeLineStyle = style
    val mapStyle = mapView.mapboxMap.style ?: return
    applyRouteLineStyle(mapStyle)
    routeLineApi.getRouteDrawData { data ->
      mapView.mapboxMap.style?.let { routeLineView.renderRouteDrawData(it, data) }
    }
  }

  private fun applyRouteLineStyle(style: Style) {
    routeLineView.updateDynamicOptions(style) {
      routeLineColorResources(routeLineStyle.colorResources())
    }
  }

  private var puck: Map<String, Any?>? = null
  private var puckImage: ImageHolder? = null
  private var puckImageSubscription: Subscription? = null

  /** From `<NavigationViewport puck>`; null shows the SDK's puck. */
  fun setPuck(puck: Map<String, Any?>?) {
    if (puck == this.puck) return
    val imageName = puck?.get("bearingImage") as? String
    if (imageName != this.puck?.get("bearingImage")) subscribePuckImage(imageName)
    this.puck = puck
    applyPuck()
  }

  /** `<Images>` can add the image to the style after the puck is set, and adds it again after style reloads. */
  private fun subscribePuckImage(name: String?) {
    puckImageSubscription?.cancel()
    puckImageSubscription = null
    puckImage = name?.let { mapView.mapboxMap.style?.getStyleImage(it)?.toImageHolder() }
    if (name == null) return
    puckImageSubscription = parent?.imageManager?.subscribe(name) { _, image ->
      puckImage = image.toImageHolder()
      applyPuck()
    }
  }

  private fun applyPuck() {
    val puck = puck
    val model = puck?.get("model") as? Map<*, *>
    val image = puckImage
    mapView.location.locationPuck = when {
      puck?.get("visible") == false -> hiddenPuck
      model != null -> puck3D(model) ?: defaultPuck
      image != null -> LocationPuck2D(bearingImage = image, scaleExpression = puck?.get("scale")?.let(::expressionJson))
      else -> defaultPuck
    }
  }

  /** Fits the camera to a previewed route once, leaving the navigation camera idle. */
  private fun showRoutePreview(route: NavigationRoute) {
    mapView.mapboxMap.cameraForCoordinates(
      route.directionsRoute.completeGeometryToPoints(),
      CameraOptions.Builder().padding(NO_PADDING).bearing(0.0).pitch(0.0).build(),
      viewportPadding,
      null,
      null
    ) { camera ->
      mapView.camera.easeTo(camera, MapAnimationOptions.mapAnimationOptions { duration(1000) })
    }
  }

  override fun onViewAttachedToWindow(view: View) {
    mapView.location.addOnIndicatorPositionChangedListener(onPuckPosition)
    mapView.gestures.addOnMapClickListener(onMapClick)
    navigationCamera.registerNavigationCameraStateChangeObserver(onNavigationCameraState)
    cameraWillMoveMapRegistration = parent?.addOnCameraWillMoveMapListener(this)
    RNMBXNavigationSession.addListener(this)
  }

  override fun onViewDetachedFromWindow(view: View) {
    RNMBXNavigationSession.removeListener(this)
    cameraWillMoveMapRegistration?.cancel()
    cameraWillMoveMapRegistration = null
    navigationCamera.unregisterNavigationCameraStateChangeObserver(onNavigationCameraState)
    mapView.location.removeOnIndicatorPositionChangedListener(onPuckPosition)
    mapView.gestures.removeOnMapClickListener(onMapClick)
    routeLineApi.cancel()
    routeLineView.cancel()
  }

  override fun onLocation(location: Location, keyPoints: List<Location>) {
    mapView.location.enabled = true
    locationProvider.changePosition(location, keyPoints)
    viewportDataSource.onLocationChanged(location)
    viewportDataSource.evaluate()
  }

  override fun onRoutes(routes: List<NavigationRoute>, preview: Boolean) {
    routeLineApi.setNavigationRoutes(routes, RNMBXNavigationSession.alternativesMetadata(routes)) { data ->
      mapView.mapboxMap.style?.let { routeLineView.renderRouteDrawData(it, data) }
    }
    if (routes.isEmpty() || preview) {
      mapView.mapboxMap.style?.let { arrowView.render(it, arrowApi.clearArrows()) }
    }
    if (routes.isEmpty()) {
      viewportDataSource.clearRouteData()
    } else {
      viewportDataSource.onRouteChanged(routes.first())
    }
    viewportDataSource.evaluate()
    if (preview && routes.isNotEmpty()) showRoutePreview(routes.first())
  }

  override fun onRouteProgress(progress: RouteProgress) {
    routeLineApi.updateWithRouteProgress(progress) { result ->
      mapView.mapboxMap.style?.let { routeLineView.renderRouteLineUpdate(it, result) }
    }
    mapView.mapboxMap.style?.let { arrowView.renderManeuverUpdate(it, arrowApi.addUpcomingManeuverArrow(progress)) }
    viewportDataSource.onRouteProgressChanged(progress)
    viewportDataSource.evaluate()
  }

  override fun onCameraState(state: RNMBXNavigationCameraState) {
    when (state) {
      RNMBXNavigationCameraState.FOLLOWING -> navigationCamera.requestNavigationCameraToFollowing()
      RNMBXNavigationCameraState.OVERVIEW -> navigationCamera.requestNavigationCameraToOverview()
      RNMBXNavigationCameraState.IDLE -> navigationCamera.requestNavigationCameraToIdle()
    }
  }

  override fun onCameraWillMoveMap(mapView: RNMBXMapView) {
    RNMBXNavigationSession.updateCameraState(RNMBXNavigationCameraState.IDLE)
  }

  override fun onStopped() {
    mapView.location.enabled = false
    mapView.camera.easeTo(
      CameraOptions.Builder().padding(NO_PADDING).bearing(0.0).pitch(0.0).build(),
      MapAnimationOptions.mapAnimationOptions { duration(500) }
    )
  }

  private companion object {
    val NO_PADDING = EdgeInsets(0.0, 0.0, 0.0, 0.0)
    val defaultPuck = createDefault2DPuck(withBearing = true)

    // Disabling the location component would also stop the puck position updates that shrink the traveled route line.
    val hiddenPuck = ImageHolder.from(Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888)).let {
      LocationPuck2D(topImage = it, bearingImage = it, shadowImage = it)
    }
    const val ROUTE_CLICK_PADDING = 30f
  }
}

/** Colors from `<NavigationViewport routeLineStyle>`; null keeps the SDK's. */
data class RNMBXRouteLineStyle(
  val color: Int? = null,
  val casingColor: Int? = null,
  val alternativeColor: Int? = null,
  val traveledColor: Int? = null
) {
  // Matches iOS, where the route color also stands for low and unknown traffic.
  fun colorResources(): RouteLineColorResources = RouteLineColorResources.Builder().apply {
    color?.let {
      routeDefaultColor(it)
      routeLowCongestionColor(it)
      routeUnknownCongestionColor(it)
    }
    casingColor?.let { routeCasingColor(it) }
    alternativeColor?.let {
      alternativeRouteDefaultColor(it)
      alternativeRouteLowCongestionColor(it)
      alternativeRouteUnknownCongestionColor(it)
    }
    traveledColor?.let { routeLineTraveledColor(it) }
  }.build()
}

private fun puck3D(model: Map<*, *>): LocationPuck? {
  val uri = model["uri"] as? String ?: return null
  val scale = model["scale"]
  val rotation = model["rotation"]
  val opacity = model["opacity"]
  return LocationPuck3D(
    modelUri = uri,
    modelScale = floats(scale) ?: listOf(1f, 1f, 1f),
    modelScaleExpression = scale?.takeIf { floats(it) == null }?.let(::expressionJson),
    modelRotation = floats(rotation) ?: listOf(0f, 0f, 0f),
    modelRotationExpression = rotation?.takeIf { floats(it) == null }?.let(::expressionJson),
    modelOpacity = (opacity as? Number)?.toFloat() ?: 1f,
    modelOpacityExpression = opacity?.takeIf { it !is Number }?.let(::expressionJson)
  )
}

private fun floats(value: Any?): List<Float>? =
  (value as? List<*>)?.map { (it as? Number)?.toFloat() ?: return null }

/** A number or an expression, as the JSON the location component expects. */
private fun expressionJson(value: Any): String =
  if (value is List<*>) JSONArray(value).toString() else value.toString()
