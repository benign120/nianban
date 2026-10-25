package com.zequn.nianban;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.AlarmManager;
import android.app.NotificationManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.text.InputType;
import android.text.InputFilter;
import android.view.WindowManager;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.Toast;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import org.json.JSONArray;
import org.json.JSONObject;
import org.vosk.Model;
import org.vosk.Recognizer;
import org.vosk.android.RecognitionListener;
import org.vosk.android.SpeechService;
import java.io.*;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.atomic.AtomicBoolean;

public class MainActivity extends Activity implements RecognitionListener {
    private WebView web;
    private volatile Model model;
    private volatile boolean destroyed = false;
    private volatile String modelError = "";
    private SpeechService speech;
    private Recognizer recognizer;
    private boolean voiceActive = false, startAfterModel = false;
    private String exportContent = "";
    private ApiKeyStore apiKeyStore;
    private DeepSeekClient apiClient;
    private ApiKeyStore weixinStore;
    private ApiKeyStore buddyStore;
    private final ExecutorService buddyExecutor=Executors.newSingleThreadExecutor();
    private final AtomicBoolean buddyActive=new AtomicBoolean(false);
    private final ExecutorService syncExecutor=Executors.newSingleThreadExecutor();
    private final AtomicBoolean syncActive=new AtomicBoolean(false);
    private final ExecutorService aiExecutor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean aiActive = new AtomicBoolean(false);
    private static final int AUDIO_REQUEST = 11, NOTIFICATION_REQUEST = 12, EXPORT_REQUEST = 13;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        apiKeyStore = new ApiKeyStore(this);
        apiClient = new DeepSeekClient(apiKeyStore);
        weixinStore=new ApiKeyStore(this,"nianban_weixin_sync_v1","weixin_sync_credentials");
        buddyStore=new ApiKeyStore(this,"nianban_buddy_v1","buddy_credentials");
        getWindow().setStatusBarColor(0xfff5f6f0);
        getWindow().setNavigationBarColor(0xfffbfcf8);
        getWindow().getDecorView().setSystemUiVisibility(android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        web = new WebView(this);
        web.setBackgroundColor(0xfff5f6f0);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setTextZoom(100);
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!"appassets.androidplatform.net".equals(uri.getHost())) return super.shouldInterceptRequest(view, request);
                String name = uri.getPath();
                if (name == null || name.contains("..")) return null;
                if (name.equals("/")) name = "/index.html";
                name = name.substring(1);
                String type = name.endsWith(".html") ? "text/html" : name.endsWith(".css") ? "text/css" : name.endsWith(".js") ? "text/javascript" : name.endsWith(".svg") ? "image/svg+xml" : "text/plain";
                try { return new WebResourceResponse(type, "UTF-8", getAssets().open("web/" + name)); }
                catch (IOException e) { return new WebResourceResponse("text/plain", "UTF-8", 404, "Not found", null, new ByteArrayInputStream(new byte[0])); }
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return !"appassets.androidplatform.net".equals(request.getUrl().getHost()); }
        });
        web.addJavascriptInterface(new Bridge(), "NativeBridge");
        setContentView(web);
        ReminderEngine.createChannel(this);
        web.loadUrl("https://appassets.androidplatform.net/index.html");
        new Thread(() -> {
            try {
                File folder = new File(getFilesDir(), "voice-cn-022");
                File marker = new File(folder, ".ready");
                if (!marker.exists()) {
                    folder.mkdirs();
                    try (ZipInputStream input = new ZipInputStream(getAssets().open("voice-model.zip"))) {
                        ZipEntry entry;
                        while ((entry = input.getNextEntry()) != null) {
                            String name = entry.getName(); int slash = name.indexOf('/'); if (slash >= 0) name = name.substring(slash + 1);
                            if (name.isEmpty()) continue;
                            File out = new File(folder, name);
                            if (!out.getCanonicalPath().startsWith(folder.getCanonicalPath() + File.separator)) throw new IOException("Invalid model archive");
                            if (entry.isDirectory()) out.mkdirs();
                            else { out.getParentFile().mkdirs(); try (OutputStream stream = new FileOutputStream(out)) { byte[] buffer = new byte[65536]; int len; while ((len = input.read(buffer)) != -1) stream.write(buffer, 0, len); } }
                        }
                    }
                    if (!new File(folder, "am/final.mdl").exists()) throw new IOException("Incomplete model");
                    marker.createNewFile();
                }
                System.setProperty("jna.boot.library.path", getApplicationInfo().nativeLibraryDir);
                final Model loaded = new Model(folder.getAbsolutePath());
                runOnUiThread(() -> { if (destroyed) { loaded.close(); return; } model = loaded; if (startAfterModel) { startAfterModel = false; beginVoice(); } });
            } catch (Throwable e) { modelError = "离线语音准备失败，可以先使用文字输入。请确认手机有足够存储空间。"; runOnUiThread(() -> { if (!destroyed && startAfterModel) { startAfterModel = false; emit("voice-error", "message", modelError); } }); }
        }, "nianban-voice-init").start();
    }

    public class Bridge {
        @JavascriptInterface public String loadState() { return StateStore.load(MainActivity.this); }
        @JavascriptInterface public String saveStateV2(String value) { try {String saved=StateStore.save(MainActivity.this,value);runOnUiThread(()->TodayWidget.refresh(MainActivity.this));return saved;}catch(Exception e){return "";} }
        @JavascriptInterface public boolean saveState(String value) { return !saveStateV2(value).isEmpty(); }
        @JavascriptInterface public String widgetAction(){String action=getIntent().getStringExtra("widgetAction");getIntent().removeExtra("widgetAction");return action==null?"":action;}
        @JavascriptInterface public void addWidget(){runOnUiThread(()->{android.appwidget.AppWidgetManager manager=android.appwidget.AppWidgetManager.getInstance(MainActivity.this);if(manager.isRequestPinAppWidgetSupported())manager.requestPinAppWidget(new android.content.ComponentName(MainActivity.this,TodayWidget.class),null,null);else Toast.makeText(MainActivity.this,"请长按桌面空白处，打开窗口小工具，选择念办",Toast.LENGTH_LONG).show();});}
        @JavascriptInterface public String buddyStatus(){return "{\"configured\":"+buddyStore.hasKey()+"}";}
        @JavascriptInterface public void configureBuddy(){runOnUiThread(()->showBuddyDialog());}
        @JavascriptInterface public void editBuddyEndpoint(){runOnUiThread(()->{
            if(!buddyStore.hasKey()){showBuddyDialog();return;}
            try{JSONObject old=new JSONObject(buddyStore.readKey());EditText input=new EditText(MainActivity.this);input.setSingleLine(true);input.setText(old.getString("endpoint"));
                new AlertDialog.Builder(MainActivity.this).setTitle("检查搭子服务地址").setMessage("用于修正同一个服务的地址；请使用部署者提供的 HTTPS 地址。这里不会更换你的设备身份。").setView(input).setNegativeButton("取消",null).setPositiveButton("保存",(d,w)->{try{old.put("endpoint",BuddyClient.endpoint(input.getText().toString()));buddyStore.save(old.toString());emit("buddy-status","message","服务地址已更新");}catch(Exception e){Toast.makeText(MainActivity.this,"地址无效，请填写 HTTPS 云服务地址",Toast.LENGTH_LONG).show();}}).show();
            }catch(Exception e){Toast.makeText(MainActivity.this,"配置无法读取",Toast.LENGTH_LONG).show();}
        });}
        @JavascriptInterface public void copyBuddyInvite(String code){if(code!=null&&code.matches("[a-f0-9]{32}"))runOnUiThread(()->{android.content.ClipboardManager clipboard=(android.content.ClipboardManager)getSystemService(CLIPBOARD_SERVICE);clipboard.setPrimaryClip(android.content.ClipData.newPlainText("念办搭子邀请码",code));Toast.makeText(MainActivity.this,"邀请码已复制",Toast.LENGTH_SHORT).show();});}
        @JavascriptInterface public void buddyRequest(String requestId,String raw){submitBuddy(requestId,raw);}
        @JavascriptInterface public String apiStatus() { JSONObject status=new JSONObject(); try { status.put("configured",apiKeyStore.hasKey()); status.put("mode","direct"); status.put("model",DeepSeekClient.MODEL); } catch(Exception ignored) {} return status.toString(); }
        @JavascriptInterface public void configureApiKey() { runOnUiThread(() -> showApiKeyDialog()); }
        @JavascriptInterface public void clearApiKey() { runOnUiThread(() -> new AlertDialog.Builder(MainActivity.this).setTitle("移除本机 API Key？").setMessage("已保存的任务和提醒会保留。之后可以重新填写密钥。")
            .setNegativeButton("取消",null).setPositiveButton("移除",(dialog,which)->{ try { apiKeyStore.clear(); emit("api-status","message","已移除本机密钥"); } catch(Exception error) { emit("api-status","message","移除失败，请重试"); } }).show()); }
        @JavascriptInterface public void extractAI(String requestId, String payload) { submitAI(requestId,payload,false); }
        @JavascriptInterface public void testApiConnection(String requestId) { submitAI(requestId,"",true); }
        @JavascriptInterface public String weixinStatus(){return "{\"configured\":"+weixinStore.hasKey()+"}";}
        @JavascriptInterface public void configureWeixin(){runOnUiThread(()->showWeixinDialog());}
        @JavascriptInterface public void clearWeixin(){runOnUiThread(()->new AlertDialog.Builder(MainActivity.this).setTitle("断开微信同步？").setMessage("手机已有任务和提醒会保留。微信接入服务需单独停用。").setNegativeButton("取消",null).setPositiveButton("断开",(d,w)->{try{weixinStore.clear();emit("weixin-status","message","已断开此手机的微信同步");}catch(Exception e){emit("weixin-status","message","断开失败，请重试");}}).show());}
        @JavascriptInterface public void pullWeixinTasks(long cursor){
            if(destroyed||!syncActive.compareAndSet(false,true))return;
            syncExecutor.execute(()->{try{
                JSONObject config=new JSONObject(weixinStore.readKey());JSONObject data=WeixinSyncClient.pull(config.getString("endpoint"),config.getString("token"),cursor,config.optString("pin",""));
                JSONObject event=new JSONObject().put("type","weixin-result").put("data",data);syncActive.set(false);emitEvent(event);
            }catch(Exception e){syncActive.set(false);emit("weixin-error","message","无法同步电脑。请确认电脑服务正在运行、手机与电脑在同一局域网；若电脑地址变化，请重新复制连接码。已有任务保留。");}finally{syncActive.set(false);}});
        }
        @JavascriptInterface public void startVoice() { runOnUiThread(() -> beginVoice()); }
        @JavascriptInterface public void stopVoice() { runOnUiThread(() -> finishVoice()); }
        @JavascriptInterface public void syncReminders(String value) { try { new JSONArray(value); getSharedPreferences("reminders", MODE_PRIVATE).edit().putString("tasks", value).commit(); runOnUiThread(() -> ReminderEngine.sync(MainActivity.this)); } catch (Exception e) { } }
        @JavascriptInterface public String reminderStatus() { return ReminderEngine.status(MainActivity.this).toString(); }
        @JavascriptInterface public void requestNotifications() { runOnUiThread(() -> {
            if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_REQUEST);
            else { Intent intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS); intent.putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName()); startActivity(intent); }
        }); }
        @JavascriptInterface public void requestExactAlarms() { runOnUiThread(() -> {
            if (Build.VERSION.SDK_INT >= 31 && !getSystemService(AlarmManager.class).canScheduleExactAlarms()) startActivity(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + getPackageName())));
            else emit("reminder-status", "message", "准时提醒可用");
        }); }
        @JavascriptInterface public void testNotification() { runOnUiThread(() -> {
            if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) { requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_REQUEST); return; }
            ReminderEngine.notifyTask(MainActivity.this, 12345, "念办已准备好", "这是一条测试通知。你说过的小事，我会帮你记住。");
        }); }
        @JavascriptInterface public void exportText(String text) { runOnUiThread(() -> { exportContent = text; Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT); intent.addCategory(Intent.CATEGORY_OPENABLE); intent.setType("text/markdown"); intent.putExtra(Intent.EXTRA_TITLE, "念办_我的清单.md"); startActivityForResult(intent, EXPORT_REQUEST); }); }
    }
    private void showBuddyDialog(){
        if(destroyed||buddyActive.get())return;
        if(buddyStore.hasKey()){emit("buddy-status","message","已连接，可刷新搭子进度");return;}
        LinearLayout layout=new LinearLayout(this);layout.setOrientation(LinearLayout.VERTICAL);int pad=(int)(24*getResources().getDisplayMetrics().density);layout.setPadding(pad,pad/2,pad,0);
        EditText name=new EditText(this);name.setHint("你的昵称（最多16字）");name.setSingleLine(true);name.setFilters(new InputFilter[]{new InputFilter.LengthFilter(16)});layout.addView(name);
        EditText url=new EditText(this);url.setHint("HTTPS 搭子服务地址");url.setSingleLine(true);url.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_URI);url.setFilters(new InputFilter[]{new InputFilter.LengthFilter(500)});
        try(InputStream in=getAssets().open("buddy-config.json")){ByteArrayOutputStream bytes=new ByteArrayOutputStream();byte[] buffer=new byte[1024];int n;while((n=in.read(buffer))!=-1)bytes.write(buffer,0,n);url.setText(new JSONObject(bytes.toString("UTF-8")).optString("endpoint",""));}catch(Exception ignored){}
        layout.addView(url);
        AlertDialog dialog=new AlertDialog.Builder(this).setTitle("和搭子，一起完成")
            .setMessage("昵称、你主动分享的任务和打卡状态会保存到所连接的云服务。私人任务和原话不上传。你的设备身份加密保存在本机，卸载后无法找回；已有搭子可单方面结束关系。")
            .setView(layout).setNegativeButton("取消",null).setPositiveButton("创建我的身份",null).create();
        dialog.setOnShowListener(d->dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->{
            String nickname=name.getText().toString().trim();if(nickname.isEmpty()){name.setError("请填写昵称");return;}
            try{
                String endpoint=BuddyClient.endpoint(url.getText().toString());byte[] bytes=new byte[32];new java.security.SecureRandom().nextBytes(bytes);
                String token=android.util.Base64.encodeToString(bytes,android.util.Base64.URL_SAFE|android.util.Base64.NO_PADDING|android.util.Base64.NO_WRAP);
                JSONObject config=new JSONObject().put("endpoint",endpoint).put("token",token);
                buddyStore.save(config.toString());dialog.dismiss();
                submitBuddy("register",new JSONObject().put("action","register").put("nickname",nickname).toString());
            }catch(IllegalArgumentException e){url.setError(e.getMessage());}catch(Exception e){url.setError("连接配置无法保存，请重试");}
        }));dialog.show();
    }
    private void submitBuddy(String requestId,String raw){
        if(destroyed||requestId==null||!requestId.matches("[A-Za-z0-9_-]{1,80}"))return;
        if(!buddyActive.compareAndSet(false,true)){buddyEvent(requestId,null,"正在同步，请稍后再试");return;}
        buddyExecutor.execute(()->{try{
            if(raw==null||raw.length()>64000)throw new IllegalArgumentException("分享内容过多");
            JSONObject payload=new JSONObject(raw);String action=payload.optString("action");
            if(!java.util.Arrays.asList("snapshot","register","invite","request","accept","decline","publish","signal","unlink","deleteAccount").contains(action))throw new IllegalArgumentException("不支持的搭子操作");
            JSONObject config=new JSONObject(buddyStore.readKey());
            // A failed first registration is safely retried with the same device token.
            if("register".equals(action)){config.put("pendingName",android.util.Base64.encodeToString(payload.optString("nickname").getBytes("UTF-8"),android.util.Base64.NO_WRAP));buddyStore.save(config.toString());}
            if(config.has("pendingName")&&!"register".equals(action)){
                String nickname=new String(android.util.Base64.decode(config.getString("pendingName"),android.util.Base64.DEFAULT),"UTF-8");
                BuddyClient.request(config.getString("endpoint"),config.getString("token"),new JSONObject().put("action","register").put("nickname",nickname));config.remove("pendingName");buddyStore.save(config.toString());
            }
            JSONObject result=BuddyClient.request(config.getString("endpoint"),config.getString("token"),payload);
            if("register".equals(action)){config.remove("pendingName");buddyStore.save(config.toString());}
            if("deleteAccount".equals(action))buddyStore.clear();
            buddyActive.set(false);buddyEvent(requestId,result,null);
        }catch(Exception e){String error=e instanceof BuddyClient.ServiceException||e instanceof IllegalArgumentException?e.getMessage():"搭子同步失败，请检查网络或服务地址。手机任务已保留。";buddyActive.set(false);buddyEvent(requestId,null,error);}finally{buddyActive.set(false);}});
    }
    private void buddyEvent(String requestId,JSONObject data,String error){try{JSONObject event=new JSONObject().put("type",error==null?"buddy-result":"buddy-error").put("requestId",requestId);if(error==null)event.put("data",data);else event.put("message",error);emitEvent(event);}catch(Exception ignored){}}
    private void showApiKeyDialog() {
        if(destroyed) return;
        final EditText input=new EditText(this);
        input.setSingleLine(true); input.setHint("粘贴 DeepSeek API Key");
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        input.setFilters(new InputFilter[]{new InputFilter.LengthFilter(300)});
        input.setImportantForAutofill(android.view.View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        LinearLayout layout=new LinearLayout(this); layout.setOrientation(LinearLayout.VERTICAL); int pad=(int)(24*getResources().getDisplayMetrics().density); layout.setPadding(pad,pad/2,pad,0); layout.addView(input);
        AlertDialog dialog=new AlertDialog.Builder(this).setTitle(apiKeyStore.hasKey()?"更换 DeepSeek API Key":"连接你的 DeepSeek")
            .setMessage("密钥加密保存在此手机。常见指令离线处理，复杂表达才通过 DeepSeek 官方接口理解。")
            .setView(layout).setNegativeButton("取消",(d,w)->input.setText("")) .setPositiveButton("保存",null).create();
        dialog.setOnShowListener(d -> { dialog.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE); dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->{
            String key=input.getText().toString().trim();
            try { apiKeyStore.save(key); input.setText(""); dialog.dismiss(); emit("api-status","message","API Key 已加密保存在本机，可以测试连接了"); }
            catch(IllegalArgumentException error) { input.setError("API Key 格式不正确，请重新粘贴"); }
            catch(Exception error) { input.setError("密钥保存失败，请检查手机存储空间后重试"); }
        }); });
        dialog.setOnDismissListener(d->input.setText("")); dialog.show();
    }
    private void showWeixinDialog(){
        if(destroyed)return;
        LinearLayout layout=new LinearLayout(this);layout.setOrientation(LinearLayout.VERTICAL);int pad=(int)(24*getResources().getDisplayMetrics().density);layout.setPadding(pad,pad/2,pad,0);
        EditText token=new EditText(this);token.setSingleLine(false);token.setMinLines(3);token.setHint("粘贴 NB1: 开头的完整电脑连接码");token.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD|InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);token.setFilters(new InputFilter[]{new InputFilter.LengthFilter(2048)});token.setImportantForAutofill(android.view.View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);layout.addView(token);
        AlertDialog dialog=new AlertDialog.Builder(this).setTitle("连接你的电脑").setMessage("在电脑打开念办微信服务页，复制连接码并粘贴到这里。手机和电脑需连接同一路由器或局域网。电脑开机运行服务时接收微信；打开念办同步后才设置手机提醒。连接码加密保存在本机。").setView(layout).setNegativeButton("取消",null).setPositiveButton("保存",null).create();
        dialog.setOnShowListener(d->{dialog.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->{try{
            JSONObject config=WeixinSyncClient.parsePairingCode(token.getText().toString().trim());weixinStore.save(config.toString());token.setText("");dialog.dismiss();emit("weixin-status","message","电脑连接已保存，正在同步微信任务");
        }catch(IllegalArgumentException e){token.setError(e.getMessage());}catch(Exception e){token.setError("保存失败，请检查连接码后重试");}});});dialog.setOnDismissListener(d->token.setText(""));dialog.show();
    }
    private void emitEvent(JSONObject event){if(destroyed)return;final String script="window.onNativeEvent && window.onNativeEvent("+event.toString()+")";runOnUiThread(()->{if(!destroyed)web.evaluateJavascript(script,null);});}
    private void submitAI(String requestId, String payload, boolean test) {
        if(destroyed || requestId==null || !requestId.matches("[A-Za-z0-9_-]{1,80}")) return;
        if(!aiActive.compareAndSet(false,true)) { emitAI(requestId,null,"正在处理上一条请求，请稍后再试"); return; }
        aiExecutor.execute(()->{
            try {
                JSONObject result;
                if(test) result=apiClient.testConnection();
                else { if(payload==null || payload.length()>100000) throw new IllegalArgumentException("本次请求过长，请减少任务数量后重试"); JSONObject request=new JSONObject(payload); result=apiClient.extract(request.getString("systemPrompt"),request.getJSONObject("input")); }
                emitAI(requestId,result,null);
            } catch(Exception error) {
                String message=error.getMessage()==null?"":error.getMessage();
                if(!(message.startsWith("DeepSeek") || message.startsWith("API Key") || message.startsWith("请先") || message.startsWith("本机密钥") || message.startsWith("模型") || message.startsWith("本次请求") || message.startsWith("服务地址"))) message="连接 DeepSeek 失败，请检查手机网络后重试";
                emitAI(requestId,null,message);
            } finally { aiActive.set(false); }
        });
    }
    private void emitAI(String requestId, JSONObject result, String error) {
        if(destroyed) return;
        try { JSONObject data=new JSONObject().put("type",error==null?"ai-result":"ai-error").put("requestId",requestId); if(error==null) data.put("data",result); else data.put("message",error); final String script="window.onNativeEvent && window.onNativeEvent("+data.toString()+")"; runOnUiThread(()->{if(!destroyed) web.evaluateJavascript(script,null);}); } catch(Exception ignored) {}
    }
    private void beginVoice() {
        if (voiceActive || destroyed) return;
        if (!modelError.isEmpty()) { emit("voice-error", "message", modelError); return; }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) { requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, AUDIO_REQUEST); return; }
        if (model == null) { startAfterModel = true; emit("voice-status", "message", "首次正在准备离线中文识别，稍等一下…"); return; }
        try {
            cleanupSpeech();
            recognizer = new Recognizer(model, 16000.0f);
            speech = new SpeechService(recognizer, 16000.0f);
            voiceActive = true;
            speech.startListening(this, 30000);
            emit("voice-status", "message", "正在听。说完停一下，就会自动记下来。");
        } catch (Exception e) { voiceActive = false; emit("voice-error", "message", "无法打开麦克风，请关闭其他录音应用后再试。"); }
    }
    private void finishVoice() { if (startAfterModel) { startAfterModel = false; emit("voice-error", "message", "已取消，可以随时再说一句。"); return; } if (speech != null) speech.stop(); else emit("voice-error", "message", "没有正在进行的录音。"); }
    private void cleanupSpeech() { if (speech != null) { speech.cancel(); speech.shutdown(); speech = null; } if (recognizer != null) { recognizer.close(); recognizer = null; } }
    private String transcription(String json, String key) { try { return new JSONObject(json).optString(key, "").replace(" ", "").trim(); } catch (Exception e) { return ""; } }
    private void sendTranscript(String text) {
        if (!voiceActive) return;
        voiceActive = false;
        if (speech != null) speech.stop();
        if (text.isEmpty()) emit("voice-error", "message", "没有听清，可以再说一次，也可以使用文字输入。");
        else emit("voice-result", "text", text);
    }
    @Override public void onPartialResult(String result) { if (voiceActive) emit("voice-partial", "text", transcription(result, "partial")); }
    @Override public void onResult(String result) { String text = transcription(result, "text"); if (!text.isEmpty()) sendTranscript(text); }
    @Override public void onFinalResult(String result) { sendTranscript(transcription(result, "text")); }
    @Override public void onError(Exception error) { voiceActive = false; emit("voice-error", "message", "语音识别暂时中断，可以再说一次。"); }
    @Override public void onTimeout() { if (voiceActive) { voiceActive = false; emit("voice-error", "message", "这次录音已结束，没有收到完整句子，可以重试。"); } }
    private void emit(String type, String key, String value) { if(destroyed) return; try { JSONObject data = new JSONObject(); data.put("type", type); data.put(key, value); final String js = "window.onNativeEvent && window.onNativeEvent(" + data.toString() + ")"; runOnUiThread(() -> {if(!destroyed) web.evaluateJavascript(js, null);}); } catch (Exception e) { } }
    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] grants) { super.onRequestPermissionsResult(code, permissions, grants); if (code == AUDIO_REQUEST) { if (grants.length > 0 && grants[0] == PackageManager.PERMISSION_GRANTED) beginVoice(); else emit("voice-error", "message", "没有麦克风权限，可以先输入文字；也可在系统设置中允许录音。"); } else if (code == NOTIFICATION_REQUEST) { ReminderEngine.sync(this); emit("reminder-status", "message", "通知权限已更新"); } }
    @Override protected void onResume() { super.onResume(); if (web != null) { ReminderEngine.sync(this); emit("reminder-status", "message", "状态已更新"); TodayWidget.refresh(this); emit("state-resume", "message", ""); emit("weixin-resume", "message", ""); } }
    @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);emit("widget-open","message",intent.getStringExtra("widgetAction")==null?"":intent.getStringExtra("widgetAction"));}
    @Override protected void onPause() { super.onPause(); if (speech != null && voiceActive) { voiceActive = false; speech.cancel(); emit("voice-error", "message", "切换应用后录音已停止。"); } }
    @Override protected void onDestroy() { destroyed = true; apiClient.close(); aiExecutor.shutdownNow(); syncExecutor.shutdownNow(); buddyExecutor.shutdownNow(); voiceActive = false; startAfterModel = false; cleanupSpeech(); if (model != null) model.close(); if (web != null) web.destroy(); super.onDestroy(); }
    @Override public void onBackPressed() { web.evaluateJavascript("if(!document.querySelector('#modal').hidden){document.querySelector('[data-action=close]').click()}else{location.hash='today';document.querySelector('[data-page=today]').click()}", null); }
    @Override protected void onActivityResult(int request, int result, Intent data) { super.onActivityResult(request, result, data); if (request == EXPORT_REQUEST && result == RESULT_OK && data != null && data.getData() != null) { try (OutputStream out = getContentResolver().openOutputStream(data.getData())) { if (out != null) out.write(exportContent.getBytes("UTF-8")); } catch (Exception e) { } finally { exportContent = ""; } } }
}
