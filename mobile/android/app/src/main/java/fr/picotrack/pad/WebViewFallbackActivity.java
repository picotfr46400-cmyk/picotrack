package fr.picotrack.pad;

import android.Manifest;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebView;

// Repli WebView : caméra et GPS seulement pour l'hôte écrit par configure.mjs
// (efc.picotrack.fr par défaut). Le WebChromeClient de la bibliothèque est privé.
public class WebViewFallbackActivity extends com.google.androidbrowserhelper.trusted.WebViewFallbackActivity {
    private static final int REQ_LOCATION = 4101;
    private static final int REQ_CAMERA = 4102;

    private GeolocationPermissions.Callback locationCallback;
    private String locationOrigin;
    private PermissionRequest cameraRequest;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView webView = findWebView(getWindow().getDecorView());
        if (webView == null) return;
        webView.getSettings().setGeolocationEnabled(true);
        webView.setWebChromeClient(new TenantChromeClient());
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
        if (requestCode == REQ_LOCATION && locationCallback != null) {
            String origin = locationOrigin;
            GeolocationPermissions.Callback callback = locationCallback;
            locationCallback = null;
            locationOrigin = null;
            callback.invoke(origin, granted && tenantOrigin(origin), false);
        } else if (requestCode == REQ_CAMERA && cameraRequest != null) {
            PermissionRequest request = cameraRequest;
            cameraRequest = null;
            if (granted && tenantOrigin(request.getOrigin())) request.grant(new String[] { PermissionRequest.RESOURCE_VIDEO_CAPTURE });
            else request.deny();
        }
    }

    @Override
    protected void onDestroy() {
        if (locationCallback != null) locationCallback.invoke(locationOrigin, false, false);
        locationCallback = null;
        if (cameraRequest != null) cameraRequest.deny();
        cameraRequest = null;
        super.onDestroy();
    }

    private boolean tenantOrigin(String origin) {
        if (origin == null || origin.isEmpty()) return false;
        return tenantOrigin(Uri.parse(origin));
    }

    private boolean tenantOrigin(Uri origin) {
        if (origin == null || !"https".equalsIgnoreCase(origin.getScheme())) return false;
        int port = origin.getPort();
        if (port != -1 && port != 443) return false;
        String host = getString(R.string.hostName);
        return host != null && !host.isEmpty() && host.equalsIgnoreCase(origin.getHost());
    }

    private void rememberLocation(String origin, GeolocationPermissions.Callback callback) {
        if (locationCallback != null) locationCallback.invoke(locationOrigin, false, false);
        locationOrigin = origin;
        locationCallback = callback;
    }

    private WebView findWebView(View view) {
        if (view instanceof WebView) return (WebView) view;
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int i = 0; i < group.getChildCount(); i++) {
                WebView found = findWebView(group.getChildAt(i));
                if (found != null) return found;
            }
        }
        return null;
    }

    private final class TenantChromeClient extends WebChromeClient {
        @Override
        public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
            if (!tenantOrigin(origin)) {
                callback.invoke(origin, false, false);
                return;
            }
            if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                callback.invoke(origin, true, false);
                return;
            }
            rememberLocation(origin, callback);
            requestPermissions(new String[] { Manifest.permission.ACCESS_FINE_LOCATION }, REQ_LOCATION);
        }

        @Override
        public void onPermissionRequest(PermissionRequest request) {
            if (request == null) return;
            boolean camera = false;
            String[] resources = request.getResources();
            if (resources != null) {
                for (String resource : resources) {
                    if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) camera = true;
                }
            }
            if (!camera || !tenantOrigin(request.getOrigin())) {
                request.deny();
                return;
            }
            if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                request.grant(new String[] { PermissionRequest.RESOURCE_VIDEO_CAPTURE });
                return;
            }
            if (cameraRequest != null) cameraRequest.deny();
            cameraRequest = request;
            requestPermissions(new String[] { Manifest.permission.CAMERA }, REQ_CAMERA);
        }
    }
}
