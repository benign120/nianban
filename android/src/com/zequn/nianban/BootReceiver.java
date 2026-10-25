package com.zequn.nianban;
import android.content.*;
public class BootReceiver extends BroadcastReceiver { @Override public void onReceive(Context c, Intent intent) { ReminderEngine.sync(c); TodayWidget.refresh(c); } }
