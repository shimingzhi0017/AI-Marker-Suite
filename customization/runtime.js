function populatePersonalWorkflowModels(select, providerName, preferredModel) {
    const models = ProviderManager.data.providers[providerName]?.models || {};
    const ids = Object.keys(models);
    select.replaceChildren();
    // 使用真实模型ID作值，并显示ID，避免自定义标签掩盖实际请求模型。
    for (const id of ids) {
        const option = document.createElement('option');
        option.value = id;
        const label = models[id]?.label;
        option.textContent = label && label !== id ? label + ' (' + id + ')' : id;
        select.appendChild(option);
    }
    if (preferredModel && !ids.includes(preferredModel)) {
        const missing = document.createElement('option');
        missing.value = '';
        missing.textContent = '原模型不在当前列表：' + preferredModel + '，请重新选择';
        missing.disabled = true;
        select.prepend(missing);
        select.value = '';
    } else if (!ids.length) {
        const empty = document.createElement('option');
        empty.value = '';
        empty.textContent = '该供应商没有模型，请先刷新或添加模型';
        empty.disabled = true;
        select.appendChild(empty);
        select.value = '';
    } else {
        select.value = preferredModel || ids[0];
    }
}

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

function installPersonalModelProvider(ids, name = '千问个人接口', endpoint = 'https://maas.qianwenaiapi.com/compatible-mode/v1/chat/completions') {
    const providers = ProviderManager.data.providers;
    let provider = providers[name];
    if (!provider) {
        provider = providers[name] = {
            endpoint,
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
function registerPersonalModelRefresh(name, baseUrl, nativeGemini = false) {
    if (typeof GM_registerMenuCommand !== 'function') return;
    GM_registerMenuCommand('刷新' + name + '模型列表', () => {
        const provider = ProviderManager.getProvider(name);
        if (!provider.apiKey) { alert('请先在供应商设置中填写' + name + '的API密钥。'); return; }
        GM_xmlhttpRequest({
            method: 'GET', url: baseUrl + '/models',
            headers: nativeGemini ? {'X-goog-api-key': provider.apiKey} : {Authorization: 'Bearer ' + provider.apiKey}, timeout: 30000,
            onload(res) {
                try {
                    if (res.status !== 200) throw Error('HTTP ' + res.status);
                    const body = JSON.parse(res.responseText);
                    const entries = nativeGemini ? body.models : body.data;
                    if (!Array.isArray(entries)) throw Error('模型列表格式无效');
                    const ids = [...new Set(nativeGemini
                        ? entries.filter(m => m.supportedGenerationMethods?.includes('generateContent')).map(m => m.name?.replace(/^models\//, '')).filter(id => typeof id === 'string')
                        : entries.map(m => m?.id).filter(id => typeof id === 'string'))];
                    if (!ids.length) throw Error('没有可用模型');
                    installPersonalModelProvider(ids, name, baseUrl + (nativeGemini ? '/openai/chat/completions' : '/chat/completions'));
                    alert('已获取' + ids.length + '个模型。重新打开设置即可查看；列表不代表视觉能力已验证。');
                } catch (e) { alert('获取模型列表失败：' + e.message); }
            },
            onerror() { alert('获取模型列表失败：网络错误'); },
            ontimeout() { alert('获取模型列表超时'); }
        });
    });
}
if (typeof ProviderManager !== 'undefined') {
    if (typeof PERSONAL_MODEL_CATALOG !== 'undefined') {
        installPersonalModelProvider(PERSONAL_MODEL_CATALOG);
        registerPersonalModelRefresh('千问个人接口', 'https://maas.qianwenaiapi.com/compatible-mode/v1');
    }
    if (typeof PERSONAL_OPENAI_MODEL_CATALOG !== 'undefined') {
        installPersonalModelProvider(PERSONAL_OPENAI_MODEL_CATALOG, 'OpenAI个人接口', 'https://code.ppxwo.de/v1/chat/completions');
        registerPersonalModelRefresh('OpenAI个人接口', 'https://code.ppxwo.de/v1');
    }
    if (typeof PERSONAL_GEMINI_MODEL_CATALOG !== 'undefined') {
        installPersonalModelProvider(PERSONAL_GEMINI_MODEL_CATALOG, 'Gemini官方接口', 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
        registerPersonalModelRefresh('Gemini官方接口', 'https://generativelanguage.googleapis.com/v1beta', true);
    }
}

function removeOfficialProviderReferences() {
    const providers = ProviderManager.data.providers;
    const current = ProviderManager.data.activeProvider;
    const fallback = current !== '5plus1官方' && providers[current] ? current
        : Object.keys(providers).find(n => n !== '5plus1官方' && providers[n].apiKey)
        || 'OpenAI个人接口';
    if (!providers[fallback]) return;
    const ids = Object.keys(providers[fallback].models || {});
    const model = ids.includes('gpt-6-luna') ? 'gpt-6-luna' : ids.includes('gemini-flash-latest') ? 'gemini-flash-latest' : ids.includes('qwen3.8-flash') ? 'qwen3.8-flash' : ids[0];
    delete providers['5plus1官方'];
    if (current === '5plus1官方') {
        ProviderManager.data.activeProvider = fallback;
        ProviderManager.data.activeModel = model;
    }
    ProviderManager.save();
    if (typeof WorkflowManager !== 'undefined') {
        for (const wf of Object.values(WorkflowManager.data.workflows)) {
            for (const entry of [wf.model, wf.dualEval?.secondary, wf.dualEval?.arbitration]) {
                if (entry?.provider === '5plus1官方') {
                    entry.provider = fallback; entry.model = model; entry.reasoningEffort = '';
                }
            }
        }
        WorkflowManager.save();
    }
    if (typeof PresetManager !== 'undefined') {
        for (const cfg of Object.values(PresetManager.data.list)) {
            if (['5plus1', '5plus1官方'].includes(cfg.provider)) {
                cfg.provider = fallback; cfg.endpoint = providers[fallback].endpoint; cfg.model = model;
            }
        }
        PresetManager.save();
    }
}
if (typeof ProviderManager !== 'undefined' && typeof PERSONAL_OPENAI_MODEL_CATALOG !== 'undefined') {
    const originalProviderDefaults = ProviderManager._getDefault;
    ProviderManager._getDefault = function() {
        const defaults = originalProviderDefaults.call(this);
        delete defaults.providers['5plus1官方'];
        defaults.providers['OpenAI个人接口'] = {endpoint:'https://code.ppxwo.de/v1/chat/completions',apiKey:'',models:Object.fromEntries(PERSONAL_OPENAI_MODEL_CATALOG.map(id => [id,{label:id,tags:[]}]))};
        defaults.activeProvider = 'OpenAI个人接口'; defaults.activeModel = 'gpt-6-luna';
        return defaults;
    };
    const originalProviderInit = ProviderManager.init;
    ProviderManager.init = function() { originalProviderInit.call(this); removeOfficialProviderReferences(); };
    if (typeof WorkflowManager !== 'undefined') {
        const originalWorkflowInit = WorkflowManager.init;
        WorkflowManager.init = function() { originalWorkflowInit.call(this); removeOfficialProviderReferences(); };
    }
    removeOfficialProviderReferences();
}

// 在所有定义加载后、阅卷主逻辑运行前追加个性化识别规则。
// 所有引导入口统一进入可关闭的设置面板，可直接选择已有方案。
// 不创建方案、不覆盖评分标准、不调用原作者密钥验证。
if (typeof showOnboardingDialog === 'function') {
    showOnboardingDialog = function(forceShow, mode) {
        GM_setValue('ai-grading-show-onboarding', false);
        if (typeof renderPresetDropdown === 'function') renderPresetDropdown();
        if (typeof fillFormFromActivePreset === 'function') fillFormFromActivePreset();
        openSettingsPanel();
        if (mode === 'new-question' && typeof showToast === 'function') {
            showToast('请选择已有方案或新建方案；设置面板可以直接关闭。');
        }
    };
}
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
