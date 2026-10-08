function findPersonalCompletionChoice(doc, action) {
    const compact = el => (el.textContent || '').replace(/\s+/g,'');
    const visible = el => el.getClientRects().length && doc.defaultView.getComputedStyle(el).visibility !== 'hidden' && doc.defaultView.getComputedStyle(el).display !== 'none';
    const buttons = [...doc.querySelectorAll('button,[role="button"],input[type="button"],a')];
    const desired = action === 'more' ? '继续多阅' : '切换下一题';
    const candidates = buttons.filter(el => (compact(el) || el.value) === desired && visible(el) && !el.disabled);
    const matches = [];
    for (const button of candidates) {
        let container = button.parentElement;
        for (let depth=0;container && depth<7;depth++,container=container.parentElement) {
            if (container.tagName === 'BODY' || container.tagName === 'HTML') break;
            const text = compact(container);
            if (text.length > 600) break;
            if (/您该题任务量已完成/.test(text) && text.includes('继续多阅') && text.includes('切换下一题') && visible(container)) {
                matches.push({button,container}); break;
            }
        }
    }
    return matches.length === 1 ? matches[0] : null;
}
function handlePersonalTaskCompletion(doc, action, state, seen) {
    if (!['next','more'].includes(action) || !state.isRunning || state.isPaused) return false;
    const match = findPersonalCompletionChoice(doc, action);
    if (!match || seen.has(match.container)) return false;
    seen.add(match.container);
    if (action === 'next') {
        // 在切题前阻止旧题继续评分，下一题由用户确认方案后恢复。
        state.isPaused = true; state.isRunning = false;
        state.abortController?.abort();
        const btn = document.querySelector('.ai-grade-btn');
        if (btn) {btn.textContent='继续批改';btn.classList.remove('running','unattended');btn.classList.add('paused');}
    }
    match.button.click();
    if (typeof showToast === 'function') showToast(action === 'more' ? '已自动选择继续多阅' : '已切换下一题，请确认方案后继续批改');
    return true;
}
if (typeof window !== 'undefined' && window === window.top && window.__AI_MARKER_ADAPTER__?.id === 'zhixue') {
    const seen = new WeakSet();
    setInterval(() => {
        const state = window.aiGradingState;
        if (!state?.isRunning || state.isPaused) return;
        const action = PresetManager.getCurrentConfig().taskCompletionAction || 'manual';
        const docs = [document];
        for (let i=0;i<docs.length && i<20;i++) {
            if (handlePersonalTaskCompletion(docs[i],action,state,seen)) break;
            for (const frame of docs[i].querySelectorAll('iframe')) {
                try {if (frame.contentDocument && !docs.includes(frame.contentDocument)) docs.push(frame.contentDocument);} catch(e) {}
            }
        }
    }, 400);
}
