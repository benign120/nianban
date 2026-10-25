import { validateInput, normalizeOutput, SYSTEM_PROMPT } from './agent.js';
import { tryLocalParse, needsExistingContext } from './local-parser.js';
const pending = new Map();
export function apiStatus() {
  try { if (window.NativeBridge?.apiStatus) return { native: true, ...JSON.parse(NativeBridge.apiStatus()) }; } catch {}
  return { native: false, configured: false, mode: 'direct' };
}
function request(kind, payload) {
  if (!window.NativeBridge) return Promise.reject(new Error('请在安卓安装版中配置 DeepSeek，浏览器可预览和手动添加任务'));
  return new Promise((resolve,reject) => {
    const requestId = 'ai-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('DeepSeek 响应超时，原话还在，可以重试')); },90000);
    pending.set(requestId,{resolve,reject,timer});
    try { if (kind === 'test') NativeBridge.testApiConnection(requestId); else NativeBridge.extractAI(requestId,JSON.stringify(payload)); }
    catch { clearTimeout(timer); pending.delete(requestId); reject(new Error('无法开始请求，请重新打开 App 后重试')); }
  });
}
export function handleAiEvent(event) {
  if (!['ai-result','ai-error'].includes(event.type)) return false;
  const item = pending.get(event.requestId);
  if (item) { clearTimeout(item.timer); pending.delete(event.requestId); if(event.type==='ai-error') item.reject(new Error(event.message || 'DeepSeek 请求失败')); else item.resolve(event.data); }
  return true;
}
export async function extractDirect(body) {
  const input = validateInput(body);
  const local = tryLocalParse(input);
  if (local) return local;
  if (!apiStatus().configured) { const error=new Error('这句话需要 AI 辅助理解，请先填写 API Key。常见的简单任务可以离线添加。'); error.code='NEEDS_API_KEY'; throw error; }
  const modelInput={...input,existingTasks:needsExistingContext(input.text)?input.existingTasks:[]};
  const response = await request('extract',{systemPrompt:SYSTEM_PROMPT,input:modelInput});
  let raw;
  try { raw=JSON.parse(response.content); } catch { throw new Error('模型返回格式异常，本次尚未保存任务，请重试'); }
  return {...normalizeOutput(raw,modelInput),mode:'direct',model:response.model,elapsedMs:response.elapsedMs,usage:response.usage,requestId:response.requestId};
}
export function testDirect() { return request('test'); }
