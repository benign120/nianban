package com.zequn.nianban;
public class NativeWeixinSecurityTest {
    public static void main(String[] args)throws Exception{
        int checks=0;
        if(!WeixinSyncClient.validateEndpoint("https://Example.com/").equals("https://example.com"))throw new AssertionError();checks++;
        for(String value:new String[]{"http://example.com","https://user:pass@example.com","https://example.com/a","https://example.com?token=secret","https://example.com/#secret","https://example.com:8443","javascript:alert(1)","https://"}){try{WeixinSyncClient.validateEndpoint(value);throw new AssertionError(value);}catch(IllegalArgumentException|java.net.URISyntaxException e){}checks++;}
        for(String value:new String[]{"short","a\r\nHeader: value","g123",""}){try{WeixinSyncClient.validateToken(value);throw new AssertionError();}catch(IllegalArgumentException e){}checks++;}
        WeixinSyncClient.validateToken(new String(new char[64]).replace('\0','a'));checks++;
        for(String host:new String[]{"10.0.0.1","172.16.0.1","172.31.255.254","192.168.1.2","127.0.0.1","localhost"}){if(!WeixinSyncClient.isLocalHost(host))throw new AssertionError();WeixinSyncClient.validateEndpoint("https://"+host+":8793");checks++;}
        for(String host:new String[]{"172.32.0.1","172.15.0.1","8.8.8.8","192.169.0.1","010.0.0.1","256.1.1.1","10.1.2","localhost.example.com"}){if(WeixinSyncClient.isLocalHost(host))throw new AssertionError(host);try{WeixinSyncClient.validateEndpoint("https://"+host+":8793");throw new AssertionError();}catch(IllegalArgumentException e){}checks++;}
        String token=new String(new char[64]).replace('\0','a'),pin=new String(new char[64]).replace('\0','b');
        String json=new org.json.JSONObject().put("v",1).put("endpoint","https://192.168.1.2:8793").put("token",token).put("pin",pin).toString();
        String pairing="NB1:"+java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(json.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        org.json.JSONObject parsed=WeixinSyncClient.parsePairingCode(pairing);if(!parsed.getString("token").equals(token)||!parsed.getString("pin").equals(pin)||parsed.has("v"))throw new AssertionError();checks++;
        for(String code:new String[]{"","NB2:abc","NB1:abc!",pairing.substring(0,pairing.length()-10),"NB1:"+java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(json.replace("https://","http://").getBytes(java.nio.charset.StandardCharsets.UTF_8))}){try{WeixinSyncClient.parsePairingCode(code);throw new AssertionError();}catch(IllegalArgumentException e){}checks++;}
        try{WeixinSyncClient.pull("https://127.0.0.1:8793",token,0);throw new AssertionError();}catch(IllegalArgumentException e){}checks++;
        try{WeixinSyncClient.pinnedTrustManager(pin).checkServerTrusted(new java.security.cert.X509Certificate[0],"RSA");throw new AssertionError();}catch(java.security.cert.CertificateException e){}checks++;
        System.out.println("Native Weixin endpoint/pairing/pinning validation: "+checks+" checks passed.");
    }
}
