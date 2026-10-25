package com.zequn.nianban;
import org.json.JSONObject;
import java.time.*;

public class ReminderClockTest {
    static long at(String value) { return LocalDateTime.parse(value).atZone(ZoneId.of("Asia/Shanghai")).toInstant().toEpochMilli(); }
    static void same(String name, long expected, long actual) { if (expected != actual) throw new AssertionError(name + ": " + expected + " != " + actual); System.out.println("PASS " + name); }
    static JSONObject task(String date, String time, String recurrence) { return new JSONObject().put("dueDate",date).put("dueTime",time).put("recurrence",recurrence).put("status","todo"); }
    public static void main(String[] args) {
        long now = at("2026-10-20T10:00:00");
        same("one-shot future",at("2026-10-20T15:00:00"),ReminderEngine.nextTime(task("2026-10-20","15:00","none"),now));
        same("past one-shot ignored",-1,ReminderEngine.nextTime(task("2026-10-19","15:00","none"),now));
        same("no time is not a reminder",-1,ReminderEngine.nextTime(task("2026-10-20","","none"),now));
        same("completed one-shot ignored",-1,ReminderEngine.nextTime(task("2026-10-20","15:00","none").put("status","done"),now));
        same("daily advances after today's time",at("2026-10-21T09:00:00"),ReminderEngine.nextTime(task("2026-10-19","09:00","daily"),now));
        same("daily skips completed day",at("2026-10-21T15:00:00"),ReminderEngine.nextTime(task("2026-10-19","15:00","daily").put("completedDates",new org.json.JSONArray().put("2026-10-20")),now));
        same("weekdays skip weekend",at("2026-10-26T09:00:00"),ReminderEngine.nextTime(task("2026-10-19","09:00","weekdays"),at("2026-10-23T10:00:00")));
        same("weekly respects weekday",at("2026-10-23T15:00:00"),ReminderEngine.nextTime(task("2026-10-20","15:00","weekly").put("weekDay",5),now));
        same("future recurrence start respected",at("2026-11-02T09:00:00"),ReminderEngine.nextTime(task("2026-11-02","09:00","daily"),now));
        same("invalid date ignored",-1,ReminderEngine.nextTime(task("2026-02-30","09:00","none"),now));
    }
}
