package dev.phantommirror.agent

import android.app.Activity
import android.media.MediaCodec
import android.media.MediaFormat
import android.os.Bundle
import android.view.MotionEvent
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class MainActivity : Activity(), SurfaceHolder.Callback {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private lateinit var surfaceView: SurfaceView
    private lateinit var status: TextView
    private lateinit var urlInput: EditText
    private var decoder: MediaCodec? = null
    private var webSocketClient: WebSocketClient? = null
    private var surfaceReady = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        surfaceView = SurfaceView(this)
        surfaceView.holder.addCallback(this)
        surfaceView.setOnTouchListener { view, event ->
            val x = (event.x / view.width).coerceIn(0f, 1f)
            val y = (event.y / view.height).coerceIn(0f, 1f)
            val action = when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> "down"
                MotionEvent.ACTION_MOVE -> "move"
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> "up"
                else -> return@setOnTouchListener true
            }
            webSocketClient?.sendTouch(x, y, action)
            true
        }

        urlInput = EditText(this).apply {
            hint = "ws://PC_IP:PORT"
            setText("ws://192.168.1.10:39877")
            setSingleLine(true)
        }
        status = TextView(this).apply {
            text = "Enter PC WebSocket URL"
            setTextColor(0xffffffff.toInt())
        }
        val connect = Button(this).apply {
            text = "Connect"
            setOnClickListener { connectToPc() }
        }
        val controls = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(24, 24, 24, 24)
            setBackgroundColor(0xaa000000.toInt())
            addView(urlInput)
            addView(connect)
            addView(status)
        }
        setContentView(FrameLayout(this).apply {
            addView(surfaceView, FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
            addView(controls, FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT)
        })
    }

    private fun connectToPc() {
        if (!surfaceReady) {
            status.text = "Surface is not ready"
            return
        }
        startDecoder()
        webSocketClient?.close()
        webSocketClient = WebSocketClient(
            url = urlInput.text.toString(),
            onFrame = { frame -> queueFrame(frame) },
            onStatus = { message -> scope.launch { status.text = message } },
        ).also { it.connect() }
    }

    private fun startDecoder() {
        decoder?.stop()
        decoder?.release()
        val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, 1280, 720)
        decoder = MediaCodec.createDecoderByType(MediaFormat.MIMETYPE_VIDEO_AVC).apply {
            configure(format, surfaceView.holder.surface, null, 0)
            start()
        }
    }

    private fun queueFrame(frame: ByteArray) {
        val codec = decoder ?: return
        val inputIndex = codec.dequeueInputBuffer(10_000)
        if (inputIndex < 0) return
        val buffer = codec.getInputBuffer(inputIndex) ?: return
        buffer.clear()
        buffer.put(frame)
        codec.queueInputBuffer(inputIndex, 0, frame.size, System.nanoTime() / 1000, 0)

        var outputIndex = codec.dequeueOutputBuffer(MediaCodec.BufferInfo(), 0)
        while (outputIndex >= 0) {
            codec.releaseOutputBuffer(outputIndex, true)
            outputIndex = codec.dequeueOutputBuffer(MediaCodec.BufferInfo(), 0)
        }
    }

    override fun surfaceCreated(holder: SurfaceHolder) {
        surfaceReady = true
    }

    override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) = Unit

    override fun surfaceDestroyed(holder: SurfaceHolder) {
        surfaceReady = false
    }

    override fun onDestroy() {
        webSocketClient?.close()
        decoder?.stop()
        decoder?.release()
        super.onDestroy()
    }
}
