import { normalizeOutput } from './agent.js';

const NUM='[0-9零〇一二两三四五六七八九十]+';
const PERIOD='凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜里';
const WEEK='[一二三四五六日天1-7]';
const DATE=new RegExp('^(今天|明天|后天|大后天|(?:(?:本|这|下)周|周|星期|礼拜)'+WEEK+'|[0-9]{4}年[0-9]{1,2}月[0-9]{1,2}[日号]|[0-9]{1,2}月[0-9]{1,2}[日号])');
const REPEAT=new RegExp('^(每天|每日|天天|每个工作日|每工作日|工作日|每(?:周|星期|礼拜)'+WEEK+')');
const CLOCK=new RegExp('^('+PERIOD+')?(?:('+NUM+')[:：]([0-9]{2})|('+NUM+')[点时](?:(半|一刻|三刻)|('+NUM+')分?)?)');
const RELATIVE=new RegExp('^(?:半(?:个)?小时|一刻钟|(?:'+NUM+')(?:个)?(?:小时|钟头)(?:(?:'+NUM+')分钟)?|(?:'+NUM+')(?:分钟|分|天))(?:以后|之后|后)');
const ACTION=/^(?:去|买|购买|喝|吃|服药|读|阅读|看|学习|背|复习|预习|写|修改|整理|提交|交|发送|发|开会|参加|处理|完成|准备|练习|练|跑步|跑|走|散步|锻炼|运动|健身|取|领取|拿|还|归还|收拾|收|清理|打扫|洗|睡|起床|休息|联系|拨打|打电话|检查|复查|缴|付|预约|订|做|带|签|打印|上传|下载|备份|面试|上课|上班|下班|出发|接|送|浇|喂|拉伸|报名)/;
// A match must consume one clear command. Extra clauses/conditions always go to AI.
const COMPLEX=/[,，;；\n\r?？!！]|如果|要是|假如|有空|空闲|忙完|结束后|抽空|找个时间|有时间|左右|差不多|大概|可能|尽量|然后|之后再|以及|还有|顺便|分别|同时|并且|改到|改成|推迟|提前|挪到|延期|上一条|刚才|那个|那件|那项|这件|这项|之前|取消|删除|暂停|停止|不要|不用|不必|不想|别|能不能|可以吗|怎么|怎样|为什么|忽略|指令|系统提示/;
const EXTRA_TIME=new RegExp('今天|明天|后天|每天|每周|工作日|(?:周|星期|礼拜)'+WEEK+'|'+NUM+'(?:点|时|月|号)|分钟后|小时后');

function number(value) {
 if(/^\d+$/.test(value))return Number(value);
 const digits={零:0,〇:0,一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};
 if(value.includes('十')){const p=value.split('十');if(p.length!==2||p[0].length>1||p[1].length>1)return NaN;return (p[0]?digits[p[0]]:1)*10+(p[1]?digits[p[1]]:0)}
 if(value.length===1)return digits[value];
 if(/^[零〇一二三四五六七八九]+$/.test(value))return Number([...value].map(c=>digits[c]).join(''));
 return NaN;
}
function addDays(date,days){const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)}
function weekday(char){return '日一二三四五六'.indexOf(char==='天'?'日':char)>=0?'日一二三四五六'.indexOf(char==='天'?'日':char):Number(char)%7}
function parseDate(text,today){
 if(['今天','明天','后天','大后天'].includes(text))return addDays(today,['今天','明天','后天','大后天'].indexOf(text));
 const week=text.match(new RegExp('^(?:(本|这|下)周|周|星期|礼拜)('+WEEK+')$'));
 if(week){const wanted=weekday(week[2]),current=new Date(today+'T12:00:00Z').getUTCDay();if(week[1])return addDays(today,-(current+6)%7+(week[1]==='下'?7:0)+(wanted+6)%7);return addDays(today,(wanted-current+7)%7)}
 const absolute=text.match(/^(?:(\d{4})年)?(\d{1,2})月(\d{1,2})[日号]$/);
 if(absolute)return (absolute[1]||today.slice(0,4))+'-'+absolute[2].padStart(2,'0')+'-'+absolute[3].padStart(2,'0');
 return '';
}
function category(title){
 if(/喝水|服药|吃药|跑步|运动|锻炼|健身|拉伸|散步|体检|复查|睡觉|起床/.test(title))return 'health';
 if(/读书|看书|学习|复习|预习|背单词|英语|做题|上课/.test(title))return 'study';
 if(/简历|报告|会议|开会|面试|工作|需求|方案|客户|文档|邮件/.test(title))return 'work';
 return 'life';
}
function compact(original){let text='',map=[];for(let i=0;i<original.length;i++){let ch=original[i];if(/\s/.test(ch))continue;if(/[０-９]/.test(ch))ch=String.fromCharCode(ch.charCodeAt(0)-65248);if(ch==='：')ch=':';text+=ch;map.push(i)}return {text,evidence:(a,b)=>a<b?original.slice(map[a],map[b-1]+1):''}}
function validCalendar(date){const d=new Date(date+'T12:00:00Z');return !isNaN(d)&&d.toISOString().slice(0,10)===date}

/** Returns null unless one whole supported instruction can be interpreted without guessing. */
export function tryLocalParse(input){
 const start=Date.now(),original=input.text;
 const compacted=compact(original);let text=compacted.text.replace(/[。．.]$/,'');
 if(!text||text.length>160)return null;
 if(/^(?:请)?(?:不要|不用|不必|别)(?:再)?提醒我[^,，;；\n?？]+$/.test(text)&&!/(?:改|然后|再去|但是|不过|并|和)/.test(text)){
  const result=normalizeOutput({tasks:[],questions:['没有新增任务。若要关闭已有提醒，请打开对应任务修改。']},input);
  return {...result,mode:'local',model:'本地处理',elapsedMs:Date.now()-start,usage:{inputTokens:0,outputTokens:0}};
 }
 if(COMPLEX.test(text))return null;
 let position=0,explicitReminder=false;
 const prefix=text.match(/^(?:请(?:你)?|麻烦(?:你)?|帮我)?(?:提醒我|提醒一下我|记得|记一下|记下|添加任务)?/)[0];
 if(prefix){position=prefix.length;explicitReminder=/提醒|记得|记一下|记下|添加任务/.test(prefix)}
 let dueDate='',dueTime='',dateText='',timeText='',recurrence='none',weekDay=null,questions=[];
 let rest=text.slice(position),m=rest.match(RELATIVE);
 if(m){
  const token=m[0];let minutes;
  if(token.startsWith('半'))minutes=30;
  else if(token.startsWith('一刻钟'))minutes=15;
  else {const pieces=[...token.matchAll(new RegExp('('+NUM+')(?:个)?(小时|钟头|分钟|分|天)','g'))];minutes=pieces.reduce((sum,p)=>sum+number(p[1])*({小时:60,钟头:60,分钟:1,分:1,天:1440}[p[2]]),0)}
  if(!Number.isFinite(minutes)||minutes<=0||minutes>10080)return null;
  const date=new Date(input.referenceDate+'T'+input.referenceTime+':00+08:00');date.setTime(date.getTime()+minutes*60000);
  const shifted=new Date(date.getTime()+8*3600000).toISOString();dueDate=shifted.slice(0,10);dueTime=shifted.slice(11,16);
  timeText=compacted.evidence(position,position+token.length);position+=token.length;
 }else{
  m=rest.match(REPEAT);
  if(m){
   const token=m[0];dateText=compacted.evidence(position,position+token.length);position+=token.length;dueDate=input.referenceDate;
   if(/工作日/.test(token))recurrence='weekdays';
   else if(/^每(?:周|星期|礼拜)/.test(token)){recurrence='weekly';weekDay=weekday(token.slice(-1))}
   else recurrence='daily';
  }else{
   m=rest.match(DATE);
   if(m){dateText=compacted.evidence(position,position+m[0].length);dueDate=parseDate(m[0],input.referenceDate);position+=m[0].length;if(!validCalendar(dueDate))return null}
  }
  rest=text.slice(position);m=rest.match(CLOCK);
  if(m){
   const token=m[0],period=m[1],h=number(m[2]||m[4]),minute=m[3]?Number(m[3]):m[5]?({半:30,一刻:15,三刻:45}[m[5]]):m[6]?number(m[6]):0;
   if(!Number.isInteger(h)||h<0||h>23||!Number.isInteger(minute)||minute<0||minute>59)return null;
   let hour=h;
   if(period){
    if(h>12)return null;
    if(period==='下午'){if(h<1||h===12)return null;hour=h+12}
    else if(period==='晚上'){if(h<5||h>11)return null;hour=h+12}
    else if(period==='傍晚'){if(h<5||h>8)return null;hour=h+12}
    else if(period==='夜里')return null;
    else if(period==='中午'){if(h===0||h<11&&h>2)return null;hour=h===12?h:h<=2?h+12:h}
    else if(period==='凌晨'){hour=h===12?0:h}
    else {if(h===12)hour=12}
   }else if(!m[2]&&h>=1&&h<=12){questions.push('你说的是上午还是下午？请确认提醒时刻。');hour=null}
   timeText=compacted.evidence(position,position+token.length);position+=token.length;
   if(hour!==null)dueTime=String(hour).padStart(2,'0')+':'+String(minute).padStart(2,'0');
   if(!dueDate)dueDate=input.referenceDate;
  }else{
   // "明天下午" gives a date but no invented clock time.
   const periodOnly=rest.match(new RegExp('^('+PERIOD+')'));
   if(periodOnly){if(!dueDate)return null;timeText=compacted.evidence(position,position+periodOnly[0].length);position+=periodOnly[0].length}
  }
 }
 rest=text.slice(position);
 const command=rest.match(/^(?:提醒我|提醒一下我|帮我记得|记得|记一下|记下|我要|我需要)/);
 if(command){explicitReminder=true;position+=command[0].length;rest=text.slice(position)}
 rest=rest.replace(/(?:谢谢|就好|就行)$/,'');
 const urgent=rest.match(/^(?:紧急|加急)/);const action=urgent?rest.slice(urgent[0].length):rest;
 if(!action||action.length<2||action.length>40||!ACTION.test(action))return null;
 if(/[和与及并再或吗呢吧]/.test(rest)||COMPLEX.test(rest)||EXTRA_TIME.test(rest))return null;
 if(/前|后|提醒|记得|已经|正在|刚刚|有益|很好|很重要|值得|听说|了|过/.test(rest))return null;
 if(!dateText&&!timeText&&!explicitReminder&&/^(?:请|帮我|麻烦)/.test(text))return null;
 if(!dateText&&!timeText&&!explicitReminder&&/^完成/.test(rest))return null;
 if(!dateText&&!timeText&&!explicitReminder&&!/^(?:买(?:牛奶|菜|水果|面包|鸡蛋)|喝水|吃饭|看书|读书|跑步|散步|运动|休息|睡觉|起床|整理(?:资料|照片|房间|简历)|修改简历|取快递|交报告|写报告|打扫(?:房间|卫生)|复习英语)$/.test(rest))return null;
 const title=rest,raw={title,dueDate,dueTime,dateText,timeText,recurrence,weekDay,category:category(title),priority:urgent?'high':'normal',sourceQuote:original,questions,intent:'create',targetTaskId:''};
 const result=normalizeOutput({summary:'已识别这条待办',tasks:[raw],questions:[]},input);
 return {...result,mode:'local',model:'本地处理',elapsedMs:Date.now()-start,usage:{inputTokens:0,outputTokens:0}};
}

export function needsExistingContext(text){return /(?:把|将|改到|改成|改为|改一下|设为|变成|调整|推迟|提前|挪到|延期|晚一点|早一点|晚点|早点|延长|缩短|取消|删除|刚才|上一条|那项|那件|那个|这件|这项|之前|原来)|^(?:请|帮我|麻烦)?完成/.test(text)}
