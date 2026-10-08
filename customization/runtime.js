function buildFinalAnswerRecognitionRules() {
    return `

===== 涂改与移位答案识别规则 =====
先确定学生最终保留的作答，再按评分标准判分。
1. 检查当前小题的整个答题区域，包括横线上下、左右旁边的空白和箭头指向位置，不得只读取横线上的文字。以题号、布局、箭头和涂改关系归属答案，不能串入邻题或其他行的答案。
2. 明确划掉、涂黑或覆盖的旧答案不参与评分。若同一空附近另有清楚且未划掉的替代答案，应读取该替代答案；不能因为横线上涂黑就判未作答、无法识别或错误。
3. 正确答案写在对应空的上方、下方或旁边，只要归属明确且清晰可读，填写位置偏移和涂改本身不扣分。
4. 不得用标准答案猜测模糊字迹。多个未划掉的答案且无法确定最终答案、归属不明或图片裁掉替代答案时，明确写“未能识别（最终答案不确定）”，不要声称已识别出错误答案。
5. 在答案复述中逐空记录最终保留的原文；发生涂改时简述替代答案位置和旧答案已划掉，不把旧答案混入最终答案。保留实际数字、小数位和符号，不自行改成标准答案。
6. 识别规则不放宽内容评分：最终答案仍严格遵循该题的标准答案、有效数字和给分规则。`;
}

function installPersonalModelProvider(ids) {
    const name = '千问个人接口';
    const providers = ProviderManager.data.providers;
    let provider = providers[name];
    if (!provider) {
        provider = providers[name] = {
            endpoint: 'https://maas.qianwenaiapi.com/compatible-mode/v1/chat/completions',
            apiKey: '', models: {}
        };
    }
    provider.models ||= {};
    // 保留用户密钥、自定义地址、已有模型标签及当前工作流。
    for (const id of ids) {
        if (!provider.models[id]) provider.models[id] = {label: id, tags: []};
    }
    ProviderManager.save();
    return provider;
}
if (typeof PERSONAL_MODEL_CATALOG !== 'undefined' && typeof ProviderManager !== 'undefined') {
    installPersonalModelProvider(PERSONAL_MODEL_CATALOG);
    if (typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand('刷新千问个人接口模型列表', () => {
            const provider = ProviderManager.getProvider('千问个人接口');
            if (!provider.apiKey) { alert('请先在供应商设置中填写千问个人接口的API密钥。'); return; }
            GM_xmlhttpRequest({
                method: 'GET', url: 'https://maas.qianwenaiapi.com/compatible-mode/v1/models',
                headers: {Authorization: 'Bearer ' + provider.apiKey}, timeout: 30000,
                onload(res) {
                    try {
                        if (res.status !== 200) throw Error('HTTP ' + res.status);
                        const body = JSON.parse(res.responseText);
                        if (!Array.isArray(body.data)) throw Error('模型列表格式无效');
                        const ids = [...new Set(body.data.map(m => m?.id).filter(id => typeof id === 'string'))];
                        if (!ids.length) throw Error('没有可用模型');
                        installPersonalModelProvider(ids);
                        alert('已获取' + ids.length + '个模型。重新打开设置即可查看；列表不代表视觉能力已验证。');
                    } catch (e) { alert('获取模型列表失败：' + e.message); }
                },
                onerror() { alert('获取模型列表失败：网络错误'); },
                ontimeout() { alert('获取模型列表超时'); }
            });
        });
    }
}


// 在所有定义加载后、阅卷主逻辑运行前追加个性化识别规则。
for (const name of ['buildStructuredPrompt', 'buildPrompt', 'buildSubQuestionPrompt', 'buildArbitrationPrompt']) {
    const original = eval(name);
    const wrapped = function(...args) { return original(...args) + buildFinalAnswerRecognitionRules(); };
    switch (name) {
        case 'buildStructuredPrompt': buildStructuredPrompt = wrapped; break;
        case 'buildPrompt': buildPrompt = wrapped; break;
        case 'buildSubQuestionPrompt': buildSubQuestionPrompt = wrapped; break;
        case 'buildArbitrationPrompt': buildArbitrationPrompt = wrapped; break;
    }
}
// 三个更新渠道都只指向个性化发布，防止官方脚本覆盖规则。
if (PERSONAL_RELEASE_URL) {
    for (const key of Object.keys(SCRIPT_CONFIG.CHANNELS)) {
        SCRIPT_CONFIG.CHANNELS[key] = {
            label: '个人定制版',
            manifestUrl: PERSONAL_RELEASE_URL + '/manifest.json',
            scriptUrl: PERSONAL_RELEASE_URL + '/ai_marker.user.js'
        };
    }
    SCRIPT_CONFIG.MANIFEST_URL = PERSONAL_RELEASE_URL + '/manifest.json';
    SCRIPT_CONFIG.UPDATE_CHECK_URL = PERSONAL_RELEASE_URL + '/ai_marker.user.js';
    getChannelUrls = function() { return SCRIPT_CONFIG.CHANNELS.stable; };
}
