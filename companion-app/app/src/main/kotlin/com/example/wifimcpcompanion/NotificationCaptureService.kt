package com.example.wifimcpcompanion

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import java.util.concurrent.ConcurrentLinkedDeque

/**
 * Captures system-wide notifications so the host MCP server can read them
 * (e.g. for OTPs delivered via WhatsApp, banking apps, email clients —
 * anywhere SMS-based capture from #2 doesn't reach).
 *
 * Requires the user to grant notification access once via
 * Settings → Notifications → Notification access. The MainActivity exposes
 * a button that opens that page directly.
 */
class NotificationCaptureService : NotificationListenerService() {

    companion object {
        private const val TAG = "NotificationCapture"

        /** Max notifications retained in memory. */
        const val MAX_RETAINED = 100

        /**
         * Ring buffer of recent notifications, newest-first.
         * Static so the AdbBridgeReceiver can read it without binding the service.
         * ConcurrentLinkedDeque is safe for the listener thread + receiver thread.
         */
        val captured: ConcurrentLinkedDeque<CapturedNotification> = ConcurrentLinkedDeque()

        /** True once onListenerConnected has fired — implies notification access is granted. */
        @Volatile
        var listenerConnected: Boolean = false
            private set
    }

    data class CapturedNotification(
        val packageName: String,
        val title: String,
        val text: String,
        val timestamp: Long,
        val notificationId: Int,
        val tag: String?
    )

    override fun onListenerConnected() {
        super.onListenerConnected()
        listenerConnected = true
        Log.i(TAG, "Notification listener connected")
    }

    override fun onListenerDisconnected() {
        super.onListenerDisconnected()
        listenerConnected = false
        Log.i(TAG, "Notification listener disconnected")
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val extras = sbn.notification.extras
        val title = extras.getCharSequence("android.title")?.toString() ?: ""
        val text = extras.getCharSequence("android.text")?.toString()
            ?: extras.getCharSequence("android.bigText")?.toString()
            ?: ""

        val captured = CapturedNotification(
            packageName = sbn.packageName,
            title = title,
            text = text,
            timestamp = sbn.postTime,
            notificationId = sbn.id,
            tag = sbn.tag
        )

        // Newest first; trim to MAX_RETAINED.
        Companion.captured.addFirst(captured)
        while (Companion.captured.size > MAX_RETAINED) {
            Companion.captured.pollLast()
        }
    }
}
