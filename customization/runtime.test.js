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
