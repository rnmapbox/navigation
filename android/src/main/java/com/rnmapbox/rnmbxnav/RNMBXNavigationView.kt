package com.rnmapbox.rnmbxnav

import android.annotation.SuppressLint
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import androidx.lifecycle.setViewTreeLifecycleOwner
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.events.Event
import com.mapbox.common.location.Location
import com.mapbox.maps.MapView
import com.mapbox.maps.plugin.compass.compass
import com.mapbox.maps.plugin.scalebar.scalebar
import com.mapbox.navigation.base.formatter.DistanceFormatterOptions
import com.mapbox.navigation.base.route.NavigationRoute
import com.mapbox.navigation.base.trip.model.RouteLegProgress
import com.mapbox.navigation.base.trip.model.RouteProgress
import com.mapbox.navigation.core.MapboxNavigation
import com.mapbox.navigation.core.arrival.ArrivalObserver
import com.mapbox.navigation.core.formatter.MapboxDistanceFormatter
import com.mapbox.navigation.core.trip.session.LocationMatcherResult
import com.mapbox.navigation.core.trip.session.LocationObserver
import com.mapbox.navigation.tripdata.maneuver.api.MapboxManeuverApi
import com.mapbox.navigation.tripdata.progress.api.MapboxTripProgressApi
import com.mapbox.navigation.tripdata.progress.model.TripProgressUpdateFormatter
import com.mapbox.navigation.tripdata.speedlimit.api.MapboxSpeedInfoApi
import com.mapbox.navigation.ui.components.maneuver.view.MapboxManeuverView
import com.mapbox.navigation.ui.components.maps.camera.view.MapboxRecenterButton
import com.mapbox.navigation.ui.components.maps.camera.view.MapboxRouteOverviewButton
import com.mapbox.navigation.ui.components.speedlimit.view.MapboxSpeedInfoView
import com.mapbox.navigation.ui.components.tripprogress.view.MapboxTripProgressView
import com.mapbox.navigation.ui.components.voice.view.MapboxSoundButton

@SuppressLint("ViewConstructor")
class RNMBXNavigationView(private val context: ThemedReactContext) :
  FrameLayout(context), RNMBXNavigationSession.Listener, LifecycleOwner {

  var route: RNMBXNavigationRoute? = null
  var simulate = false
  var mute = false
    set(value) {
      field = value
      RNMBXNavigationSession.voiceMuted = value
      renderMute()
    }

  private val mapView = MapView(context)
  private val lifecycleRegistry = LifecycleRegistry(this).apply { currentState = Lifecycle.State.CREATED }
  override val lifecycle: Lifecycle
    get() = lifecycleRegistry
  private val mapBinding = RNMBXNavigationMapBinding(mapView)

  private val distanceFormatterOptions = DistanceFormatterOptions.Builder(context).build()
  private val maneuverApi = MapboxManeuverApi(MapboxDistanceFormatter(distanceFormatterOptions))
  private val tripProgressApi = MapboxTripProgressApi(TripProgressUpdateFormatter.Builder(context).build())
  private val speedInfoApi = MapboxSpeedInfoApi()

  private val maneuverView = MapboxManeuverView(context)
  private val speedInfoView = MapboxSpeedInfoView(context).apply { visibility = GONE }
  private val soundButton = MapboxSoundButton(context)
  private val overviewButton = MapboxRouteOverviewButton(context)
  private val recenterButton = MapboxRecenterButton(context)
  private val tripProgressView = MapboxTripProgressView(context)
  private val stopButton = TextView(context)

  private var navigation: MapboxNavigation? = null
  private var startedRoute: RNMBXNavigationRoute? = null
  private var arrivedAtFinalDestination = false

  private val locationObserver = object : LocationObserver {
    override fun onNewRawLocation(rawLocation: Location) = Unit

    override fun onNewLocationMatcherResult(locationMatcherResult: LocationMatcherResult) {
      val speedInfo = speedInfoApi.updatePostedAndCurrentSpeed(locationMatcherResult, distanceFormatterOptions)
      speedInfoView.visibility = if (speedInfo?.postedSpeed == null) GONE else VISIBLE
      speedInfo?.let { speedInfoView.render(it) }
    }
  }

  private val arrivalObserver = object : ArrivalObserver {
    override fun onWaypointArrival(routeProgress: RouteProgress) {
      dispatch("topArrive", Arguments.createMap().apply {
        putInt("waypointIndex", (routeProgress.currentLegProgress?.legIndex ?: 0) + 1)
        putBoolean("isFinalDestination", false)
      })
    }

    override fun onNextRouteLegStart(routeLegProgress: RouteLegProgress) = Unit

    override fun onFinalDestinationArrival(routeProgress: RouteProgress) {
      if (arrivedAtFinalDestination) return
      arrivedAtFinalDestination = true
      dispatch("topArrive", Arguments.createMap().apply {
        putInt("waypointIndex", routeProgress.navigationRoute.directionsRoute.legs()?.size ?: 1)
        putBoolean("isFinalDestination", true)
      })
    }
  }

  init {
    // Under the activity's lifecycle, the Maps lifecycle plugin keeps the map alive until the activity is destroyed.
    mapView.setViewTreeLifecycleOwner(this)
    mapView.compass.enabled = false
    mapView.scalebar.enabled = false

    val margin = dp(12)
    val column = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
    addView(column, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    // The bottom bar sits below the map so it doesn't cover the Mapbox logo and attribution.
    val mapArea = FrameLayout(context)
    column.addView(mapArea, LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, 0, 1f))
    mapArea.addView(mapView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    val overlay = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
    mapArea.addView(overlay, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    overlay.addView(maneuverView, LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT).apply {
      setMargins(margin, margin, margin, 0)
    })

    val middle = FrameLayout(context)
    overlay.addView(middle, LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, 0, 1f))
    middle.addView(speedInfoView, LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT, Gravity.START or Gravity.TOP).apply {
      setMargins(margin, margin, 0, 0)
    })
    val buttons = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
    middle.addView(buttons, LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT, Gravity.END or Gravity.TOP).apply {
      setMargins(0, margin, margin, 0)
    })
    for (button in listOf(soundButton, overviewButton, recenterButton)) {
      buttons.addView(button, LinearLayout.LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT).apply {
        bottomMargin = dp(8)
      })
    }

    val bottomBar = LinearLayout(context).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      setBackgroundColor(Color.WHITE)
      setPadding(margin, margin, margin, margin)
    }
    column.addView(bottomBar, LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT))
    bottomBar.addView(tripProgressView, LinearLayout.LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f))
    stopButton.apply {
      text = "✕"
      textSize = 22f
      gravity = Gravity.CENTER
      setTextColor(Color.BLACK)
      contentDescription = "End navigation"
      background = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(Color.rgb(0xF3, 0xF4, 0xF6))
      }
    }
    bottomBar.addView(stopButton, LinearLayout.LayoutParams(dp(48), dp(48)))

    soundButton.updateStyle(com.mapbox.navigation.ui.components.R.style.MapboxStyleSound)
    overviewButton.updateStyle(com.mapbox.navigation.ui.components.R.style.MapboxStyleRouteOverview)
    recenterButton.updateStyle(com.mapbox.navigation.ui.components.R.style.MapboxStyleRecenter)
    soundButton.setOnClickListener {
      RNMBXNavigationSession.voiceMuted = !RNMBXNavigationSession.voiceMuted
      renderMute()
    }
    overviewButton.setOnClickListener { RNMBXNavigationSession.updateCameraState(RNMBXNavigationCameraState.OVERVIEW) }
    recenterButton.setOnClickListener { RNMBXNavigationSession.updateCameraState(RNMBXNavigationCameraState.FOLLOWING) }
    stopButton.setOnClickListener {
      stop()
      dispatch("topCancel", Arguments.createMap())
    }
  }

  /** Called once the props of a React update are all set. */
  fun startGuidanceIfNeeded() {
    val route = route ?: return
    if (route === startedRoute) return
    val navigation = RNMBXNavigationSession.mapboxNavigation(context) ?: run {
      dispatchError("no_access_token", "Call Navigation.setAccessToken before using navigation")
      return
    }
    try {
      RNMBXNavigationSession.startActiveGuidance(navigation, route, simulate)
    } catch (e: SecurityException) {
      dispatchError("start_failed", e.message ?: e.toString())
      return
    }
    startedRoute = route
    arrivedAtFinalDestination = false
    RNMBXNavigationSession.voiceMuted = mute
    renderMute()
    if (this.navigation == null) {
      this.navigation = navigation
      navigation.registerLocationObserver(locationObserver)
      navigation.registerArrivalObserver(arrivalObserver)
      RNMBXNavigationSession.addListener(this)
    }
  }

  fun dispatchError(code: String, message: String) {
    dispatch("topError", Arguments.createMap().apply {
      putString("code", code)
      putString("message", message)
    })
  }

  fun stop() {
    val navigation = navigation ?: return
    this.navigation = null
    startedRoute = null
    RNMBXNavigationSession.removeListener(this)
    navigation.unregisterLocationObserver(locationObserver)
    navigation.unregisterArrivalObserver(arrivalObserver)
    maneuverApi.cancel()
    RNMBXNavigationSession.stopNavigation()
  }

  fun destroy() {
    stop()
    lifecycleRegistry.currentState = Lifecycle.State.DESTROYED
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    lifecycleRegistry.currentState = Lifecycle.State.RESUMED
  }

  override fun onDetachedFromWindow() {
    if (lifecycleRegistry.currentState != Lifecycle.State.DESTROYED) {
      lifecycleRegistry.currentState = Lifecycle.State.CREATED
    }
    super.onDetachedFromWindow()
  }

  private fun renderMute() {
    if (RNMBXNavigationSession.voiceMuted) soundButton.mute() else soundButton.unmute()
  }

  override fun onLocation(location: Location, keyPoints: List<Location>) = Unit

  override fun onRoutes(routes: List<NavigationRoute>, preview: Boolean) = Unit

  override fun onRouteProgress(progress: RouteProgress) {
    val maneuvers = maneuverApi.getManeuvers(progress)
    maneuverView.renderManeuvers(maneuvers)
    maneuvers.onValue { maneuverApi.getRoadShields(it) { shields -> maneuverView.renderManeuverWith(shields) } }
    tripProgressView.render(tripProgressApi.getTripProgress(progress))
    dispatch("topRouteProgress", routeProgressEvent(progress))
  }

  override fun onCameraState(state: RNMBXNavigationCameraState) {
    recenterButton.visibility = if (state == RNMBXNavigationCameraState.FOLLOWING) GONE else VISIBLE
    overviewButton.visibility = if (state == RNMBXNavigationCameraState.OVERVIEW) GONE else VISIBLE
  }

  override fun onStopped() = Unit

  private fun dispatch(name: String, data: WritableMap) {
    UIManagerHelper.getEventDispatcherForReactTag(context, id)
      ?.dispatchEvent(RNMBXNavigationViewEvent(UIManagerHelper.getSurfaceId(this), id, name, data))
  }

  // React Native doesn't lay out native children it didn't create.
  private val measureAndLayout = Runnable {
    measure(MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY))
    layout(left, top, right, bottom)
  }

  override fun requestLayout() {
    super.requestLayout()
    post(measureAndLayout)
  }

  private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}

private class RNMBXNavigationViewEvent(
  surfaceId: Int,
  viewTag: Int,
  private val name: String,
  private val data: WritableMap
) : Event<RNMBXNavigationViewEvent>(surfaceId, viewTag) {
  override fun getEventName() = name

  override fun getEventData() = data
}
