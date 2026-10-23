package fr.picotrack.pad;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothSocket;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.widget.Toast;

import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Envoi direct d'étiquettes ZPL depuis le PAD (lien picotrack-print://, ouvert par la page PicoTrack).
 * Bluetooth : RFCOMM SPP vers une imprimante déjà appairée. TCP/IP : socket brut (port 9100 en général).
 *
 * Garde-fous : contenu ZPL uniquement (^XA ... ^XZ, 512 Ko max), TCP limité aux adresses IPv4 privées
 * du réseau local, Bluetooth limité aux appareils appairés, et confirmation de l'utilisateur au premier
 * envoi vers chaque imprimante (mémorisée sur la tablette).
 */
public class PrintActivity extends Activity {
    private static final UUID SPP = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private static final Pattern MAC = Pattern.compile("^[0-9A-F]{2}(:[0-9A-F]{2}){5}$");
    private static final Pattern IPV4 = Pattern.compile("^(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})$");
    private static final int MAX_BYTES = 512 * 1024;
    private static final int REQ_BT = 4201;
    private static final String PREFS = "pt_print_targets";

    private String conn;
    private String addr;
    private int port;
    private String name;
    private byte[] payload;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Intent intent = getIntent();
        if (intent == null) { done("Demande d'impression vide."); return; }
        conn = str(intent.getStringExtra("pt_conn"));
        addr = str(intent.getStringExtra("pt_addr")).trim();
        port = intent.getIntExtra("pt_port", 9100);
        name = str(intent.getStringExtra("pt_name"));
        if (name.length() > 60) name = name.substring(0, 60);
        String zpl = str(intent.getStringExtra("pt_zpl"));
        String trimmed = zpl.trim();
        if (!trimmed.startsWith("^XA") || !trimmed.endsWith("^XZ")) { done("Contenu refusé : seul le ZPL est accepté."); return; }
        payload = zpl.getBytes(StandardCharsets.UTF_8);
        if (payload.length > MAX_BYTES) { done("Étiquettes trop volumineuses."); return; }
        if ("bluetooth".equals(conn)) {
            addr = addr.toUpperCase().replace('-', ':');
            if (!MAC.matcher(addr).matches()) { done("Adresse Bluetooth invalide."); return; }
        } else if ("tcp".equals(conn)) {
            if (!privateIpv4(addr)) { done("Adresse IP refusée : seule une imprimante du réseau local (192.168.x.x, 10.x.x.x, 172.16-31.x.x) est acceptée."); return; }
            if (port < 1 || port > 65535) { done("Port invalide."); return; }
        } else {
            done("Type de connexion non pris en charge sur la tablette.");
            return;
        }
        confirmThenSend();
    }

    private static String str(String v) { return v == null ? "" : v; }

    static boolean privateIpv4(String ip) {
        java.util.regex.Matcher m = IPV4.matcher(ip);
        if (!m.matches()) return false;
        int[] o = new int[4];
        for (int i = 0; i < 4; i++) {
            o[i] = Integer.parseInt(m.group(i + 1));
            if (o[i] > 255) return false;
        }
        return o[0] == 10 || (o[0] == 172 && o[1] >= 16 && o[1] <= 31) || (o[0] == 192 && o[1] == 168);
    }

    private String targetKey() { return conn + "|" + addr + "|" + ("tcp".equals(conn) ? port : 0); }

    private void confirmThenSend() {
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        if (prefs.getBoolean(targetKey(), false)) { start(); return; }
        String where = "bluetooth".equals(conn) ? "Bluetooth " + addr : addr + ":" + port;
        new AlertDialog.Builder(this)
                .setTitle("Imprimer depuis PicoTrack ?")
                .setMessage("Autoriser l'envoi d'étiquettes vers « " + name + " » (" + where + ") ? Ce choix est mémorisé pour cette imprimante.")
                .setPositiveButton("Autoriser", (d, w) -> {
                    prefs.edit().putBoolean(targetKey(), true).apply();
                    start();
                })
                .setNegativeButton("Annuler", (d, w) -> done("Impression annulée."))
                .setOnCancelListener(d -> done("Impression annulée."))
                .show();
    }

    private void start() {
        if ("bluetooth".equals(conn) && Build.VERSION.SDK_INT >= 31
                && checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] { Manifest.permission.BLUETOOTH_CONNECT }, REQ_BT);
            return;
        }
        sendInBackground();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQ_BT) return;
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) sendInBackground();
        else done("Autorisation « Appareils à proximité » refusée : impossible d'imprimer en Bluetooth.");
    }

    private void sendInBackground() {
        Toast.makeText(this, "Envoi à « " + name + " »…", Toast.LENGTH_SHORT).show();
        new Thread(() -> {
            String result;
            try {
                if ("bluetooth".equals(conn)) sendBluetooth(); else sendTcp();
                result = "Étiquette envoyée à « " + name + " ».";
            } catch (SecurityException e) {
                result = "Autorisation Bluetooth manquante.";
            } catch (Exception e) {
                result = "Échec de l'impression : " + (e.getMessage() == null ? "imprimante injoignable." : e.getMessage());
            }
            final String msg = result;
            new Handler(Looper.getMainLooper()).post(() -> done(msg));
        }, "pt-print").start();
    }

    private void sendTcp() throws Exception {
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress(addr, port), 5000);
            socket.setSoTimeout(5000);
            OutputStream out = socket.getOutputStream();
            out.write(payload);
            out.flush();
        } catch (java.net.SocketTimeoutException e) {
            throw new Exception("délai dépassé (" + addr + ":" + port + ").");
        } catch (java.net.ConnectException e) {
            throw new Exception("connexion refusée (" + addr + ":" + port + ").");
        }
    }

    private void sendBluetooth() throws Exception {
        BluetoothManager manager = (BluetoothManager) getSystemService(BLUETOOTH_SERVICE);
        BluetoothAdapter adapter = manager == null ? null : manager.getAdapter();
        if (adapter == null) throw new Exception("pas de Bluetooth sur cet appareil.");
        if (!adapter.isEnabled()) throw new Exception("Bluetooth désactivé.");
        BluetoothDevice device = null;
        for (BluetoothDevice d : adapter.getBondedDevices()) {
            if (addr.equalsIgnoreCase(d.getAddress())) { device = d; break; }
        }
        if (device == null) throw new Exception("imprimante non appairée. Appairez-la dans les réglages Bluetooth d'Android.");
        adapter.cancelDiscovery();
        BluetoothSocket socket;
        try {
            socket = device.createRfcommSocketToServiceRecord(SPP);
            socket.connect();
        } catch (java.io.IOException first) {
            socket = device.createInsecureRfcommSocketToServiceRecord(SPP);
            socket.connect();
        }
        try {
            OutputStream out = socket.getOutputStream();
            out.write(payload);
            out.flush();
            // Laisse le temps à l'imprimante de lire le flux avant la fermeture du canal.
            Thread.sleep(600);
        } finally {
            socket.close();
        }
    }

    private void done(String message) {
        Toast.makeText(getApplicationContext(), message, Toast.LENGTH_LONG).show();
        finish();
    }
}
