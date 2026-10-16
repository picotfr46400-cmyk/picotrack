package fr.picotrack.pad;

import android.content.Intent;

import com.google.androidbrowserhelper.trusted.LauncherActivityMetadata;
import com.google.androidbrowserhelper.trusted.TwaLauncher;

// Orientation is declared in AndroidManifest.xml (screenOrientation="fullUser")
// instead of being requested at runtime.
public class LauncherActivity extends com.google.androidbrowserhelper.trusted.LauncherActivity {
    @Override
    protected TwaLauncher.FallbackStrategy getFallbackStrategy() {
        return (context, twaBuilder, providerPackage, completionCallback) -> {
            Intent intent = com.google.androidbrowserhelper.trusted.WebViewFallbackActivity.createLaunchIntent(
                    context, twaBuilder.getUri(), LauncherActivityMetadata.parse(context));
            intent.setClass(context, WebViewFallbackActivity.class);
            context.startActivity(intent);
            if (completionCallback != null) completionCallback.run();
        };
    }
}
