package com.zequn.nianban;

import org.json.*;
import java.util.*;
import java.text.SimpleDateFormat;

/** Pure task projection shared by the launcher widget and JVM regression tests. */
public final class WidgetTasks {
    public static String today(long now) {
        SimpleDateFormat f=new SimpleDateFormat("yyyy-MM-dd",Locale.US);
        f.setTimeZone(TimeZone.getTimeZone("Asia/Shanghai"));return f.format(new Date(now));
    }
    public static boolean occurs(JSONObject t,String date) {
        String start=t.optString("dueDate"), repeat=t.optString("recurrence","none");
        if(start.isEmpty()||date.compareTo(start)<0)return false;
        if("daily".equals(repeat))return true;
        Calendar c=Calendar.getInstance(TimeZone.getTimeZone("Asia/Shanghai"));
        try {SimpleDateFormat f=new SimpleDateFormat("yyyy-MM-dd",Locale.US);f.setTimeZone(c.getTimeZone());f.setLenient(false);c.setTime(f.parse(date));}catch(Exception e){return false;}
        int day=c.get(Calendar.DAY_OF_WEEK)-1;
        if("weekdays".equals(repeat))return day>=1&&day<=5;
        if("weekly".equals(repeat))return day==t.optInt("weekDay",-1);
        return date.equals(start);
    }
    public static boolean done(JSONObject t,String date) {
        if("none".equals(t.optString("recurrence","none")))return "done".equals(t.optString("status"));
        JSONArray dates=t.optJSONArray("completedDates");
        if(dates!=null)for(int i=0;i<dates.length();i++)if(date.equals(dates.optString(i)))return true;
        return false;
    }
    public static boolean setDone(JSONObject state,String id,String date,boolean completed) throws JSONException {
        JSONArray tasks=state.optJSONArray("tasks");if(tasks==null)return false;
        for(int i=0;i<tasks.length();i++){
            JSONObject t=tasks.optJSONObject(i);if(t==null||!id.equals(t.optString("id")))continue;
            if(!occurs(t,date))return false;
            if("none".equals(t.optString("recurrence","none")))t.put("status",completed?"done":"todo");
            else {JSONArray old=t.optJSONArray("completedDates"),next=new JSONArray();
                if(old!=null)for(int j=0;j<old.length();j++)if(!date.equals(old.optString(j)))next.put(old.optString(j));
                if(completed)next.put(date);t.put("completedDates",next);}
            t.put("updatedAt",new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSXXX",Locale.US).format(new Date()));
            return true;
        }return false;
    }
    public static void mergeWidgetChanges(JSONObject incoming,JSONObject current)throws JSONException{
        long seen=incoming.optLong("widgetRevision",0),revision=current.optLong("widgetRevision",0);
        JSONArray changes=current.optJSONArray("widgetChanges");
        if(changes!=null)for(int i=0;i<changes.length();i++){JSONObject e=changes.getJSONObject(i);if(e.getLong("revision")>seen)setDone(incoming,e.getString("id"),e.getString("date"),e.getBoolean("done"));}
        incoming.put("widgetRevision",revision).put("widgetChanges",changes==null?new JSONArray():changes);
    }
    public static List<JSONObject> onDay(JSONObject state,String date) {
        List<JSONObject> list=new ArrayList<>();JSONArray tasks=state.optJSONArray("tasks");
        if(tasks!=null)for(int i=0;i<tasks.length();i++){JSONObject t=tasks.optJSONObject(i);if(t!=null&&occurs(t,date)&&!"archived".equals(t.optString("status")))list.add(t);}
        Collections.sort(list,(a,b)->{int d=Boolean.compare(done(a,date),done(b,date));if(d!=0)return d;
            String at=a.optString("dueTime"),bt=b.optString("dueTime");return (at.isEmpty()?"99":at).compareTo(bt.isEmpty()?"99":bt);});return list;
    }
}
