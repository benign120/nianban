package com.zequn.nianban;
import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import org.json.JSONObject;

public final class ApiKeyCipher {
    private static final byte[] AAD = "nianban.deepseek.key.v1".getBytes(StandardCharsets.UTF_8);
    public static String encrypt(SecretKey key, String plaintext) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key); cipher.updateAAD(AAD);
        byte[] ciphertext = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
        return new JSONObject().put("v",1).put("iv",Base64.getEncoder().encodeToString(cipher.getIV())).put("data",Base64.getEncoder().encodeToString(ciphertext)).toString();
    }
    public static String decrypt(SecretKey key, String envelope) throws Exception {
        JSONObject data = new JSONObject(envelope);
        if (data.optInt("v") != 1) throw new IllegalArgumentException("Unsupported credential format");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, Base64.getDecoder().decode(data.getString("iv"))));
        cipher.updateAAD(AAD);
        return new String(cipher.doFinal(Base64.getDecoder().decode(data.getString("data"))),StandardCharsets.UTF_8);
    }
}
