package com.zequn.nianban;
import org.json.*;
public class WidgetTasksTest {
  static int n;static void check(boolean ok,String label){if(!ok)throw new AssertionError(label);n++;System.out.println("PASS "+label);}
  public static void main(String[]args)throws Exception{
    JSONObject daily=new JSONObject("{\"id\":\"daily\",\"title\":\"Read\",\"dueDate\":\"2026-10-22\",\"dueTime\":\"21:00\",\"recurrence\":\"daily\",\"status\":\"todo\",\"completedDates\":[]}");
    JSONObject one=new JSONObject("{\"id\":\"once\",\"dueDate\":\"2026-10-22\",\"dueTime\":\"15:00\",\"recurrence\":\"none\",\"status\":\"todo\"}");
    JSONObject state=new JSONObject().put("tasks",new JSONArray().put(daily).put(one));
    check(WidgetTasks.onDay(state,"2026-10-22").get(0)==one,"time sorting");
    check(WidgetTasks.setDone(state,"daily","2026-10-22",true),"complete repeating occurrence");
    WidgetTasks.setDone(state,"daily","2026-10-22",true);
    check(daily.getJSONArray("completedDates").length()==1,"double tap is idempotent");
    check(WidgetTasks.done(daily,"2026-10-22")&&!WidgetTasks.done(daily,"2026-10-23"),"tomorrow not completed");
    check(!WidgetTasks.setDone(state,"daily","2026-10-21",true),"pre-start completion rejected");
    check(!WidgetTasks.setDone(state,"missing","2026-10-22",true),"deleted task not resurrected");
    WidgetTasks.setDone(state,"once","2026-10-22",true);check("done".equals(one.getString("status")),"one-shot status complete");
    JSONObject weekday=new JSONObject(daily.toString()).put("recurrence","weekdays");
    check(!WidgetTasks.occurs(weekday,"2026-10-24"),"weekend excluded");
    JSONObject weekly=new JSONObject(daily.toString()).put("recurrence","weekly").put("weekDay",4);
    check(WidgetTasks.occurs(weekly,"2026-10-29")&&!WidgetTasks.occurs(weekly,"2026-10-28"),"weekly day matched");
    check("2026-10-23".equals(WidgetTasks.today(java.time.Instant.parse("2026-10-22T16:01:00Z").toEpochMilli())),"Shanghai midnight");
    JSONObject old=new JSONObject().put("tasks",new JSONArray().put(new JSONObject(one.toString()).put("status","todo")));
    JSONObject fresh=new JSONObject().put("widgetRevision",1).put("widgetChanges",new JSONArray().put(new JSONObject().put("revision",1).put("id","once").put("date","2026-10-22").put("done",true)));
    WidgetTasks.mergeWidgetChanges(old,fresh);check("done".equals(old.getJSONArray("tasks").getJSONObject(0).getString("status")),"stale WebView cannot erase launcher completion");
    old.getJSONArray("tasks").getJSONObject(0).put("status","todo");WidgetTasks.mergeWidgetChanges(old,fresh);check("todo".equals(old.getJSONArray("tasks").getJSONObject(0).getString("status")),"already acknowledged completion does not override deliberate undo");
    JSONObject deleted=new JSONObject().put("tasks",new JSONArray());WidgetTasks.mergeWidgetChanges(deleted,fresh);check(deleted.getJSONArray("tasks").length()==0,"widget journal never resurrects deleted task");
    System.out.println(n+" widget task checks passed");
  }
}
