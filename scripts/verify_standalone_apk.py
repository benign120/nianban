from pathlib import Path
import json, zipfile, subprocess, hashlib
r=Path(__file__).resolve().parents[1]
receipt=json.loads((r/'build/apk/build-receipt.json').read_text(encoding='utf-8'))
apk=Path(receipt['apk'])
assert hashlib.sha256(apk.read_bytes()).hexdigest()==receipt['sha256']
secrets=[]
settings=r/'.local/settings.json'
if settings.exists():
    local=json.loads(settings.read_text(encoding='utf-8'))
    secrets=[value for value in [local.get('apiKey'),local.get('appToken')] if value]
for private_name in ['credentials.json','device.json','lan-certificate.json']:
    private_file=r/'.local/weixin'/private_name
    if private_file.exists():
        private_data=json.loads(private_file.read_text(encoding='utf-8'))
        for field in ['token','password']:
            if private_data.get(field): secrets.append(private_data[field])
with zipfile.ZipFile(apk) as archive:
    assert archive.testzip() is None
    assert not any(name.endswith(('.p12','.der','.jks')) for name in archive.namelist()),'Private certificate bundled in APK'
    for name in archive.namelist():
        data=archive.read(name)
        for secret in secrets:
            assert secret.encode('utf-8') not in data and secret.encode('utf-16le') not in data,'Credential embedded in APK'
    config=archive.read('assets/web/config.js').decode('utf-8')
    app=archive.read('assets/web/app.js').decode('utf-8')
    assert receipt['mode'] in config
    assert all(value not in app+config for value in ['serverUrl','appToken','8790','192.168.137.1','172.30.69.75'])
    assert all(name in archive.namelist() for name in ['assets/voice-model.zip','lib/arm64-v8a/libvosk.so','assets/web/THIRD_PARTY_NOTICES.txt'])
xml=subprocess.run([str(r/'toolchain/android-15/aapt.exe'),'dump','xmltree','build/apk/nianban.apk','AndroidManifest.xml'],cwd=r,capture_output=True,text=True,encoding='utf-8',errors='replace',check=True).stdout
for property_name in ['usesCleartextTraffic','allowBackup']:
    line=next(line for line in xml.splitlines() if 'android:'+property_name in line)
    assert line.strip().endswith('0x0'),property_name+' not disabled'
version=next(line for line in xml.splitlines() if 'android:versionName' in line).split('"')[1]
checks={'apkCrc':True,'noApiKeyOrLegacyTokenEmbedded':True,'noGatewayAddressInApp':True,'cleartextTrafficDisabled':True,'androidBackupDisabled':True,'sameSigningCertificateAs010':'c4b7655cdefa8b130a85d15cabf80094a63ae00a9a698dbac5c11e8d2a6f5876' in receipt['signatureVerification'],'version':version,'mode':receipt['mode'],'sha256':receipt['sha256']}
assert checks['sameSigningCertificateAs010']
(r/'qa/standalone-apk-verification.json').write_text(json.dumps(checks,indent=2),encoding='utf-8')
print('Standalone APK verified: credentials absent, gateway absent, HTTPS only, backup disabled, same upgrade signature.')
