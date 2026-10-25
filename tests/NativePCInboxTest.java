package com.zequn.nianban;
import java.nio.file.Files;import java.nio.file.Path;import java.nio.file.Paths;import java.security.cert.CertificateFactory;import java.security.MessageDigest;import org.json.JSONObject;
public class NativePCInboxTest {
    public static void main(String[] args)throws Exception{
        Path root=Paths.get(args[0]),data=root.resolve(".local/weixin");
        JSONObject cfg=new JSONObject(new String(Files.readAllBytes(data.resolve("lan-certificate.json")),java.nio.charset.StandardCharsets.UTF_8));
        JSONObject device=new JSONObject(new String(Files.readAllBytes(data.resolve("device.json")),java.nio.charset.StandardCharsets.UTF_8));
        StringBuilder pin=new StringBuilder();try(java.io.InputStream in=Files.newInputStream(data.resolve(cfg.getString("certificate")))){for(byte b:MessageDigest.getInstance("SHA-256").digest(CertificateFactory.getInstance("X.509").generateCertificate(in).getEncoded()))pin.append(String.format("%02x",b&255));}
        String endpoint="https://"+cfg.getJSONArray("addresses").getString(0)+":8793";
        JSONObject inbox=WeixinSyncClient.pull(endpoint,device.getString("token"),0,pin.toString());
        Files.write(root.resolve("qa/weixin-pc-live-inbox.json"),inbox.toString(2).getBytes(java.nio.charset.StandardCharsets.UTF_8));
        System.out.println("Production Java client pulled "+inbox.getJSONArray("items").length()+" actual Weixin task(s) over paired LAN HTTPS. Physical phone not tested.");
    }
}
