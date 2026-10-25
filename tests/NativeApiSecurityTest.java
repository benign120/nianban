package com.zequn.nianban;
import org.json.*;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;

public class NativeApiSecurityTest {
    static void check(boolean ok,String name) { if(!ok) throw new AssertionError(name); System.out.println("PASS "+name); }
    static void rejects(String body, boolean structured, String name) throws Exception { boolean failed=false; try { DeepSeekClient.parseSuccess(body,structured,100); } catch(Exception error) { failed=true; } check(failed,name); }
    static String response(String text,String finish) { return new JSONObject().put("model","test-model").put("choices",new JSONArray().put(new JSONObject().put("finish_reason",finish).put("message",new JSONObject().put("content",text)))).toString(); }
    public static void main(String[] args) throws Exception {
        KeyGenerator generator=KeyGenerator.getInstance("AES"); generator.init(256); SecretKey key=generator.generateKey();
        String original="synthetic-test-key-only-not-a-real-credential";
        String first=ApiKeyCipher.encrypt(key,original),second=ApiKeyCipher.encrypt(key,original);
        check(!first.contains(original),"credential envelope contains no plaintext");
        check(!first.equals(second),"fresh IV on every encryption");
        check(ApiKeyCipher.decrypt(key,first).equals(original),"AES-GCM credential round trip");
        JSONObject changed=new JSONObject(first); byte[] bytes=java.util.Base64.getDecoder().decode(changed.getString("data")); bytes[0]^=1; changed.put("data",java.util.Base64.getEncoder().encodeToString(bytes));
        boolean tampered=false; try { ApiKeyCipher.decrypt(key,changed.toString()); } catch(Exception error) {tampered=true;} check(tampered,"tampered credential rejected");
        check(DeepSeekClient.statusMessage(401).contains("API Key"),"invalid key error");
        check(DeepSeekClient.statusMessage(402).contains("余额"),"balance error");
        check(DeepSeekClient.statusMessage(429).contains("稍后"),"rate limit error");
        check(DeepSeekClient.statusMessage(302).contains("停止"),"redirect refused");
        rejects("<html>unavailable</html>",true,"non-JSON upstream rejected");
        rejects("{\"choices\":[]}",true,"empty choices rejected");
        rejects(response("", "stop"),true,"empty message rejected");
        rejects(response("{\"tasks\":[]}","length"),true,"truncated answer rejected");
        rejects(response("not json","stop"),true,"non-JSON task content rejected");
        check(DeepSeekClient.parseSuccess(response("{\"tasks\":[]}","stop"),true,45).getLong("elapsedMs")==45,"valid task response accepted");
        check(DeepSeekClient.parseSuccess(response("OK","stop"),false,45).getString("content").equals("OK"),"connection test accepts plain content");
    }
}
