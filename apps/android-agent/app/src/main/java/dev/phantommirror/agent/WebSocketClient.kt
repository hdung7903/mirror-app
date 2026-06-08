package dev.phantommirror.agent

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import java.util.concurrent.TimeUnit

class WebSocketClient(
    private val url: String,
    private val onFrame: (ByteArray) -> Unit,
    private val onStatus: (String) -> Unit,
) {
    private val client = OkHttpClient.Builder()
        .pingInterval(15, TimeUnit.SECONDS)
        .build()
    private var socket: WebSocket? = null

    fun connect() {
        val request = Request.Builder().url(url).build()
        socket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                onStatus("Connected to $url")
            }

            override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                onFrame(bytes.toByteArray())
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                onStatus("Connection failed: ${t.message}")
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                onStatus("Disconnected")
            }
        })
    }

    fun sendTouch(x: Float, y: Float, action: String) {
        socket?.send("""{"type":"touch","x":$x,"y":$y,"action":"$action"}""")
    }

    fun close() {
        socket?.close(1000, "Activity closed")
        socket = null
    }
}
