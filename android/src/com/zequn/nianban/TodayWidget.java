package com.zequn.nianban;

import android.app.*;
import android.appwidget.*;
import android.content.*;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;
import org.json.*;
import java.util.*;

public class TodayWidget extends AppWidgetProvider {
    public static final String COMPLETE="com.zequn.nianban.WIDGET_COMPLETE";
    static final int[] ROW={R.id.widget_row1,R.id.widget_row2,R.id.widget_row3};
    static final int[] TITLE={R.id.widget_title1,R.id.widget_title2,R.id.widget_title3};
    static final int[] CHECK={R.id.widget_check1,R.id.widget_check2,R.id.widget_check3};
    public static void refresh(Context c){AppWidgetManager m=AppWidgetManager.getInstance(c);int[] ids=m.getAppWidgetIds(new ComponentName(c,TodayWidget.class));for(int id:ids)update(c,m,id);}
    static PendingIntent open(Context c,String action){Intent i=new Intent(c,MainActivity.class).setAction("com.zequn.nianban.OPEN."+action).putExtra("widgetAction",action).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(c,action.hashCode(),i,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);}
    static void update(Context c,AppWidgetManager m,int id){
        RemoteViews v=new RemoteViews(c.getPackageName(),R.layout.today_widget);String date=WidgetTasks.today(System.currentTimeMillis());
        try{
            JSONObject state=StateStore.read(c);List<JSONObject> tasks=WidgetTasks.onDay(state,date);int count=0;for(JSONObject t:tasks)if(WidgetTasks.done(t,date))count++;
            v.setTextViewText(R.id.widget_date,date.substring(5).replace('-','/')+" · 今天");
            v.setTextViewText(R.id.widget_progress,tasks.isEmpty()?"从一件小事开始":count+" / "+tasks.size()+" 已完成");
            v.setViewVisibility(R.id.widget_empty,tasks.isEmpty()?View.VISIBLE:View.GONE);
            int height=m.getAppWidgetOptions(id).getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT,240);int max=height<210?1:height<240?2:3;
            for(int n=0;n<3;n++){
                v.setViewVisibility(ROW[n],n<tasks.size()&&n<max?View.VISIBLE:View.GONE);if(n>=tasks.size()||n>=max)continue;
                JSONObject t=tasks.get(n);boolean done=WidgetTasks.done(t,date);String taskId=t.optString("id");
                v.setTextViewText(TITLE[n],(t.optString("dueTime").isEmpty()?"":t.optString("dueTime")+"  ")+t.optString("title"));
                v.setTextColor(TITLE[n],done?0xff8b968c:0xff203b33);v.setTextViewText(CHECK[n],done?"✓":"○");
                v.setContentDescription(CHECK[n],done?"已完成":"完成"+t.optString("title"));
                Intent intent=new Intent(c,TodayWidget.class).setAction(COMPLETE).setData(Uri.parse("nianban://complete/"+Uri.encode(taskId)+"/"+date)).putExtra("taskId",taskId).putExtra("date",date);
                v.setOnClickPendingIntent(CHECK[n],done?open(c,"today"):PendingIntent.getBroadcast(c,0,intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE));
                v.setOnClickPendingIntent(TITLE[n],open(c,"today"));
            }
            v.setTextViewText(R.id.widget_more,tasks.size()>max?"查看全部 "+tasks.size()+" 项 ›":"打开清单 ›");
        }catch(Exception e){v.setTextViewText(R.id.widget_progress,"打开念办，刷新清单");}
        v.setOnClickPendingIntent(R.id.widget_add,open(c,"add"));v.setOnClickPendingIntent(R.id.widget_more,open(c,"today"));v.setOnClickPendingIntent(R.id.widget_brand,open(c,"today"));m.updateAppWidget(id,v);
    }
    @Override public void onUpdate(Context c,AppWidgetManager m,int[] ids){for(int id:ids)update(c,m,id);}
    @Override public void onAppWidgetOptionsChanged(Context c,AppWidgetManager m,int id,Bundle options){update(c,m,id);}
    @Override public void onReceive(Context c,Intent i){super.onReceive(c,i);if(COMPLETE.equals(i.getAction())){try{if(StateStore.complete(c,i.getStringExtra("taskId"),i.getStringExtra("date")))ReminderEngine.sync(c);}catch(Exception ignored){}refresh(c);}}
}
