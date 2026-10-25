import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { BASE_URL, safeBase, request, baseInfo, incomingText, replyBody } from './protocol.mjs';
import { Store } from './store.mjs';
import { createTaskHandler } from './tasks.mjs';
import { startLan } from './lan.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.NIANBAN_WEIXIN_DATA || path.join(root, '.local', 'weixin');
fs.mkdirSync(dataDir, { recursive: true, mode:0o700 });
const PORT = 8792, origin = `http://127.0.0.1:${PORT}`;
const read = (name, fallback) => { try { return JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8').replace(/^\uFEFF/, '')); } catch { return fallback; } };
const write = (name, value) => {
  const target = path.join(dataDir, name), temporary = target + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 }); fs.renameSync(temporary, target);
};
const store = new Store(path.join(dataDir,'tasks.sqlite'));
const deviceConfig=read('device.json',{});
if(!deviceConfig.token){deviceConfig.token=randomBytes(32).toString('hex');write('device.json',deviceConfig);}
const taskCreationEnabled=process.env.NIANBAN_WEIXIN_TASKS==='1';
const taskHandler=createTaskHandler({store,enabled:()=>taskCreationEnabled,key:()=>process.env.DEEPSEEK_API_KEY||read('ai.json',{}).apiKey||read('../settings.json',{}).apiKey||''});
function deviceAuthorized(req){const a=Buffer.from(String(req.headers.authorization||'').replace(/^Bearer /,'')),b=Buffer.from(deviceConfig.token);return a.length===b.length&&timingSafeEqual(a,b);}
let credentials = read('credentials.json', null);
let session = null, qrSvg = '', loginLoop = false, receiving = false, stopping = false;
let status = { stage: credentials ? 'connected' : 'starting', message: '正在准备微信连接', lastMessage: null, lastReply: false, receivedCount: 0 };
const receipt = read('test-receipt.json', { ids: [], cursor: '' });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let lastPhoneContact='';
const lan=startLan({dataDir,authorize:deviceAuthorized,inbox:after=>store.inbox(after),onSynced:()=>{lastPhoneContact=new Date().toISOString();}});
function publicState() { return { ...status, hasQr: !!qrSvg, testOnly: !taskCreationEnabled, taskCreationEnabled, taskCount:store.existing().length,lan:lan.info(),lastPhoneContact }; }
async function prepareLogin() {
  if (loginLoop || credentials) return;
  status = { ...status, stage: 'starting', message: '正在获取微信二维码' };
  const r = await request(BASE_URL, 'ilink/bot/get_bot_qrcode?bot_type=3', { body: { local_token_list: [] }, timeout: 20000 });
  if (r.ret || !r.qrcode || typeof r.qrcode_img_content !== 'string') throw new Error('微信暂未提供有效的登录二维码');
  const qrUrl = new URL(r.qrcode_img_content);
  if (qrUrl.protocol !== 'https:' || !(qrUrl.hostname === 'qq.com' || qrUrl.hostname.endsWith('.qq.com'))) throw new Error('登录二维码地址未通过校验');
  session = { qrcode: r.qrcode, base: BASE_URL, expiresAt: Date.now() + 300000, verifyCode: '' };
  qrSvg = await QRCode.toString(r.qrcode_img_content, { type: 'svg', margin: 3, width: 320 });
  fs.writeFileSync(path.join(dataDir, 'login-qr.svg'), qrSvg);
  status = { ...status, stage: 'waiting', message: '请用手机微信扫一扫，按手机页面提示确认' };
  void pollLogin();
}
async function pollLogin() {
  if (loginLoop) return;
  loginLoop = true;
  try {
    while (!stopping && session && Date.now() < session.expiresAt) {
      const query = new URLSearchParams({ qrcode: session.qrcode });
      if (session.verifyCode) { query.set('verify_code', session.verifyCode); session.verifyCode = ''; }
      let r;
      try { r = await request(session.base, 'ilink/bot/get_qrcode_status?' + query, { timeout: 40000 }); }
      catch { status.message = '连接暂时波动，正在继续等待微信授权'; await sleep(2000); continue; }
      if (r.status === 'confirmed') {
        if (!r.bot_token || !r.ilink_user_id || !r.ilink_bot_id) throw new Error('微信授权缺少必要凭据');
        credentials = { token: r.bot_token, owner: r.ilink_user_id, botId: r.ilink_bot_id, base: safeBase(r.baseurl || session.base), authorizedAt: new Date().toISOString() };
        write('credentials.json', credentials);
        status = { ...status, stage: 'connected', message: '微信授权成功。请在手机中新出现的助手会话里发送：测试连接' };
        qrSvg = ''; session = null; void receive(); return;
      }
      if (r.status === 'scaned_but_redirect' && r.redirect_host) { session.base = safeBase(r.redirect_host.startsWith('https://') ? r.redirect_host : 'https://' + r.redirect_host); }
      else if (r.status === 'scaned') { status.stage = 'scanned'; status.message = '已扫码，请在手机微信中确认授权'; }
      else if (r.status === 'need_verifycode') { status.stage = 'verify'; status.message = '微信要求配对码，请将手机显示的配对码填写在此页面'; }
      else if (r.status === 'verify_code_blocked') { status.stage = 'expired'; status.message = '配对失败次数过多，请刷新二维码'; return; }
      else if (r.status === 'expired') { status.stage = 'expired'; status.message = '二维码已过期，请点击刷新二维码'; return; }
      else if (r.status === 'binded_redirect') { status.stage = 'error'; status.message = '微信提示已绑定其他实例，本次没有取得授权凭据；请先检查手机的绑定信息'; return; }
      await sleep(1000);
    }
    if (!stopping) { status.stage = 'expired'; status.message = '二维码已过期，请点击刷新二维码'; }
  } catch { status.stage = 'error'; status.message = '微信授权暂未完成，请刷新后重试'; }
  finally { loginLoop = false; }
}
async function receive() {
  if (receiving || !credentials) return;
  receiving = true;
  try {
    while (!stopping && credentials) {
      try {
        const r = await request(credentials.base, 'ilink/bot/getupdates', { token: credentials.token,
          body: { get_updates_buf: receipt.cursor || '', base_info: baseInfo() }, timeout: 45000 });
        if (r.ret || r.errcode) {
          status.message = '微信消息连接暂不可用，请检查授权状态';
          if (r.ret === -14 || r.errcode === -14) { status.stage = 'error'; return; }
          await sleep(5000); continue;
        }
        for (const msg of r.msgs || []) {
          const item = incomingText(msg, credentials.owner);
          if (!item || receipt.ids.includes(item.id)) continue;
          status.lastMessage = { text: item.text, at: new Date().toISOString() }; status.receivedCount++;
          status.lastReply = false;
          const reply=await taskHandler(item);
          if (item.contextToken) {
            const sent = await request(credentials.base, 'ilink/bot/sendmessage', { token: credentials.token,
              body: replyBody(credentials.owner, item.contextToken, reply, 'nianban-msg-'+item.id), timeout: 20000 });
            status.lastReply = !sent.ret && !sent.errcode;
          }
          receipt.ids.push(item.id); receipt.ids = receipt.ids.slice(-1000); write('test-receipt.json', receipt);
          status.message = status.lastReply ? taskCreationEnabled?'微信消息已处理并回复。任务等待手机同步。':'微信收发测试成功。下一步接入念办任务同步。' : '微信消息已收到，回复尚未确认成功。';
          write('connection-proof.json', { authorized: true, received: true, replied: status.lastReply, at: new Date().toISOString(), taskSyncImplemented: true, phonePersistenceVerified:false });
        }
        if (r.get_updates_buf) receipt.cursor = r.get_updates_buf;
        write('test-receipt.json', receipt);
        // Avoid a busy loop if the backend returns immediately.
        await sleep(500);
      } catch { status.message = '微信连接暂时中断，正在重连'; await sleep(4000); }
    }
  } finally { receiving = false; }
}
const htmlPath = path.join(root, 'weixin', 'setup.html');
const server = http.createServer(async (req, res) => {
  if(req.method==='GET'&&new URL(req.url,origin).pathname==='/api/device/inbox'){
    res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json; charset=utf-8');
    if(!deviceAuthorized(req)){res.writeHead(401).end(JSON.stringify({error:'连接码无效'}));return;}
    try{const u=new URL(req.url,origin),after=Number(u.searchParams.get('after')||0),payload=store.inbox(after);res.writeHead(200).end(JSON.stringify(payload));}
    catch{res.writeHead(400).end(JSON.stringify({error:'同步请求格式无效'}));}return;
  }
  if (!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress) || req.headers.host !== `127.0.0.1:${PORT}` && req.headers.host !== `localhost:${PORT}`) { res.writeHead(403).end(); return; }
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY');
  const url = new URL(req.url, origin);
  if (req.method === 'GET' && url.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(fs.readFileSync(htmlPath)); return; }
  if (req.method === 'GET' && url.pathname === '/api/status') { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(publicState())); return; }
  if (req.method === 'POST' && url.pathname === '/api/pairings') {
    if(req.headers.origin!==origin){res.writeHead(403).end();return;}
    const pairings=lan.pairings(deviceConfig.token);res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'}).end(JSON.stringify({pairings}));return;
  }
  if (req.method === 'GET' && url.pathname === '/qr.svg' && qrSvg) { res.writeHead(200, { 'Content-Type': 'image/svg+xml' }).end(qrSvg); return; }
  if (req.method === 'POST' && ['/api/refresh', '/api/verify'].includes(url.pathname)) {
    if (req.headers.origin !== origin) { res.writeHead(403).end(); return; }
    try {
      if (url.pathname === '/api/refresh') { if (!loginLoop && !credentials) await prepareLogin(); }
      else {
        let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 256) throw new Error('input'); }
        const code = JSON.parse(body).code;
        if (!session || status.stage !== 'verify' || !/^\d{4,12}$/.test(code)) throw new Error('input');
        session.verifyCode = code; status.message = '正在向微信验证配对码';
      }
      res.writeHead(200).end('{}');
    } catch { res.writeHead(400).end('{}'); }
    return;
  }
  res.writeHead(404).end();
});
server.listen(PORT, '127.0.0.1', () => {
  console.log(`念办微信连接页面：${origin}`);
  fs.writeFileSync(path.join(dataDir,'service.pid'),String(process.pid));
  if (credentials) { status.message = taskCreationEnabled?'电脑正在接收微信任务。手机连接同一局域网后，打开念办同步。':'已有微信授权，正在连接。可在助手会话里发送：测试连接'; void receive(); }
  else void prepareLogin().catch(() => { status.stage = 'error'; status.message = '获取微信二维码失败，请点击刷新重试'; });
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stopping = true; lan.server?.close(); server.close(); store.close(); process.exit(0); });
