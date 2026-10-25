package com.zequn.nianban;
import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import java.security.KeyStore;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;

/** Private encrypted preferences; the AES key stays in AndroidKeyStore. */
public final class ApiKeyStore implements DeepSeekClient.Credentials {
    private final String alias;
    private final SharedPreferences preferences;
    public ApiKeyStore(Context context) { this(context,"nianban_deepseek_v1","api_credentials"); }
    ApiKeyStore(Context context,String keyAlias,String preferenceName) { alias=keyAlias; preferences = context.getSharedPreferences(preferenceName,Context.MODE_PRIVATE); }
    private synchronized SecretKey deviceKey(boolean create) throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (store.containsAlias(alias)) return (SecretKey) store.getKey(alias,null);
        if (!create) throw new IllegalStateException("Credential key unavailable");
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256).setRandomizedEncryptionRequired(true).build());
        return generator.generateKey();
    }
    public synchronized boolean hasKey() { return preferences.contains("encrypted_key"); }
    public synchronized void save(String key) throws Exception {
        int maxLength=("nianban_weixin_sync_v1".equals(alias)||"nianban_buddy_v1".equals(alias))?4096:300;
        if (key == null || key.length() < 12 || key.length() > maxLength || !key.matches("[!-~]+")) throw new IllegalArgumentException("密钥或连接码格式不正确，请重新粘贴");
        String encrypted = ApiKeyCipher.encrypt(deviceKey(true),key);
        if (!preferences.edit().putString("encrypted_key",encrypted).commit()) throw new IllegalStateException("无法保存密钥，请检查手机存储空间");
    }
    @Override public synchronized String readKey() throws Exception {
        String encrypted = preferences.getString("encrypted_key","");
        if (encrypted.isEmpty()) throw new IllegalStateException("请先在设置中填写 DeepSeek API Key");
        try { return ApiKeyCipher.decrypt(deviceKey(false),encrypted); }
        catch (Exception error) { throw new IllegalStateException("本机密钥无法读取，请在设置中重新填写 API Key"); }
    }
    public synchronized void clear() throws Exception {
        if (!preferences.edit().remove("encrypted_key").commit()) throw new IllegalStateException("移除失败，请重试");
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (store.containsAlias(alias)) store.deleteEntry(alias);
    }
}
