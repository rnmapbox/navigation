package com.rnmapbox.rnmbxnav

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.view.Gravity
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.ReactApplicationContext
import com.mapbox.geojson.Point
import com.mapbox.maps.CameraOptions
import java.lang.ref.WeakReference

/**
 * Debug builds only, for prototyping without a car or the Desktop Head Unit: shows a car-screen-sized SurfaceView over
 * the app and drives it like Android Auto does, so `<CarMap>` children can be checked on an emulator.
 *
 *   adb shell am broadcast -a com.rnmapbox.navigation.DEBUG_CAR_PREVIEW --ez show true \
 *     --ef latitude 37.789 --ef longitude -122.403 --ef zoom 15 --ez follow false
 */
object RNMBXNavigationCarPreview {
  private const val ACTION = "com.rnmapbox.navigation.DEBUG_CAR_PREVIEW"
  private var registered = false
  /** The latest one: a JS reload replaces the context, and the receiver outlives it. */
  private var context = WeakReference<ReactApplicationContext>(null)
  private var view: SurfaceView? = null

  fun register(reactContext: ReactApplicationContext) {
    context = WeakReference(reactContext)
    if (registered) return
    registered = true
    val receiver = object : BroadcastReceiver() {
      override fun onReceive(receiverContext: Context, intent: Intent) {
        val context = context.get() ?: return
        val camera = if (intent.hasExtra("latitude") && intent.hasExtra("longitude")) {
          CameraOptions.Builder()
            .center(Point.fromLngLat(intent.getFloatExtra("longitude", 0f).toDouble(), intent.getFloatExtra("latitude", 0f).toDouble()))
            .zoom(intent.getFloatExtra("zoom", 14f).toDouble())
            .build()
        } else {
          null
        }
        context.runOnUiQueueThread {
          if (intent.getBooleanExtra("show", true)) {
            show(context, camera, intent.getBooleanExtra("follow", true))
          } else {
            hide()
          }
        }
      }
    }
    ContextCompat.registerReceiver(
      reactContext.applicationContext, receiver, IntentFilter(ACTION), ContextCompat.RECEIVER_EXPORTED
    )
  }

  private fun show(context: ReactApplicationContext, camera: CameraOptions?, follow: Boolean) {
    hide()
    val activity = context.currentActivity ?: return
    val density = activity.resources.displayMetrics.density
    val carMapSurface = RNMBXNavigationCarMapSurface(activity.applicationContext).apply { followLocation = follow }
    val surfaceView = SurfaceView(activity).apply {
      setZOrderOnTop(true)
      holder.addCallback(object : SurfaceHolder.Callback {
        private var available = false

        override fun surfaceCreated(holder: SurfaceHolder) = Unit

        override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
          if (available) {
            carMapSurface.surfaceChanged(width, height)
          } else {
            available = true
            // Like an 800x480 head unit at 160 dpi, scaled to this screen.
            carMapSurface.surfaceAvailable(holder.surface, width, height, (160 * density).toInt(), camera)
          }
        }

        override fun surfaceDestroyed(holder: SurfaceHolder) {
          available = false
          carMapSurface.surfaceDestroyed()
        }
      })
    }
    val root = activity.window.decorView as ViewGroup
    root.addView(
      surfaceView,
      FrameLayout.LayoutParams((400 * density).toInt(), (240 * density).toInt(), Gravity.TOP or Gravity.END).apply {
        topMargin = (40 * density).toInt()
      }
    )
    view = surfaceView
  }

  private fun hide() {
    view?.let { (it.parent as? ViewGroup)?.removeView(it) }
    view = null
  }
}
