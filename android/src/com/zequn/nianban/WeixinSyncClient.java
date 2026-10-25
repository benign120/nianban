package com.zequn.nianban;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;
import java.security.MessageDigest;
import java.security.cert.CertificateException;
import java.security.cert.X509Certificate;
import java.net.URL;
import java.net.URI;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import org.json.JSONObject;

/** LAN HTTPS uses an explicitly paired certificate fingerprint, never trust-all TLS. */
public final class WeixinSyncClient {
    public static boolean isLocalHost(String host){
        if("localhost".equals(host)||"127.0.0.1".equals(host))return true;
        String[] p=host.split("\\.",-1);if(p.length!=4)return false;
        int[] n=new int[4];for(int i=0;i<4;i++){if(!p[i].matches("0|[1-9][0-9]{0,2}"))return false;n[i]=Integer.parseInt(p[i]);if(n[i]>255)return false;}
        return n[0]==10||n[0]==172&&n[1]>=16&&n[1]<=31||n[0]==192&&n[1]==168;
    }
    public static String validateEndpoint(String value) throws Exception {
        URI u=new URI(value.trim());String host=u.getHost();
        if(!"https".equals(u.getScheme())||host==null||u.getUserInfo()!=null||u.getQuery()!=null||u.getFragment()!=null||u.getPath()!=null&&!u.getPath().isEmpty()&&!"/".equals(u.getPath()))throw new IllegalArgumentException("电脑连接地址格式不正确");
        host=host.toLowerCase(java.util.Locale.ROOT);int port=u.getPort();
        if(port!=-1&&port!=443&&!(port==8793&&isLocalHost(host)))throw new IllegalArgumentException("电脑同步端口无效");
        return "https://"+host+(port==-1||port==443?"":":"+port);
    }
    public static String validateToken(String value){if(value==null||!value.matches("[a-f0-9]{64}"))throw new IllegalArgumentException("电脑连接码格式不正确");return value;}
    public static String validatePin(String value){if(value==null||!value.matches("[a-f0-9]{64}"))throw new IllegalArgumentException("电脑证书指纹无效，请重新复制连接码");return value;}
    public static JSONObject parsePairingCode(String code) throws Exception {
        if(code==null||code.length()>2048||!code.trim().startsWith("NB1:"))throw new IllegalArgumentException("请粘贴电脑页面上的完整连接码");
        try{
            String encoded=code.trim().substring(4);if(!encoded.matches("[A-Za-z0-9_-]+"))throw new IllegalArgumentException();
            JSONObject raw=new JSONObject(new String(Base64.getUrlDecoder().decode(encoded),StandardCharsets.UTF_8));
            if(raw.optInt("v")!=1)throw new IllegalArgumentException();
            return new JSONObject().put("endpoint",validateEndpoint(raw.getString("endpoint"))).put("token",validateToken(raw.getString("token"))).put("pin",validatePin(raw.getString("pin")));
        }catch(Exception e){throw new IllegalArgumentException("电脑连接码无效，请完整复制后重试");}
    }
    public static X509TrustManager pinnedTrustManager(String pin){
        validatePin(pin);final byte[] expected=new byte[32];for(int i=0;i<32;i++)expected[i]=(byte)Integer.parseInt(pin.substring(i*2,i*2+2),16);
        return new X509TrustManager(){
            public X509Certificate[] getAcceptedIssuers(){return new X509Certificate[0];}
            public void checkClientTrusted(X509Certificate[] chain,String type)throws CertificateException{throw new CertificateException("Client authentication is not supported");}
            public void checkServerTrusted(X509Certificate[] chain,String type)throws CertificateException{
                if(chain==null||chain.length==0)throw new CertificateException("Missing server certificate");
                chain[0].checkValidity();
                try{if(!MessageDigest.isEqual(expected,MessageDigest.getInstance("SHA-256").digest(chain[0].getEncoded())))throw new CertificateException("Paired computer certificate mismatch");}
                catch(CertificateException e){throw e;}catch(Exception e){throw new CertificateException("Certificate verification failed");}
            }
        };
    }
    public static JSONObject pull(String endpoint,String token,long cursor)throws Exception{return pull(endpoint,token,cursor,"");}
    public static JSONObject pull(String endpoint,String token,long cursor,String pin) throws Exception {
        if(cursor<0)throw new IllegalArgumentException("同步游标无效");
        String base=validateEndpoint(endpoint);boolean pinned=pin!=null&&!pin.isEmpty();
        if(isLocalHost(new URI(base).getHost())&&!pinned)throw new IllegalArgumentException("电脑连接缺少证书指纹，请重新复制连接码");
        HttpsURLConnection c=(HttpsURLConnection)new URL(base+"/api/device/inbox?after="+cursor).openConnection();
        if(pinned){SSLContext ssl=SSLContext.getInstance("TLS");ssl.init(null,new TrustManager[]{pinnedTrustManager(pin)},null);c.setSSLSocketFactory(ssl.getSocketFactory());}
        // Keep the platform's strict hostname/SAN verification. No global trust changes.
        c.setInstanceFollowRedirects(false);c.setConnectTimeout(15000);c.setReadTimeout(20000);
        c.setRequestProperty("Authorization","Bearer "+validateToken(token));c.setRequestProperty("Accept","application/json");
        try{
            int status=c.getResponseCode();if(status==401)throw new IllegalStateException("电脑连接码已失效，请重新配置");if(status!=200)throw new IllegalStateException("电脑同步服务暂不可用");
            ByteArrayOutputStream out=new ByteArrayOutputStream();try(InputStream stream=c.getInputStream()){byte[] bytes=new byte[8192];int n;while((n=stream.read(bytes))!=-1){if(out.size()+n>1500000)throw new IllegalStateException("电脑同步数据过大");out.write(bytes,0,n);}}
            JSONObject data=new JSONObject(new String(out.toByteArray(),StandardCharsets.UTF_8));
            if(data.optInt("schemaVersion")!=1||data.optJSONArray("items")==null||data.getJSONArray("items").length()>100)throw new IllegalStateException("电脑同步数据格式无效");
            return data;
        }finally{c.disconnect();}
    }
}
