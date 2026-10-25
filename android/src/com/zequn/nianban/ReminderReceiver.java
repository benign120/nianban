package com.zequn.nianban;
import android.content.*;
import org.json.*;
public class ReminderReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        String id = intent.getStringExtra("taskId"); if (id == null) return;
        JSONArray tasks = ReminderEngine.tasks(context);
        for (int i=0;i<tasks.length();i++) { JSONObject task = tasks.optJSONObject(i); if (task != null && id.equals(task.optString("id")) && !"done".equals(task.optString("status"))) { ReminderEngine.notifyTask(context, ReminderEngine.key(id), task.optString("title", "该做这件事啦"), "你给自己安排的小事，到时间了。点开念办查看。"); break; } }
        ReminderEngine.sync(context);
    }
}
