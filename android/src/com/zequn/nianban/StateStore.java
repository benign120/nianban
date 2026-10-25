package com.zequn.nianban;

import android.content.*;
import org.json.*;

/** Keeps existing MainActivity preferences compatible; widget writes cannot be lost to a stale WebView. */
public final class StateStore {
    private static SharedPreferences prefs(Context c){return c.getSharedPreferences("MainActivity",Context.MODE_PRIVATE);}
    public static synchronized String load(Context c){return prefs(c).getString("state", "");}
    public static synchronized JSONObject read(Context c)throws JSONException{
        String raw=load(c);return raw.isEmpty()?new JSONObject().put("tasks",new JSONArray()).put("history",new JSONArray()):new JSONObject(raw);
    }
    public static synchronized String save(Context c,String raw)throws Exception{
        if(raw==null||raw.length()>5000000)throw new IllegalArgumentException("任务数据过大");
        JSONObject value=new JSONObject(raw);if(value.optJSONArray("tasks")==null)throw new IllegalArgumentException("任务数据无效");
        WidgetTasks.mergeWidgetChanges(value,read(c));value.put("settings",new JSONObject());
        if(!prefs(c).edit().putString("state",value.toString()).commit())throw new IllegalStateException("保存失败");
        return value.toString();
    }
    public static synchronized boolean complete(Context c,String id,String date)throws Exception{
        if(!WidgetTasks.today(System.currentTimeMillis()).equals(date))return false; // expired launcher PendingIntent
        JSONObject value=read(c);if(!WidgetTasks.setDone(value,id,date,true))return false;
        long revision=value.optLong("widgetRevision",0)+1;JSONArray old=value.optJSONArray("widgetChanges"),log=new JSONArray();
        if(old!=null)for(int i=Math.max(0,old.length()-127);i<old.length();i++)log.put(old.get(i));
        log.put(new JSONObject().put("revision",revision).put("id",id).put("date",date).put("done",true));
        value.put("widgetRevision",revision).put("widgetChanges",log);
        if(!prefs(c).edit().putString("state",value.toString()).commit())return false;
        c.getSharedPreferences("reminders",0).edit().putString("tasks",value.getJSONArray("tasks").toString()).commit();
        return true;
    }
}
