// 个人双评规则：总分与逐单元得分完全一致才通过；禁止平均和平均回退。
function validatePersonalDualResult(result, units, maxScore) {
    if (!result || !Number.isFinite(result.score) || result.score < 0 || result.score > maxScore) throw Error('双评或仲裁评分无效，已暂停');
    if (units.length > 1) {
        if (!Array.isArray(result.subScores) || result.subScores.length !== units.length) throw Error('逐空评分不完整，已暂停');
        let sum = 0;
        result.subScores.forEach((s, i) => {
            if (s.label !== units[i].label || !Number.isFinite(s.score) || s.score < 0 || s.score > units[i].maxScore) throw Error('逐空评分顺序或范围无效，已暂停');
            sum += s.score;
        });
        if (Math.abs(sum - result.score) > 1e-8) throw Error('逐空分数与总分不一致，已暂停');
    }
    return result;
}
const originalPersonalDualEvaluation = callDualEvaluation;
callDualEvaluation = async function(images, config, onStreamUpdate) {
    if (config.questionType === 'subjective') return originalPersonalDualEvaluation(images, config, onStreamUpdate);
    const workflow = WorkflowManager.getWorkflow(config.workflowId);
    if (!workflow?.dualEval?.enabled) return callAIGrading(images, config, onStreamUpdate);
    const dual = workflow.dualEval;
    const units = config.scoring?.units || config.subQuestions || [];
    const maxScore = units.length ? units.reduce((sum, u) => sum + u.maxScore, 0) : config.maxScore || PresetManager.getMaxScore();
    const getModel = entry => {
        const c = entry && ProviderManager.getCallConfig(entry.provider, entry.model);
        if (!c?.apiKey || !c.endpoint || !c.model) throw Error('双评或仲裁模型未配置完整，已暂停；不会取平均分');
        return {...c, ...(entry.reasoningEffort ? {reasoningEffort:entry.reasoningEffort} : {})};
    };
    const first = getModel(workflow.model);
    const second = getModel(dual.secondary);
    const results = await Promise.all([
        callAIGrading(images, {...config,...first}, null),
        callAIGrading(images, {...config,...second}, null)
    ]);
    const [a,b] = results.map(r => validatePersonalDualResult(r, units, maxScore));
    const agreement = a.score === b.score && (units.length <= 1 || a.subScores.every((s,i) => s.score === b.subScores[i].score));
    if (agreement) return {...a,dualEval:{scoreA:a.score,scoreB:b.score,diff:0,result:'consensus'}};
    if (onStreamUpdate) onStreamUpdate('两次评分有分歧，正在逐空三评仲裁…');
    const third = getModel(dual.arbitration);
    const subQuestions = units.length > 1 ? units.map((u,i) => ({...u,id:String.fromCharCode(97+i)})) : undefined;
    const arbConfig = {...config,...third,maxScore,subQuestions};
    const prompt = (subQuestions ? buildSubQuestionPrompt(arbConfig) : buildStructuredPrompt(arbConfig)) +
        '\n\n这是第三次独立仲裁。必须重新识别学生最终保留答案并按原评分标准逐空判定；不得平均两次分数。两次总分相同时仍可能有逐空分歧。' +
        '\n第一评：' + JSON.stringify({studentAnswer:a.studentAnswer,score:a.score,subScores:a.subScores}) +
        '\n第二评：' + JSON.stringify({studentAnswer:b.studentAnswer,score:b.score,subScores:b.subScores});
    const text = await callAIWithRetry(prompt, images, arbConfig, onStreamUpdate, collectFieldImages(config));
    const verdict = validatePersonalDualResult(subQuestions ? parseSubQuestionResponse(text, arbConfig) : parseStructuredResponse(text, maxScore), units, maxScore);
    return {...verdict,dualEval:{scoreA:a.score,scoreB:b.score,diff:Math.abs(a.score-b.score),result:'arbitration',arbScore:verdict.score}};
};
