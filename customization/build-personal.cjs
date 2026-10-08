const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const upstream = path.resolve(process.argv[2] || 'work/upstream');
const repository = process.env.GITHUB_REPOSITORY || '';
if (repository && !/^[\w.-]+\/[\w.-]+$/.test(repository)) throw Error('无效仓库名');
const releaseURL = repository ? `https://github.com/${repository}/releases/download/personal-latest` : '';
const run = (cmd, args) => cp.execFileSync(cmd, args, {cwd: upstream, stdio: 'inherit'});
// 严格检查补丁上下文：上游改变时停止构建，绝不悄悄漏掉修复。
run('git', ['apply', '--check', path.join(__dirname, 'patches/transport.patch')]);
run('git', ['apply', path.join(__dirname, 'patches/transport.patch')]);
const buildPath = path.join(upstream, 'build.js');
let build = fs.readFileSync(buildPath, 'utf8');
const anchor = 'modulesContent += content;';
if (build.split(anchor).length !== 2 || !build.includes("'main.js'")) throw Error('上游构建注入位置改变，停止发布');
for (const name of ['buildStructuredPrompt', 'buildPrompt', 'buildSubQuestionPrompt', 'buildArbitrationPrompt']) {
    if (!fs.readFileSync(path.join(upstream, 'src/core/prompt.js'), 'utf8').includes(`function ${name}(`)) throw Error(`上游缺少${name}`);
}
const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, 'model-catalog.json'), 'utf8'));
if (!Array.isArray(catalog) || catalog.some(id => typeof id !== 'string')) throw Error('模型列表格式无效');
const openaiCatalog = JSON.parse(fs.readFileSync(path.join(__dirname, 'openai-model-catalog.json'), 'utf8'));
if (!Array.isArray(openaiCatalog) || openaiCatalog.some(id => typeof id !== 'string')) throw Error('OpenAI模型列表格式无效');
const injected = `const PERSONAL_RELEASE_URL = ${JSON.stringify(releaseURL)};\nconst PERSONAL_MODEL_CATALOG = ${JSON.stringify(catalog)};\nconst PERSONAL_OPENAI_MODEL_CATALOG = ${JSON.stringify(openaiCatalog)};\n` + fs.readFileSync(path.join(__dirname, 'runtime.js'), 'utf8');
build = build.replace(anchor, `if (mod === 'main.js') modulesContent += ${JSON.stringify(injected)};\n                ${anchor}`);
fs.writeFileSync(buildPath, build);
fs.mkdirSync(path.join(upstream, 'tests'), {recursive: true});
for (const name of ['ai-response.test.js', 'score-parsing.test.js', 'runtime.test.js']) fs.copyFileSync(path.join(__dirname, name), path.join(upstream, 'tests', name));
process.env.PERSONAL_RUNTIME_PATH = path.join(__dirname, 'runtime.js');
const tests = fs.readdirSync(path.join(upstream, 'tests')).filter(n => n.endsWith('.test.js')).map(n => 'tests/' + n);
run(process.execPath, ['--test', ...tests]);
const buildNumber = process.env.GITHUB_RUN_NUMBER || '1';
run(process.execPath, ['build.js', '--channel=dev', '--build=' + buildNumber]);
const dist = path.join(root, 'dist');
fs.mkdirSync(dist, {recursive: true});
let script = fs.readFileSync(path.join(upstream, 'dist/ai_marker.user.js'), 'utf8');
const version = script.match(/@version\s+(\S+)/)[1];
if (releaseURL) {
    script = script.replace(/^(\/\/ @(?:downloadURL|updateURL)\s+).*$/gm, '$1' + releaseURL + '/ai_marker.user.js');
} else {
    script = script.replace(/^\/\/ @(?:downloadURL|updateURL).*\r?\n/gm, '');
}
new vm.Script(script);
fs.writeFileSync(path.join(dist, 'ai_marker.user.js'), script);
const manifest = JSON.parse(fs.readFileSync(path.join(upstream, 'dist/manifest.json'), 'utf8'));
manifest.version = version;
fs.writeFileSync(path.join(dist, 'manifest.json'), JSON.stringify(manifest, null, 2));
const sha = cp.execFileSync('git', ['rev-parse', 'HEAD'], {cwd: upstream, encoding: 'utf8'}).trim();
fs.writeFileSync(path.join(dist, 'build-info.json'), JSON.stringify({upstream: sha, version, repository, builtAt: new Date().toISOString(), sha256: crypto.createHash('sha256').update(script).digest('hex')}, null, 2));
fs.copyFileSync(path.join(upstream, 'LICENSE'), path.join(dist, 'LICENSE'));
console.log('个人定制版构建完成：' + version);
