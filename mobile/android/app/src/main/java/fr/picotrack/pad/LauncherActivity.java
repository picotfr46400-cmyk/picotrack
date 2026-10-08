package fr.picotrack.pad;

import android.content.pm.ActivityInfo;
import android.os.Build;
import android.os.Bundle;

public class LauncherActivity extends com.google.androidbrowserhelper.trusted.LauncherActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Locking orientation on a translucent theme crashes Android 8.0 and below.
        if (Build.VERSION.SDK_INT > Build.VERSION_CODES.O) {
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_FULL_USER);
        }
    }
}
