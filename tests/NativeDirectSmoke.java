package com.zequn.nianban;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import org.json.*;

/** Runs the exact production Java HTTPS transport on the host, without a gateway. */
public class NativeDirectSmoke {
    public static void main(String[] args) throws Exception {
        JSONObject local=new JSONObject(new String(Files.readAllBytes(Paths.get(".local/settings.json")),StandardCharsets.UTF_8));
        final String key=local.getString("apiKey");
        DeepSeekClient client=new DeepSeekClient(()->key);
        String inputFile=args.length>0?args[0]:"build/native-direct-requests.json", outputFile=args.length>1?args[1]:"qa/native-direct-raw.json";
        JSONObject tests=new JSONObject(new String(Files.readAllBytes(Paths.get(inputFile)),StandardCharsets.UTF_8));
        JSONArray results=new JSONArray();
        try {
            JSONObject connection=args.length>2&&args[2].equals("--skip-connection")?new JSONObject():client.testConnection();
            JSONArray cases=tests.getJSONArray("cases");
            for(int i=0;i<cases.length();i++) { JSONObject item=cases.getJSONObject(i); JSONObject result=client.extract(tests.getString("systemPrompt"),item.getJSONObject("input")); results.put(new JSONObject().put("id",item.getString("id")).put("input",item.getJSONObject("input")).put("result",result)); System.out.println(item.getString("id")+": received live response"); }
            Files.write(Paths.get(outputFile),new JSONObject().put("connection",connection).put("cases",results).toString(2).getBytes(StandardCharsets.UTF_8));
        } finally { client.close(); }
    }
}
