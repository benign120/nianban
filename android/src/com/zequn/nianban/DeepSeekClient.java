package com.zequn.nianban;
import org.json.JSONArray;
import org.json.JSONObject;
import javax.net.ssl.HttpsURLConnection;
import java.net.URL;
import java.net.SocketTimeoutException;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

/** Direct HTTPS; no local gateway, redirects, logs, or credential export. */
public final class DeepSeekClient {
    public static final String ENDPOINT = "https://api.deepseek.com/chat/completions";
    public static final String MODEL = "deepseek-flash";
    public interface Credentials { String readKey() throws Exception; }
    private final Credentials credentials;
    private volatile HttpsURLConnection activeConnection;
    private volatile boolean closed;
    public DeepSeekClient(Credentials credentials) { this.credentials=credentials; }
    public JSONObject extract(String systemPrompt, JSONObject input) throws Exception {
        if (systemPrompt == null || systemPrompt.length() > 12000 || input.toString().length() > 60000) throw new IllegalArgumentException("本次请求过长，请减少任务数量后重试");
        JSONArray messages = new JSONArray().put(new JSONObject().put("role","system").put("content",systemPrompt))
            .put(new JSONObject().put("role","user").put("content",input.toString()));
        return request(new JSONObject().put("model",MODEL).put("thinking",new JSONObject().put("type","disabled"))
            .put("temperature",0.1).put("max_tokens",5000).put("response_format",new JSONObject().put("type","json_object")).put("messages",messages),true);
    }
    public JSONObject testConnection() throws Exception {
        JSONObject result = request(new JSONObject().put("model",MODEL).put("thinking",new JSONObject().put("type","disabled")).put("max_tokens",16)
            .put("messages",new JSONArray().put(new JSONObject().put("role","user").put("content","Reply with OK only."))),false);
        return new JSONObject().put("ok",true).put("model",result.optString("model",MODEL)).put("elapsedMs",result.optLong("elapsedMs"));
    }
    private JSONObject request(JSONObject body, boolean structured) throws Exception {
        if (closed) throw new IOException("请求已取消");
        String key = credentials.readKey();
        long started = System.currentTimeMillis();
        HttpsURLConnection connection = (HttpsURLConnection) new URL(ENDPOINT).openConnection();
        activeConnection = connection;
        try {
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(20000); connection.setReadTimeout(65000);
            connection.setRequestMethod("POST"); connection.setDoOutput(true); connection.setUseCaches(false);
            connection.setRequestProperty("Content-Type","application/json; charset=utf-8");
            connection.setRequestProperty("Authorization","Bearer " + key);
            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream output = connection.getOutputStream()) { output.write(bytes); }
            int status = connection.getResponseCode();
            if (status != 200) throw new IOException(statusMessage(status));
            String content;
            try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192]; int n,total=0;
                while ((n=input.read(buffer))!=-1) { total+=n; if(total>1000000) throw new IOException("模型返回内容过长，本次尚未保存任务"); output.write(buffer,0,n); }
                content = new String(output.toByteArray(),StandardCharsets.UTF_8);
            }
            return parseSuccess(content,structured,System.currentTimeMillis()-started);
        } catch (SocketTimeoutException error) { throw new IOException("DeepSeek 响应超时，原话还在，可以重试"); }
        finally { connection.disconnect(); activeConnection=null; key=null; }
    }
    public static String statusMessage(int status) {
        if(status==401) return "API Key 无效，请在设置中重新填写";
        if(status==402) return "DeepSeek API 余额不足，请充值后重试";
        if(status==429) return "DeepSeek 请求较多，请稍后重试";
        if(status>=300 && status<400) return "服务地址发生跳转，已停止请求，请稍后重试";
        return "DeepSeek 暂时不可用，请稍后重试（"+status+"）";
    }
    public static JSONObject parseSuccess(String content, boolean structured, long elapsed) throws Exception {
        JSONObject data;
        try { data = new JSONObject(content); } catch (Exception error) { throw new IOException("模型返回格式异常，本次尚未保存任务"); }
        JSONArray choices=data.optJSONArray("choices"); JSONObject choice=choices==null?null:choices.optJSONObject(0);
        JSONObject message=choice==null?null:choice.optJSONObject("message");
        String result=message==null?"":message.optString("content","");
        if(result.isEmpty() || "length".equals(choice.optString("finish_reason"))) throw new IOException("模型结果为空或被截断，本次尚未保存任务，请重试");
        if(structured) { try { new JSONObject(result); } catch(Exception error) { throw new IOException("模型返回格式异常，本次尚未保存任务"); } }
        JSONObject usage=data.optJSONObject("usage");
        return new JSONObject().put("content",result).put("mode","direct").put("model",data.optString("model",MODEL)).put("elapsedMs",elapsed)
            .put("requestId",UUID.randomUUID().toString()).put("usage",new JSONObject().put("inputTokens",usage==null?JSONObject.NULL:usage.opt("prompt_tokens")).put("outputTokens",usage==null?JSONObject.NULL:usage.opt("completion_tokens")));
    }
    public void close() { closed=true; HttpsURLConnection connection=activeConnection; if(connection!=null) connection.disconnect(); }
}
