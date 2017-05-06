package com.rctwebrtcdemo;

import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.widget.TextView;
import android.widget.Toast;

import com.facebook.react.bridge.Callback;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.modules.core.DeviceEventManagerModule;

import static android.content.Context.SENSOR_SERVICE;

/**
 * Created by arvindthangamani on 06/05/17.
 */

public class TiltActivity extends ReactContextBaseJavaModule {
    SensorManager sensorManager;
    public TiltActivity(ReactApplicationContext reactContext) {
        super(reactContext);
    }
    @Override
    public String getName() {
        return "TiltActivity";
    }
    @ReactMethod
    public void listenToTheTilt() {
        sensorManager = (SensorManager) getReactApplicationContext().getSystemService(SENSOR_SERVICE);
        rotationVector();
    }

    private void rotationVector() {
        final Sensor rotationVector = sensorManager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR);
        if (rotationVector == null) {
            Toast.makeText(super.getReactApplicationContext(), "Rotation Vector not available.", Toast.LENGTH_LONG).show();
        } else {
            sensorManager.registerListener(new MyListener(), rotationVector, SensorManager.SENSOR_DELAY_NORMAL);
        }
    }

    private class MyListener implements SensorEventListener {


        MyListener() {
        }

        @Override
        public void onSensorChanged(SensorEvent event) {
            float[] rotationMatrix = new float[16];
            SensorManager.getRotationMatrixFromVector(rotationMatrix, event.values);

            // Convert to orientations
            float[] orientationsInRadian = new float[3];
            SensorManager.getOrientation(rotationMatrix, orientationsInRadian);

            double[] orientationsInDegrees = new double[3];
            for (int i = 0; i < 3; i++) {
                orientationsInDegrees[i] = (Math.toDegrees(orientationsInRadian[i]));
            }
            getReactApplicationContext().getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                    .emit("EVENT_TAG", orientationsInDegrees[2]);
        }

        @Override
        public void onAccuracyChanged(Sensor sensor, int accuracy) {

        }
    }

    public static void setTimeout(final Runnable runnable, final int delay){
        new Thread(){
            @Override
            public void run() {
                try {
                    Thread.sleep(delay);
                    runnable.run();
                } catch (InterruptedException e) {
                    e.printStackTrace();
                }
            }
        }.start();
    }
}
