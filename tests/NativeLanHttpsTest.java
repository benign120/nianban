package com.zequn.nianban;
import com.sun.net.httpserver.HttpsServer;
import com.sun.net.httpserver.HttpsConfigurator;
import javax.net.ssl.SSLContext;
import javax.net.ssl.KeyManagerFactory;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.net.InetSocketAddress;
import org.json.JSONObject;
public class NativeLanHttpsTest {
    private static final String TOKEN=new String(new char[64]).replace('\0','a');
    static KeyStore keys(String file,String password)throws Exception{KeyStore k=KeyStore.getInstance("PKCS12");try(java.io.InputStream in=Files.newInputStream(Paths.get(file))){k.load(in,password.toCharArray());}return k;}
    static String pin(KeyStore k)throws Exception{StringBuilder s=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(k.getCertificate("nianban-lan").getEncoded()))s.append(String.format("%02x",b&255));return s.toString();}
    static HttpsServer start(KeyStore k,String password)throws Exception{
        KeyManagerFactory km=KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());km.init(k,password.toCharArray());SSLContext context=SSLContext.getInstance("TLS");context.init(km.getKeyManagers(),null,null);
        HttpsServer server=HttpsServer.create(new InetSocketAddress("127.0.0.1",8793),0);server.setHttpsConfigurator(new HttpsConfigurator(context));
        server.createContext("/api/device/inbox",e->{boolean authorized=("Bearer "+TOKEN).equals(e.getRequestHeaders().getFirst("Authorization"));byte[] body=(authorized?"{\"schemaVersion\":1,\"items\":[],\"nextCursor\":0,\"hasMore\":false}":"{}").getBytes(java.nio.charset.StandardCharsets.UTF_8);e.sendResponseHeaders(authorized?200:401,body.length);try(java.io.OutputStream out=e.getResponseBody()){out.write(body);}});server.start();return server;
    }
    public static void main(String[] args)throws Exception{
        JSONObject cfg=new JSONObject(new String(Files.readAllBytes(Paths.get(args[0])),java.nio.charset.StandardCharsets.UTF_8));String password=cfg.getString("password");KeyStore valid=keys(cfg.getString("valid"),password);String expected=pin(valid);HttpsServer server=start(valid,password);int checks=0;
        try{
            if(WeixinSyncClient.pull("https://127.0.0.1:8793",TOKEN,0,expected).getJSONArray("items").length()!=0)throw new AssertionError();checks++;
            try{WeixinSyncClient.pull("https://127.0.0.1:8793",TOKEN,0,new String(new char[64]).replace('\0','0'));throw new AssertionError("Wrong pin accepted");}catch(javax.net.ssl.SSLHandshakeException e){}checks++;
            try{WeixinSyncClient.pull("https://127.0.0.1:8793",new String(new char[64]).replace('\0','b'),0,expected);throw new AssertionError("Wrong token accepted");}catch(IllegalStateException e){}checks++;
            if(WeixinSyncClient.pull("https://localhost:8793",TOKEN,0,expected).optInt("schemaVersion")!=1)throw new AssertionError();checks++;
        }finally{server.stop(0);}
        KeyStore wrongName=keys(cfg.getString("wrongName"),password);server=start(wrongName,password);
        try{try{WeixinSyncClient.pull("https://127.0.0.1:8793",TOKEN,0,pin(wrongName));throw new AssertionError("Hostname mismatch accepted");}catch(javax.net.ssl.SSLHandshakeException e){}checks++;}finally{server.stop(0);}
        System.out.println("Native real HTTPS: "+checks+" checks passed (paired certificate, wrong pin, wrong token, DNS SAN, wrong hostname).");
    }
}
