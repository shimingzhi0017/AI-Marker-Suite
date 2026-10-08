const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const result = scores => ({score:scores.reduce((a,b)=>a+b,0),subScores:scores.map((score,i)=>({label:String(i),score})),studentAnswer:'学生原文'});
function setup(a,b,third,missing=false) {
    let arbitrationCalls=0; let workflowQuestionType;
    const c={
        callDualEvaluation(){return 'original-subjective';}, WorkflowManager:{getWorkflow:()=>({model:{provider:'p',model:'a'},dualEval:{enabled:true,questionType:workflowQuestionType,secondary:{provider:'p',model:'b'},arbitration:{provider:'p',model:'c'},threshold:2}})},
        ProviderManager:{getCallConfig:(p,m)=>missing&&m==='c'?null:{apiKey:'test',endpoint:'test',model:m}},
        callAIGrading:async(images,cfg)=>cfg.model==='a'?a:b,
        buildSubQuestionPrompt:()=>'',buildStructuredPrompt:()=>'',collectFieldImages:()=>[],
        callAIWithRetry:async()=>{arbitrationCalls++;return 'third';},
        parseSubQuestionResponse:()=>third,parseStructuredResponse:()=>third
    };
    vm.createContext(c); vm.runInContext(fs.readFileSync(process.env.PERSONAL_DUAL_PATH,'utf8'),c);
    return {call:(questionType)=>{workflowQuestionType=questionType;return c.callDualEvaluation([],{questionType,scoring:{units:[{label:'0',maxScore:2},{label:'1',maxScore:2}]}},null);},count:()=>arbitrationCalls};
}
test('主观题使用原脚本双评规则',async()=>{const s=setup(result([2,0]),result([2,2]));assert.equal(await s.call('subjective'),'original-subjective');assert.equal(s.count(),0);});
test('总分相同但逐空不同也必须三评',async()=>{const s=setup(result([2,0]),result([0,2]),result([2,2]));assert.equal((await s.call()).score,4);assert.equal(s.count(),1);});
test('逐空一致直接通过，不调用三评',async()=>{const s=setup(result([2,0]),result([2,0]));assert.equal((await s.call()).score,2);assert.equal(s.count(),0);});
test('总分差小于默认阈值也不平均',async()=>{const s=setup(result([2,0]),result([2,2]),result([2,0]));assert.equal((await s.call()).score,2);assert.equal(s.count(),1);});
test('仲裁缺失暂停，不回退平均',async()=>{const s=setup(result([2,0]),result([2,2]),null,true);await assert.rejects(s.call(),/未配置完整/);});
test('仲裁分数缺失暂停',async()=>{const s=setup(result([2,0]),result([2,2]),{score:null});await assert.rejects(s.call(),/评分无效/);});
test('仲裁总分与逐空不一致暂停',async()=>{const s=setup(result([2,0]),result([2,2]),{...result([2,0]),score:4});await assert.rejects(s.call(),/总分不一致/);});
