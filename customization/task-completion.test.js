const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
function setup(text='您该题任务量已完成，请选择继续多阅或切换到下一题？切换下一题继续多阅',duplicates=false) {
    let clicks=0;const container={textContent:text,tagName:'DIV',getClientRects:()=>[1],parentElement:null};
    const button={textContent:'继续多阅',parentElement:container,getClientRects:()=>[1],click(){clicks++;}};
    const next={...button,textContent:'切换下一题'};
    const doc={querySelectorAll:()=>duplicates?[button,{...button},next]:[button,next],defaultView:{getComputedStyle:()=>({visibility:'visible',display:'block'})}};
    const c={document:{querySelector:()=>null}};vm.createContext(c);vm.runInContext(fs.readFileSync(process.env.PERSONAL_COMPLETION_PATH,'utf8'),c);
    return {doc,c,clicks:()=>clicks};
}
test('明确任务完成弹窗自动多阅且同一弹窗只点击一次',()=>{const s=setup();const seen=new WeakSet();const state={isRunning:true,isPaused:false};assert.equal(s.c.handlePersonalTaskCompletion(s.doc,'more',state,seen),true);assert.equal(s.c.handlePersonalTaskCompletion(s.doc,'more',state,seen),false);assert.equal(s.clicks(),1);assert.equal(state.isRunning,true);});
test('自动切题先暂停旧题评分',()=>{const s=setup();const state={isRunning:true,isPaused:false,abortController:{abort(){state.aborted=true;}}};assert.equal(s.c.handlePersonalTaskCompletion(s.doc,'next',state,new WeakSet()),true);assert.equal(state.isPaused,true);assert.equal(state.aborted,true);});
test('手动模式或暂停状态不点击',()=>{const s=setup();assert.equal(s.c.handlePersonalTaskCompletion(s.doc,'manual',{isRunning:true},new WeakSet()),false);assert.equal(s.c.handlePersonalTaskCompletion(s.doc,'more',{isRunning:true,isPaused:true},new WeakSet()),false);assert.equal(s.clicks(),0);});
test('其他弹窗和重复按钮不点击',()=>{for(const s of [setup('普通确认继续多阅切换下一题'),setup(undefined,true)])assert.equal(s.c.handlePersonalTaskCompletion(s.doc,'more',{isRunning:true},new WeakSet()),false);});
