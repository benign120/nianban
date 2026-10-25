import test from 'node:test';
import assert from 'node:assert/strict';
import { safeBase, headers, incomingText, replyBody, request } from '../protocol.mjs';
test('only Tencent Weixin HTTPS origins can receive bot credentials',()=>{
 assert.equal(safeBase('https://ilinkai.weixin.qq.com/path'),'https://ilinkai.weixin.qq.com');
 for(const u of ['http://ilinkai.weixin.qq.com','https://ilinkai.weixin.qq.com.evil.example','https://evilweixin.qq.com','https://user:pass@ilinkai.weixin.qq.com','https://127.0.0.1:8792'])assert.throws(()=>safeBase(u));
});
test('auth metadata matches checked official channel version',()=>{
 assert.equal(headers('secret').Authorization,'Bearer secret');assert.equal(headers('',true).Authorization,undefined);assert.equal(headers('',true)['iLink-App-ClientVersion'],'132106');
});
test('only owning account direct text can reach the connection test',()=>{
 const m={from_user_id:'owner',message_type:1,message_id:123,item_list:[{type:1,text_item:{text:'测试连接'}}],context_token:'ctx'};
 assert.equal(incomingText(m,'owner').text,'测试连接');assert.equal(incomingText(m,'stranger'),null);assert.equal(incomingText({...m,group_id:'group'},'owner'),null);assert.equal(incomingText({...m,message_type:2},'owner'),null);assert.equal(incomingText({...m,item_list:[]},'owner'),null);
});
test('reply requires conversation context, returns no task creation claim',()=>{
 assert.throws(()=>replyBody('owner','','test'));const body=replyBody('owner','ctx','test','fixed');assert.equal(body.msg.to_user_id,'owner');assert.equal(body.msg.context_token,'ctx');assert.equal(body.msg.client_id,'fixed');
});
test('requests reject redirects and do not expose token in errors',async()=>{
 let seen;await assert.rejects(request('https://ilinkai.weixin.qq.com','ilink/bot/getupdates',{token:'secret',body:{},fetchImpl:async(u,o)=>{seen=o;return {ok:false,status:403}}}),/HTTP 403/);assert.equal(seen.redirect,'error');assert.equal(seen.headers.Authorization,'Bearer secret');
});
