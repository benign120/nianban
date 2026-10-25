import { randomBytes, randomUUID } from 'node:crypto';

// Wire format checked against Tencent/openclaw-weixin 2.4.10, 2026-10-21.
// This is a small independent connection test, not an installed OpenClaw runtime.
export const BASE_URL = 'https://ilinkai.weixin.qq.com';
export const CHANNEL_VERSION = '2.4.10';
export function safeBase(value) {
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.port || u.username || u.password ||
      !(u.hostname === 'weixin.qq.com' || u.hostname.endsWith('.weixin.qq.com'))) {
    throw new Error('微信接口返回了未识别的服务地址');
  }
  return u.origin;
}
export function headers(token, isGet = false) {
  const common = { 'iLink-App-Id': 'bot', 'iLink-App-ClientVersion': String((2 << 16) | (4 << 8) | 10) };
  if (isGet) return common;
  return { ...common, 'Content-Type': 'application/json', AuthorizationType: 'ilink_bot_token',
    'X-WECHAT-UIN': Buffer.from(String(randomBytes(4).readUInt32BE(0))).toString('base64'),
    ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}
export async function request(base, endpoint, { token, body, timeout = 40000, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(new URL(endpoint, safeBase(base) + '/'), {
    method: body === undefined ? 'GET' : 'POST', redirect: 'error',
    headers: headers(token, body === undefined),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(timeout)
  });
  if (!res.ok) throw new Error(`微信接口 HTTP ${res.status}`);
  const text = await res.text();
  if (text.length > 2_000_000) throw new Error('微信接口响应过大');
  return JSON.parse(text);
}
export const baseInfo = () => ({ channel_version: CHANNEL_VERSION, bot_agent: 'Nianban/0.1.0' });
export function incomingText(msg, owner) {
  if (!owner || msg?.from_user_id !== owner || msg.message_type !== 1 || msg.group_id || !msg.message_id) return null;
  const text = (msg.item_list || []).filter(i => i.type === 1 && typeof i.text_item?.text === 'string')
    .map(i => i.text_item.text).join('\n').trim().slice(0, 4000);
  const sentDate=new Date(typeof msg.create_time_ms==='number'?msg.create_time_ms:NaN);
  const sentAt=Number.isFinite(sentDate.getTime())?sentDate.toISOString():null;
  return text ? { id: String(msg.message_id), text, contextToken: msg.context_token || '', sentAt } : null;
}
export function replyBody(owner, contextToken, text, clientId = 'nianban-' + randomUUID()) {
  if (!owner || !contextToken) throw new Error('缺少微信会话凭据，不能回复');
  return { msg: { from_user_id: '', to_user_id: owner, client_id: clientId,
    message_type: 2, message_state: 2, context_token: contextToken,
    item_list: [{ type: 1, text_item: { text } }] }, base_info: baseInfo() };
}
