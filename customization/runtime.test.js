const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
test('注入保留四种原始评分内容，并将所有更新路径导向个人发布', () => {
    const context = {console};
    vm.createContext(context);
    const prompt = fs.readFileSync('src/core/prompt.js', 'utf8');
    vm.runInContext(prompt, context);
    const config = {question:'测试题干', answer:'原答案', rubric:'原规则', maxScore:8, subQuestions:[{label:'第一空',maxScore:2,answer:'CBA'}]};
    const args = {
        buildStructuredPrompt:[config], buildPrompt:[config], buildSubQuestionPrompt:[config],
        buildArbitrationPrompt:[config,{score:2},{score:4},0]
    };
    const originals = Object.fromEntries(Object.entries(args).map(([name,a]) => [name,context[name](...a)]));
    vm.runInContext("const SCRIPT_CONFIG = {CHANNELS:{stable:{},dev:{},preview:{}}}; const PERSONAL_RELEASE_URL = 'https://github.com/example/repo/releases/download/personal-latest'; function getChannelUrls() {}",context);
    vm.runInContext(fs.readFileSync(process.env.PERSONAL_RUNTIME_PATH, 'utf8'),context);
    for (const [name,a] of Object.entries(args)) {
        const result = context[name](...a);
        assert.ok(result.startsWith(originals[name]));
        assert.ok(result.includes('涂改与移位答案识别规则'));
    }
    assert.equal(context.getChannelUrls().scriptUrl,'https://github.com/example/repo/releases/download/personal-latest/ai_marker.user.js');
    assert.equal(vm.runInContext('SCRIPT_CONFIG.CHANNELS.dev.scriptUrl === SCRIPT_CONFIG.CHANNELS.preview.scriptUrl',context),true);
});
test('模型目录合并不覆盖密钥、用户地址、标签或工作流', () => {
    const context = {console};
    vm.createContext(context);
    vm.runInContext(fs.readFileSync('src/core/prompt.js', 'utf8'),context);
    vm.runInContext(`const PERSONAL_RELEASE_URL = ''; const PERSONAL_MODEL_CATALOG = ['qwen3.8-flash','qwen-vl-plus']; const PERSONAL_OPENAI_MODEL_CATALOG = ['gpt-6-luna']; const PERSONAL_GEMINI_MODEL_CATALOG = ['gemini-flash-latest'];
        const ProviderManager = {data:{providers:{'千问个人接口':{apiKey:'local-test',endpoint:'user-endpoint',models:{'qwen3.8-flash':{label:'用户标签'}}}},activeProvider:'原供应商'},save(){}};`,context);
    vm.runInContext(fs.readFileSync(process.env.PERSONAL_RUNTIME_PATH,'utf8'),context);
    assert.equal(vm.runInContext("ProviderManager.data.providers['千问个人接口'].apiKey",context),'local-test');
    assert.equal(vm.runInContext("ProviderManager.data.providers['千问个人接口'].endpoint",context),'user-endpoint');
    assert.equal(vm.runInContext("ProviderManager.data.providers['千问个人接口'].models['qwen3.8-flash'].label",context),'用户标签');
    assert.equal(vm.runInContext("ProviderManager.data.activeProvider",context),'原供应商');
    assert.equal(vm.runInContext("!!ProviderManager.data.providers['千问个人接口'].models['qwen-vl-plus']",context),true);
    assert.equal(vm.runInContext("ProviderManager.data.providers['OpenAI个人接口'].endpoint",context),'https://code.ppxwo.de/v1/chat/completions');
    assert.equal(vm.runInContext("ProviderManager.data.providers['OpenAI个人接口'].apiKey",context),'');
    assert.equal(vm.runInContext("!!ProviderManager.data.providers['OpenAI个人接口'].models['gpt-6-luna']",context),true);
    assert.equal(vm.runInContext("ProviderManager.data.providers['Gemini官方接口'].endpoint",context),'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
    assert.equal(vm.runInContext("ProviderManager.data.providers['Gemini官方接口'].apiKey",context),'');
});
