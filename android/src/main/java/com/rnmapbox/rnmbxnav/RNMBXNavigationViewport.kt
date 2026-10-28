package com.rnmapbox.rnmbxnav

import android.content.Context
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.PixelUtil
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewGroupManager
import com.facebook.react.uimanager.ViewManagerDelegate
import com.facebook.react.viewmanagers.RNMBXNavigationViewportManagerDelegate
import com.facebook.react.viewmanagers.RNMBXNavigationViewportManagerInterface
import com.mapbox.maps.EdgeInsets
import com.rnmapbox.rnmbx.components.AbstractMapFeature
import com.rnmapbox.rnmbx.components.RemovalReason
import com.rnmapbox.rnmbx.components.mapview.RNMBXMapView
import com.rnmapbox.rnmbx.utils.Logger

/** Native side of `<NavigationViewport>`: applies its settings to the navigation map it's a child of. */
class RNMBXNavigationViewport(context: Context) : AbstractMapFeature(context) {
  private var binding: RNMBXNavigationMapBinding? = null

  var viewportPadding: EdgeInsets? = null
    set(value) {
      field = value
      binding?.setViewportPadding(value)
    }

  /** Applied by [applyRouteLineStyle], once per React update. */
  var routeLineStyle = RNMBXRouteLineStyle()

  fun applyRouteLineStyle() {
    binding?.setRouteLineStyle(routeLineStyle)
  }

  override fun addToMap(mapView: RNMBXMapView) {
    super.addToMap(mapView)
    binding = mapView.mapView?.let { RNMBXNavigationMapFactory.binding(it) }
    if (binding == null) {
      Logger.e(LOG_TAG, "NavigationViewport must be a child of <MapView mapViewImpl=\"rnmbxnav\">")
    }
    binding?.setViewportPadding(viewportPadding)
    binding?.setRouteLineStyle(routeLineStyle)
  }

  override fun removeFromMap(mapView: RNMBXMapView, reason: RemovalReason): Boolean {
    // Padding lives on the navigation camera, which survives style changes.
    if (reason == RemovalReason.STYLE_CHANGE) return false
    binding?.setViewportPadding(null)
    binding?.setRouteLineStyle(RNMBXRouteLineStyle())
    binding = null
    return super.removeFromMap(mapView, reason)
  }

  companion object {
    private const val LOG_TAG = "RNMBXNavigationViewport"
  }
}

@ReactModule(name = RNMBXNavigationViewportManager.REACT_CLASS)
class RNMBXNavigationViewportManager :
  ViewGroupManager<RNMBXNavigationViewport>(),
  RNMBXNavigationViewportManagerInterface<RNMBXNavigationViewport> {

  private val delegate = RNMBXNavigationViewportManagerDelegate(this)

  override fun getDelegate(): ViewManagerDelegate<RNMBXNavigationViewport> = delegate

  override fun getName() = REACT_CLASS

  override fun createViewInstance(context: ThemedReactContext) = RNMBXNavigationViewport(context)

  override fun setViewportPadding(view: RNMBXNavigationViewport, value: ReadableMap?) {
    view.viewportPadding = value?.let {
      EdgeInsets(
        PixelUtil.toPixelFromDIP(it.getDouble("top")).toDouble(),
        PixelUtil.toPixelFromDIP(it.getDouble("left")).toDouble(),
        PixelUtil.toPixelFromDIP(it.getDouble("bottom")).toDouble(),
        PixelUtil.toPixelFromDIP(it.getDouble("right")).toDouble()
      )
    }
  }

  override fun onAfterUpdateTransaction(view: RNMBXNavigationViewport) {
    super.onAfterUpdateTransaction(view)
    view.applyRouteLineStyle()
  }

  override fun setRouteLineColor(view: RNMBXNavigationViewport, value: Int?) {
    view.routeLineStyle = view.routeLineStyle.copy(color = value)
  }

  override fun setRouteLineCasingColor(view: RNMBXNavigationViewport, value: Int?) {
    view.routeLineStyle = view.routeLineStyle.copy(casingColor = value)
  }

  override fun setRouteLineAlternativeColor(view: RNMBXNavigationViewport, value: Int?) {
    view.routeLineStyle = view.routeLineStyle.copy(alternativeColor = value)
  }

  override fun setRouteLineTraveledColor(view: RNMBXNavigationViewport, value: Int?) {
    view.routeLineStyle = view.routeLineStyle.copy(traveledColor = value)
  }

  companion object {
    const val REACT_CLASS = "RNMBXNavigationViewport"
  }
}
