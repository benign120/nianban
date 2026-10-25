package com.zequn.nianban;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.os.Build;
import org.json.*;
import java.text.SimpleDateFormat;
import java.util.*;

public class ReminderEngine {
    public static final String CHANNEL = "nianban-tasks";
    static int key(String id) { return id.hashCode() & 0x7fffffff; }
    static JSONArray tasks(Context c) { try { return new JSONArray(c.getSharedPreferences("reminders", 0).getString("tasks", "[]")); } catch (Exception e) { return new JSONArray(); } }
    public static void createChannel(Context c) { NotificationChannel channel = new NotificationChannel(CHANNEL, "念办任务提醒", NotificationManager.IMPORTANCE_HIGH); channel.setDescription("你亲自安排的任务和每日提醒"); c.getSystemService(NotificationManager.class).createNotificationChannel(channel); }
    static PendingIntent alarmIntent(Context c, String id) { Intent intent = new Intent(c, ReminderReceiver.class); intent.setAction("com.zequn.nianban.REMIND." + id); intent.putExtra("taskId", id); return PendingIntent.getBroadcast(c, key(id), intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE); }
    static String day(Calendar cal) { SimpleDateFormat fmt = new SimpleDateFormat("yyyy-MM-dd", Locale.US); fmt.setTimeZone(cal.getTimeZone()); return fmt.format(cal.getTime()); }
    public static long nextTime(JSONObject t, long now) {
        try {
            String date = t.optString("dueDate"), time = t.optString("dueTime"), recurrence = t.optString("recurrence", "none");
            if (date.isEmpty() || time.isEmpty() || "done".equals(t.optString("status"))) return -1;
            SimpleDateFormat parse = new SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US); parse.setLenient(false); parse.setTimeZone(TimeZone.getTimeZone("Asia/Shanghai"));
            Calendar start = Calendar.getInstance(TimeZone.getTimeZone("Asia/Shanghai")); start.setTime(parse.parse(date + " " + time));
            if ("none".equals(recurrence)) return start.getTimeInMillis() > now ? start.getTimeInMillis() : -1;
            Calendar candidate = Calendar.getInstance(start.getTimeZone()); candidate.setTimeInMillis(now);
            candidate.set(Calendar.HOUR_OF_DAY, start.get(Calendar.HOUR_OF_DAY)); candidate.set(Calendar.MINUTE, start.get(Calendar.MINUTE)); candidate.set(Calendar.SECOND, 0); candidate.set(Calendar.MILLISECOND, 0);
            if (candidate.before(start)) candidate.setTimeInMillis(start.getTimeInMillis());
            JSONArray completed = t.optJSONArray("completedDates"); Set<String> done = new HashSet<>(); if (completed != null) for (int i=0;i<completed.length();i++) done.add(completed.optString(i));
            for (int i=0; i<370; i++) {
                int weekday = candidate.get(Calendar.DAY_OF_WEEK) - 1;
                boolean matches = "daily".equals(recurrence) || ("weekdays".equals(recurrence) && weekday >= 1 && weekday <= 5) || ("weekly".equals(recurrence) && weekday == t.optInt("weekDay", -1));
                if (matches && candidate.getTimeInMillis() > now && !done.contains(day(candidate))) return candidate.getTimeInMillis();
                candidate.add(Calendar.DAY_OF_MONTH, 1);
            }
        } catch (Exception e) { }
        return -1;
    }
    public static boolean notificationsEnabled(Context c) { return c.getSystemService(NotificationManager.class).areNotificationsEnabled() && (Build.VERSION.SDK_INT < 33 || c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED); }
    public static boolean exactEnabled(Context c) { return Build.VERSION.SDK_INT < 31 || c.getSystemService(AlarmManager.class).canScheduleExactAlarms(); }
    public static JSONObject status(Context c) { JSONObject value = new JSONObject(); try { value.put("native", true); value.put("notifications", notificationsEnabled(c)); value.put("exact", exactEnabled(c)); } catch(Exception e) { } return value; }
    public static void sync(Context c) {
        AlarmManager manager = c.getSystemService(AlarmManager.class);
        android.content.SharedPreferences prefs = c.getSharedPreferences("reminders", 0);
        Set<String> old = prefs.getStringSet("scheduled", new HashSet<String>());
        for (String id : old) manager.cancel(alarmIntent(c, id));
        Set<String> active = new HashSet<>(); JSONArray tasks = tasks(c);
        if (notificationsEnabled(c)) for (int i=0;i<tasks.length();i++) {
            JSONObject task = tasks.optJSONObject(i); if (task == null) continue;
            String id = task.optString("id"); long at = nextTime(task, System.currentTimeMillis());
            if (id.isEmpty() || at < 0) continue;
            try { if (exactEnabled(c)) manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, alarmIntent(c, id)); else manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, alarmIntent(c, id)); active.add(id); } catch (SecurityException e) { manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, alarmIntent(c, id)); active.add(id); }
        }
        prefs.edit().putStringSet("scheduled", active).apply();
    }
    public static void notifyTask(Context c, int id, String title, String message) {
        if (!notificationsEnabled(c)) return; createChannel(c);
        Intent open = new Intent(c, MainActivity.class); open.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pending = PendingIntent.getActivity(c, id, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification notification = new Notification.Builder(c, CHANNEL).setSmallIcon(com.zequn.nianban.R.drawable.ic_notification).setContentTitle(title).setContentText(message).setStyle(new Notification.BigTextStyle().bigText(message)).setContentIntent(pending).setAutoCancel(true).setCategory(Notification.CATEGORY_REMINDER).build();
        c.getSystemService(NotificationManager.class).notify(id, notification);
    }
}
