package com.zequn.nianban;

import org.json.*;
import java.net.*;
import javax.net.ssl.HttpsURLConnection;
import java.io.*;
import java.util.*;

/** Dedicated device credential; never shares DeepSeek or WeChat keys with the buddy service. */
public final class BuddyClient {
    public static String endpoint(String raw)throws Exception{
        URI u=new URI(raw.trim());String host=u.getHost();
        if(!"https".equals(u.getScheme())||host==null||u.getRawUserInfo()!=null||u.getRawQuery()!=null||u.getRawFragment()!=null||u.getPort()!=-1&&u.getPort()!=443||raw.length()>500)throw new IllegalArgumentException("请填写完整的 HTTPS 搭子服务地址");
        if(!host.matches("[A-Za-z0-9.-]+")||!host.contains(".")||host.matches("[0-9.]+")||host.endsWith(".local")||host.equals("localhost"))throw new IllegalArgumentException("请使用已部署的云服务域名");
        return u.toASCIIString();
    }
    public static JSONObject request(String endpoint,String token,JSONObject payload)throws Exception{
        String target=endpoint(endpoint);String host=new URI(target).getHost();
        for(InetAddress address:InetAddress.getAllByName(host))if(address.isAnyLocalAddress()||address.isLoopbackAddress()||address.isLinkLocalAddress()||address.isSiteLocalAddress()||address.isMulticastAddress())throw new IOException("服务地址不可用");
        if(!token.matches("[A-Za-z0-9_-]{40,100}"))throw new IllegalArgumentException("搭子身份无效");
        byte[] input=payload.toString().getBytes("UTF-8");if(input.length>64000)throw new IllegalArgumentException("分享内容过多");
        HttpsURLConnection conn=(HttpsURLConnection)new URL(target).openConnection();
        try{
            conn.setInstanceFollowRedirects(false);conn.setConnectTimeout(12000);conn.setReadTimeout(18000);conn.setRequestMethod("POST");conn.setRequestProperty("Content-Type","application/json");conn.setRequestProperty("Authorization","Bearer "+token);conn.setDoOutput(true);conn.setFixedLengthStreamingMode(input.length);
            try(OutputStream out=conn.getOutputStream()){out.write(input);}
            int status=conn.getResponseCode();if(status>=300&&status<400)throw new IOException("服务地址发生跳转，请核对地址");
            InputStream stream=status>=400?conn.getErrorStream():conn.getInputStream();if(stream==null)throw new IOException("云服务暂不可用");
            ByteArrayOutputStream bytes=new ByteArrayOutputStream();try(InputStream in=stream){byte[] buffer=new byte[4096];int n;while((n=in.read(buffer))!=-1){if(bytes.size()+n>300000)throw new IOException("服务返回过大");bytes.write(buffer,0,n);}}
            JSONObject body=new JSONObject(bytes.toString("UTF-8"));
            if(status!=200||!body.has("data")){String message=body.optString("error","搭子同步暂不可用");throw new ServiceException(message.length()>180?"搭子同步暂不可用":message);}
            return body.getJSONObject("data");
        }finally{conn.disconnect();}
    }
    public static final class ServiceException extends IOException{ServiceException(String message){super(message);}}
}
