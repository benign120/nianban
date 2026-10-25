"""Build a self-contained Android APK with the official Android command line tools."""
from pathlib import Path
import subprocess, os, json, secrets, shutil, zipfile, hashlib, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')

ROOT = Path(__file__).resolve().parents[1]
os.chdir(ROOT)
BUILD = ROOT / 'build'
for part in ('assets/web', 'generated', 'classes', 'dex', 'apk'):
    (BUILD / part).mkdir(parents=True, exist_ok=True)
(ROOT / 'dist').mkdir(exist_ok=True)
TOOLS = Path('toolchain/android-15')
PLATFORM = Path('toolchain/android-35/android.jar')
JAVA = Path('C:/JAVA/bin')

def run(args, env=None):
    result = subprocess.run([str(x) for x in args], cwd=ROOT, env=env, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if result.returncode:
        print(result.stdout[-5000:]); print(result.stderr[-5000:])
        raise RuntimeError('Build step failed: ' + str(args[0]))
    return result.stdout + result.stderr

model = Path('toolchain/vosk-model-small-cn-0.22.zip')
if not model.exists() or not zipfile.is_zipfile(model):
    raise RuntimeError('Offline Chinese voice model is not ready')
shutil.copytree(ROOT / 'web', BUILD / 'assets/web', dirs_exist_ok=True)
print('Preparing JavaScript for Huawei WebView...')
run([Path('toolchain/jsbuild/node_modules/@esbuild/win32-x64/esbuild.exe'), 'web/app.js', '--bundle', '--format=iife', '--target=chrome74', '--outfile=build/assets/web/app.js'])
index_file = BUILD / 'assets/web/index.html'
index_file.write_text(index_file.read_text(encoding='utf-8').replace('<script type="module" src="app.js"></script>', '<script defer src="app.js"></script>'), encoding='utf-8')
shutil.copyfile(model, BUILD / 'assets/voice-model.zip')
shutil.copyfile(ROOT/'android/buddy-config.json', BUILD/'assets/buddy-config.json')
local = ROOT / '.local'
local.mkdir(exist_ok=True)
# Builds are independent of the previous desktop gateway's credentials/config.
config = {'mode': 'hybrid', 'version': '0.6.0'}
(BUILD / 'assets/web/config.js').write_text('window.NIANBAN_CONFIG = ' + json.dumps(config, ensure_ascii=False) + ';\n', encoding='utf-8')

print('Compiling Android resources...')
print(run([TOOLS/'aapt.exe', 'package', '-f', '-m', '-J', 'build/generated', '-M', 'android/AndroidManifest.xml', '-S', 'android/res', '-A', 'build/assets', '-I', PLATFORM, '-F', 'build/apk/unsigned.apk']))
sources = list(Path('android/src').rglob('*.java')) + list(Path('build/generated').rglob('*.java'))
libs = [PLATFORM, Path('toolchain/vosk-android-0.3.75/classes.jar'), Path('toolchain/jna-5.18.1/classes.jar')]
# Remove only generated class outputs so stale classes never enter a new APK.
for cls in (BUILD/'classes').rglob('*.class'): cls.unlink()
print('Compiling Java and native voice bindings...')
print(run([JAVA/'javac.exe', '-encoding', 'UTF-8', '--release', '8', '-classpath', ';'.join(map(str, libs)), '-d', 'build/classes', *sources]))
print('Checking native reminder date calculations...')
test_cp = 'toolchain/json-test.jar;build/classes;' + str(PLATFORM)
run([JAVA/'javac.exe', '-encoding', 'UTF-8', '--release', '8', '-classpath', test_cp, '-d', 'build/test-classes', 'tests/ReminderClockTest.java'])
clock_results = run([JAVA/'java.exe', '-cp', 'build/test-classes;' + test_cp, 'com.zequn.nianban.ReminderClockTest'])
print(clock_results)
(ROOT/'qa/native-reminder-clock.txt').write_text(clock_results, encoding='utf-8')
run([JAVA/'javac.exe', '-encoding', 'UTF-8', '--release', '8', '-classpath', test_cp, '-d', 'build/test-classes', 'tests/NativeApiSecurityTest.java'])
security_results = run([JAVA/'java.exe', '-cp', 'build/test-classes;' + test_cp, 'com.zequn.nianban.NativeApiSecurityTest'])
print(security_results)
(ROOT/'qa/native-api-security.txt').write_text(security_results, encoding='utf-8')
run([JAVA/'javac.exe', '-encoding', 'UTF-8', '--release', '8', '-classpath', test_cp, '-d', 'build/test-classes', 'tests/NativeWeixinSecurityTest.java'])
weixin_results = run([JAVA/'java.exe', '-cp', 'build/test-classes;' + test_cp, 'com.zequn.nianban.NativeWeixinSecurityTest'])
print(weixin_results)
(ROOT/'qa/native-weixin-security.txt').write_text(weixin_results, encoding='utf-8')
run([JAVA/'javac.exe', '-encoding', 'UTF-8', '--release', '8', '-classpath', test_cp, '-d', 'build/test-classes', 'tests/WidgetTasksTest.java'])
widget_results = run([JAVA/'java.exe', '-cp', 'build/test-classes;' + test_cp, 'com.zequn.nianban.WidgetTasksTest'])
print(widget_results)
(ROOT/'qa/native-widget-tasks.txt').write_text(widget_results, encoding='utf-8')
with zipfile.ZipFile(BUILD/'classes.jar', 'w', zipfile.ZIP_DEFLATED) as jar:
    for file in (BUILD/'classes').rglob('*.class'): jar.write(file, file.relative_to(BUILD/'classes').as_posix())
print(run([JAVA/'java.exe', '-cp', TOOLS/'lib/d8.jar', 'com.android.tools.r8.D8', '--min-api', '26', '--lib', PLATFORM, '--output', 'build/dex', 'build/classes.jar', *libs[1:]]))
with zipfile.ZipFile(BUILD/'apk/unsigned.apk', 'a', zipfile.ZIP_DEFLATED) as apk:
    for file in (BUILD/'dex').glob('*.dex'): apk.write(file, file.name)
    for library in ('vosk-android-0.3.75', 'jna-5.18.1'):
        for abi in ('arm64-v8a', 'x86_64'):
            for file in (ROOT/'toolchain'/library/'jni'/abi).glob('*.so'):
                apk.write(file, 'lib/' + abi + '/' + file.name)
print('Aligning and signing APK...')
print(run([TOOLS/'zipalign.exe', '-f', '-p', '4', 'build/apk/unsigned.apk', 'build/apk/aligned.apk']))
signing_file = local/'signing.json'
if not signing_file.exists(): signing_file.write_text(json.dumps({'password': secrets.token_urlsafe(28)}), encoding='utf-8')
password = json.loads(signing_file.read_text())['password']
env = os.environ.copy(); env['NIANBAN_SIGN_PASSWORD'] = password
if not (local/'nianban-demo.jks').exists():
    run([JAVA/'keytool.exe', '-genkeypair', '-noprompt', '-keystore', '.local/nianban-demo.jks', '-alias', 'nianban-demo', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '3650', '-storepass:env', 'NIANBAN_SIGN_PASSWORD', '-keypass:env', 'NIANBAN_SIGN_PASSWORD', '-dname', 'CN=Nianban Personal Demo, O=Personal Project, C=CN'], env)
print(run([JAVA/'java.exe', '-jar', TOOLS/'lib/apksigner.jar', 'sign', '--ks', '.local/nianban-demo.jks', '--ks-key-alias', 'nianban-demo', '--ks-pass', 'env:NIANBAN_SIGN_PASSWORD', '--key-pass', 'env:NIANBAN_SIGN_PASSWORD', '--out', 'build/apk/nianban.apk', 'build/apk/aligned.apk'], env))
verification = run([JAVA/'java.exe', '-jar', TOOLS/'lib/apksigner.jar', 'verify', '--verbose', '--print-certs', 'build/apk/nianban.apk'])
print(verification)
badging = run([TOOLS/'aapt.exe', 'dump', 'badging', 'build/apk/nianban.apk'])
with zipfile.ZipFile(BUILD/'apk/nianban.apk') as apk:
    names = apk.namelist()
    for required in ('AndroidManifest.xml','classes.dex','assets/voice-model.zip','assets/web/app.js','lib/arm64-v8a/libvosk.so'):
        assert required in names, required
    bundled = apk.read('assets/web/app.js').decode('utf-8')
    assert all(value not in bundled for value in ('serverUrl', 'appToken', '8790', 'SHIBAN_CONFIG')), 'Legacy gateway code found in APK'
    assert '"mode": "hybrid"' in apk.read('assets/web/config.js').decode('utf-8')
dest = ROOT/'dist/念办_0.6.0_搭子与桌面版.apk'; shutil.copyfile(BUILD/'apk/nianban.apk', dest)
receipt = {'apk': str(dest), 'bytes': dest.stat().st_size, 'sha256': hashlib.sha256(dest.read_bytes()).hexdigest(), 'mode':'hybrid', 'requiresDesktopGateway':False, 'optionalWeixinRequiresComputer':True, 'weixinHosting':'PC LAN HTTPS with certificate pinning', 'apiKeyEmbedded':False, 'endpoint':'https://api.deepseek.com/chat/completions', 'credentialStorage':'Android Keystore AES-256-GCM; private encrypted preferences', 'androidMinApi': 26, 'androidTargetApi': 35, 'abis': ['arm64-v8a','x86_64'], 'voice': 'Vosk 0.3.75 + vosk-model-small-cn-0.22', 'signatureVerification': verification, 'badging': badging}
(BUILD/'apk/build-receipt.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding='utf-8')
print('APK READY:', dest.name, dest.stat().st_size, 'bytes')
