package khata.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.ServiceWorkerClient;
import android.webkit.ServiceWorkerController;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

/**
 * Single-activity host for the deployed Khata PWA.
 *
 * The whole UI is the web app, so this class is deliberately thin: it configures
 * a WebView that behaves like a browser, makes the hardware back button
 * meaningful for a single-page app, and hands the browser's own share/save
 * plumbing back to the system.
 */
public class MainActivity extends Activity {

    private static final String APP_URL = "https://rajputnaresh.github.io/khata/";

    /**
     * Click a `[aria-label="Close"]` control if the page has a modal open. The
     * app's transaction editor and category sheets are `role="dialog"` nodes
     * with a Close button; without this, the back button would drop straight out
     * of the app and lose the half-filled form.
     */
    private static final String CLOSE_MODAL_JS =
            "(function(){var d=document.querySelector('[role=\"dialog\"]');"
            + "if(!d)return 'none';"
            + "var b=d.querySelector('[aria-label=\"Close\"]')"
            + "||d.querySelector('header button:last-of-type')"
            + "||d.querySelector('button:last-of-type');"
            + "if(!b)return 'no-button';b.click();return 'closed';})()";

    private WebView web;
    /** Set while a modal-close probe is in flight, so back is not double-fired. */
    private boolean probingBack;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        FrameLayout root = new FrameLayout(this);
        root.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        web = new WebView(this);
        web.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        root.addView(web);
        setContentView(root);

        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState);
        } else {
            configure();
            web.loadUrl(APP_URL);
        }
    }

    private void configure() {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        // Khata keeps settings and theme in localStorage and its ledger in
        // IndexedDB (Dexie). Without DOM storage both silently reset to defaults
        // on every launch.
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        // A local-first app needs the service worker to survive with no network.
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // The app is served over https from a known host; Safe Browsing adds
            // a network round trip and can block the app on a flaky connection.
            s.setSafeBrowsingEnabled(false);
        }

        // Service workers are permitted by default; the controller plus a client
        // is what actually lets the Workbox SW serve the app with no network.
        // There is no setAllowServiceWorker() on ServiceWorkerWebSettings
        // (verified against android-35's android.jar) -- do not add one.
        ServiceWorkerController swc = ServiceWorkerController.getInstance();
        swc.setServiceWorkerClient(new ServiceWorkerClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                // Returning null lets the service worker answer; this hook is
                // required for the app to be reachable while fully offline.
                return null;
            }
        });

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                // Keep navigation on the app's own origin inside the WebView so
                // history and the IndexedDB origin stay consistent; send OAuth
                // and other external flows to the system browser.
                if (isAppHost(uri.getHost())) {
                    return false;
                }
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "No app can open this link",
                            Toast.LENGTH_SHORT).show();
                }
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient());
    }

    private static boolean isAppHost(String host) {
        if (host == null) {
            return false;
        }
        return "rajputnaresh.github.io".equals(host)
                || "accounts.google.com".equals(host); // Drive backup OAuth
    }

    /**
     * Back, in priority order: close an open sheet/dialog, then step back through
     * WebView history, then leave the app. The first two steps are asynchronous
     * because the modal probe has to round-trip through the page.
     */
    @Override
    public void onBackPressed() {
        if (web == null || probingBack) {
            return;
        }
        probingBack = true;
        web.evaluateJavascript(CLOSE_MODAL_JS, value -> {
            probingBack = false;
            if (value != null && value.contains("closed")) {
                return; // the page handled it
            }
            if (web != null && web.canGoBack()) {
                web.goBack();
                return;
            }
            // Nothing to go back to: fall through to the default (finish).
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                MainActivity.super.onBackPressed();
            } else {
                MainActivity.super.onKeyDown(KeyEvent.KEYCODE_BACK, new KeyEvent(
                        KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_BACK));
            }
        });
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && web != null && web.canGoBack()) {
            web.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (web != null) {
            web.saveState(outState);
        }
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
