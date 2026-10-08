const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('src/core/ai-engine.js', 'utf8');
const transport = source.slice(source.indexOf('function normalizeChatEndpoint('), source.indexOf('// ========== 双评引擎 =========='));
const config = { endpoint: 'https://example.test/chat/completions', apiKey: 'test', model: 'vision', outputLimitEnabled: false };
const event = (choice, usage) => `data: ${JSON.stringify({ choices: [choice], usage })}\n\n`;

function setup(responses) {
    const requests = [];
    const context = {
        console: { log() {}, warn() {}, error() {} },
        URL,
        window: { aiGradingState: { abortController: new AbortController() } },
        setTimeout: callback => callback(),
        GM_xmlhttpRequest(options) {
            requests.push(JSON.parse(options.data));
            const response = responses.shift();
            if (!response) throw new Error('测试响应已耗尽：发生了非预期重试');
            queueMicrotask(() => {
                if (response.kind === 'timeout') options.ontimeout();
                else if (response.kind === 'network') options.onerror();
                else options.onload({ status: response.status || 200, responseText: response.body });
            });
            return { abort() {} };
        }
    };
    vm.createContext(context);
    vm.runInContext(transport, context);
    return { call: (override = config) => context.callAI('题目', ['image'], override), requests, context };
}

test('服务网关基础地址补齐chat/completions，完整端点不重复追加', () => {
    const { context } = setup([]);
    assert.equal(context.normalizeChatEndpoint('https://code.ppxwo.de/v1'), 'https://code.ppxwo.de/v1/chat/completions');
    assert.equal(context.normalizeChatEndpoint('https://example.test/compatible-mode/v1/'), 'https://example.test/compatible-mode/v1/chat/completions');
    assert.equal(context.normalizeChatEndpoint(config.endpoint), config.endpoint);
});

test('HTTP200的HTML网页不当作空评分，也不重试', async () => {
    const { call, requests } = setup([{ body: '<!doctype html><html>Gateway</html>' }]);
    await assert.rejects(call(), /HTML网页/);
    assert.equal(requests.length, 1);
});

test('兼容Chat Completions内容数组', async () => {
    const { call } = setup([{ body: JSON.stringify({ choices: [{ message: { content: [{ type: 'text', text: '得分：6' }] }, finish_reason: 'stop' }] }) }]);
    assert.equal(await call(), '得分：6');
});

test('兼容Responses消息正文且不把思考文本当结果', async () => {
    const { call } = setup([{ body: JSON.stringify({ status: 'completed', output: [
        { type: 'reasoning', summary: [{ type: 'summary_text', text: '思考' }] },
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '得分：6' }] }
    ] }) }]);
    assert.equal(await call(), '得分：6');
});

test('完整响应的SSE最后一行没有换行仍然解析', async () => {
    const { call } = setup([{ body: 'data: ' + JSON.stringify({ choices: [{ delta: { content: '得分：6' }, finish_reason: 'stop' }] }) }]);
    assert.equal(await call(), '得分：6');
});

test('Responses未完成状态不采纳部分分数', async () => {
    const { call } = setup([{ body: JSON.stringify({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output_text: '得分：6' }) }]);
    await assert.rejects(call(), /未完成/);
});

test('Responses流式失败不采纳已有分数，即使收到DONE', async () => {
    const body = 'data: ' + JSON.stringify({ type: 'response.output_text.delta', delta: '得分：6' }) + '\n\n' +
        'data: ' + JSON.stringify({ type: 'response.failed', response: { error: { message: '输出失败' } } }) + '\n\ndata: [DONE]\n';
    const { call } = setup([{ body }]);
    await assert.rejects(call(), /输出失败/);
});

test('开启输出额度时仅升级一次，并且只采纳完整重试结果', async () => {
    const { call, requests } = setup([
        { body: event({ delta: { content: '得分：1' }, finish_reason: 'length' }) },
        { body: event({ delta: { content: '得分：6' }, finish_reason: 'stop' }) }
    ]);
    assert.equal(await call({ ...config, outputLimitEnabled: true, maxOutputTokens: 2048 }), '得分：6');
    assert.equal(requests[0].max_tokens, 2048);
    assert.equal(Object.hasOwn(requests[1], 'max_tokens'), false);
    assert.equal(requests.length, 2);
});

test('默认请求使用接口输出额度并取得思考后的评分正文', async () => {
    const body = event({ delta: { reasoning_content: '思考'.repeat(6000) }, finish_reason: null }) +
        event({ delta: { content: '得分：12' }, finish_reason: null }) +
        event({ delta: {}, finish_reason: 'stop' }) + 'data: [DONE]\n\n';
    const { call, requests } = setup([{ body }]);
    assert.equal(await call(), '得分：12');
    assert.equal(Object.hasOwn(requests[0], 'max_tokens'), false);
    assert.equal(requests.length, 1);
});

test('接口默认额度截断时不使用部分评分或重复请求', async () => {
    const body = event({ delta: { content: '得分：1' }, finish_reason: 'length' });
    const { call, requests } = setup([{ body }]);
    await assert.rejects(call(), /结果不完整/);
    assert.equal(requests.length, 1);
});

test('超时状态不明时不重复发送请求', async () => {
    const { call, requests } = setup([{ kind: 'timeout' }]);
    await assert.rejects(call(), /请求超时/);
    assert.equal(requests.length, 1);
});

test('明确的服务端错误至多重试一次', async () => {
    const body = event({ delta: { content: '完成' }, finish_reason: 'stop' });
    const { call, requests } = setup([{ status: 503, body: '忙' }, { body }]);
    assert.equal(await call(), '完成');
    assert.equal(requests.length, 2);
});

test('流式响应缺少结束标记时暂停', async () => {
    const { call } = setup([{ body: event({ delta: { content: '得分：1' }, finish_reason: null }) }]);
    await assert.rejects(call(), /未完整结束/);
});

test('限流后截断时停止请求并保留待核查状态', async () => {
    const truncated = event({ delta: { reasoning_content: '思考' }, finish_reason: 'length' });
    const { call, requests } = setup([
        { status: 429, body: JSON.stringify({ error: { message: 'rate limit' } }) },
        { body: truncated }
    ]);
    await assert.rejects(call(), /结果不完整/);
    assert.equal(requests.length, 2);
});

test('普通 JSON 响应的截断标记同样阻止评分', async () => {
    const body = JSON.stringify({ choices: [{ message: { content: '得分：1' }, finish_reason: 'length' }] });
    const { call, requests } = setup([{ body }]);
    await assert.rejects(call(), /结果不完整/);
    assert.equal(requests.length, 1);
});
