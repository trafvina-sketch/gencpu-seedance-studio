/**
 * GENCPU.COM & GENPIXO.COM — SEEDANCE AI VIDEO STUDIO & AUTO DELOGO
 * Giao diện Tối Giản (Dark-Gold GenCPU.com):
 * - Cột Trái: Thêm Acc Cookie (mỗi hàng 1 Cookie) + Báo giới hạn Token & số video còn tạo được
 * - Cột Phải: Tạo Video (1 Acc 3 Luồng, 12s, 720p, tự động xoá logo) + Xem & Tải Video ngay
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawn, spawnSync, exec } = require('child_process');

const PORT = Number(process.env.SEEDANCE_PORT) || 3456;
const ROOT_DIR = process.env.SEEDANCE_ROOT_DIR || __dirname;
const BFF_BASE = 'https://arkbff-ap-southeast1.console.byteplus.com';
const CONSOLE_BASE = 'https://console.byteplus.com';
const WEB_ID_SECRET = 'ark-experience-tod-af9176#!';

const DIRS = {
    cookies: path.join(ROOT_DIR, 'cookies'),
    uploads: path.join(ROOT_DIR, 'uploads_ref'),
    inputLogo: path.join(ROOT_DIR, 'input_co_logo'),
    rawOut: path.join(ROOT_DIR, 'output_goc'),
    cleanOut: path.join(ROOT_DIR, 'output_khong_logo'),
    accountsFile: path.join(ROOT_DIR, 'cookies', 'accounts.json')
};

for (const d of [DIRS.cookies, DIRS.uploads, DIRS.inputLogo, DIRS.rawOut, DIRS.cleanOut]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

// ==================== TIỆN ÍCH FFMPEG XOÁ LOGO (MỌI CẤU HÌNH MÁY) ====================
function findBinary(name) {
    const desktopDir = path.join(process.env.USERPROFILE || 'C:\\Users\\Admin', 'Desktop');
    const directCandidates = [
        process.env.SEEDANCE_FFMPEG_PATH || '',
        path.join(ROOT_DIR, 'bin', name),
        path.join(ROOT_DIR, name),
        path.join(__dirname, 'bin', name),
        path.join(__dirname, name),
        path.join(desktopDir, 'Dự Án Riêng', 'capcut tho', 'ffmpeg-2025-12-24-git-abb1524138-full_build', 'bin', name)
    ].filter(Boolean);
    for (const p of directCandidates) {
        if (fs.existsSync(p)) return p;
    }
    try {
        execFileSync(name, ['-version'], { stdio: 'ignore' });
        return name;
    } catch (_) {}

    function walk(dir, depth = 0) {
        if (depth > 3) return [];
        let results = [];
        try {
            const list = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of list) {
                if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) results = results.concat(walk(fullPath, depth + 1));
                else if (entry.isFile() && entry.name.toLowerCase() === name.toLowerCase()) results.push(fullPath);
            }
        } catch (_) {}
        return results;
    }
    const found = walk(desktopDir);
    return found.find(p => p.includes('full_build')) || found[0] || name;
}

const FFMPEG = findBinary('ffmpeg.exe');

let BEST_ENCODER = null;
function detectBestEncoder() {
    if (BEST_ENCODER) return BEST_ENCODER;
    const candidates = [
        { name: 'NVIDIA GPU', isGpu: true, args: ['-c:v', 'h264_nvenc', '-preset', 'p4', '-cq', '21'] },
        { name: 'Intel iGPU', isGpu: true, args: ['-c:v', 'h264_qsv', '-global_quality', '21'] },
        { name: 'AMD GPU', isGpu: true, args: ['-c:v', 'h264_amf', '-quality', 'balanced'] },
        { name: 'CPU Ultrafast', isGpu: false, args: ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '21'] }
    ];
    for (const c of candidates) {
        if (!c.isGpu) {
            BEST_ENCODER = c;
            break;
        }
        try {
            const r = spawnSync(FFMPEG, [
                '-hide_banner', '-loglevel', 'error',
                '-f', 'lavfi', '-i', 'color=c=black:s=128x128:d=0.04',
                '-frames:v', '1',
                ...c.args,
                '-f', 'null', '-'
            ], { timeout: 4000 });
            if (r.status === 0) {
                BEST_ENCODER = c;
                break;
            }
        } catch (_) {}
    }
    if (!BEST_ENCODER) BEST_ENCODER = candidates[candidates.length - 1];
    return BEST_ENCODER;
}

function getVideoDimensions(filePath) {
    const r = spawnSync(FFMPEG, ['-hide_banner', '-i', filePath], { encoding: 'utf8' });
    const out = (r.stderr || '') + '\n' + (r.stdout || '');
    const m = out.match(/Stream #[^\n]*Video:[^\n]*?,\s*([0-9]{2,5})x([0-9]{2,5})\b/);
    if (!m) throw new Error('Không đọc được kích thước video');
    let w = parseInt(m[1], 10);
    let h = parseInt(m[2], 10);
    const rotM = out.match(/rotation of\s+(-?[0-9]+)/i);
    if (rotM) {
        const rotation = Math.abs(parseInt(rotM[1], 10));
        if (rotation === 90 || rotation === 270) {
            const tmp = w; w = h; h = tmp;
        }
    }
    return { width: w, height: h };
}

function removeLogoFFmpeg(inputPath, outputPath, allowHardware = true) {
    return new Promise((resolve, reject) => {
        let dims;
        try {
            dims = getVideoDimensions(inputPath);
        } catch (e) {
            return reject(e);
        }
        const scale = Math.min(dims.width, dims.height) / 480.0;
        const w = Math.round(146 * scale);
        const h = Math.round(30 * scale);
        const marginX = Math.round(26 * scale);
        const marginY = Math.round(27 * scale);
        const x = dims.width - marginX - w;
        const y = dims.height - marginY - h;

        const vf = `delogo=x=${x}:y=${y}:w=${w}:h=${h}`;
        const enc = allowHardware ? detectBestEncoder() : { name: 'CPU Ultrafast', isGpu: false, args: ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '21'] };

        const args = [
            '-hide_banner', '-loglevel', 'error', '-y',
            '-i', inputPath,
            '-vf', vf,
            ...enc.args,
            '-c:a', 'copy',
            outputPath
        ];

        const start = Date.now();
        const proc = spawn(FFMPEG, args);
        let stderr = '';
        proc.stderr.on('data', d => { stderr += d.toString(); });
        proc.on('close', code => {
            const elapsed = ((Date.now() - start) / 1000).toFixed(2);
            if (code === 0) {
                resolve({ dims, elapsed, encoder: enc.name });
            } else if (allowHardware && enc.isGpu) {
                removeLogoFFmpeg(inputPath, outputPath, false).then(resolve).catch(reject);
            } else {
                reject(new Error(`FFmpeg lỗi (${code}): ${stderr}`));
            }
        });
    });
}

// ==================== ĐỌC COOKIE (MỖI HÀNG 1 COOKIE / NETSCAPE / JSON) ====================
function parseFlexibleCookieText(rawText) {
    if (!rawText || !rawText.trim()) throw new Error('Nội dung Cookie trống!');
    let trimmed = rawText.trim();
    const map = {};
    let customLabel = '';

    if (!trimmed.includes('\t') && !trimmed.startsWith('[') && !trimmed.startsWith('{') && trimmed.includes('|') && trimmed.includes('digest=')) {
        const pipeParts = trimmed.split('|').map(s => s.trim()).filter(Boolean);
        const cookiePartIdx = pipeParts.findIndex(p => p.includes('digest=') || p.includes('csrfToken='));
        if (cookiePartIdx >= 0) {
            if (cookiePartIdx > 0) customLabel = pipeParts[0];
            trimmed = pipeParts.slice(cookiePartIdx).join('; ');
        }
    }

    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        try {
            const parsed = JSON.parse(trimmed);
            const arr = Array.isArray(parsed) ? parsed : (parsed.cookies || Object.entries(parsed).map(([name, value]) => ({ name, value })));
            for (const item of arr) {
                if (item && item.name && item.value !== undefined) {
                    map[String(item.name).trim()] = String(item.value).trim();
                }
            }
        } catch (_) {}
    }

    if (Object.keys(map).length === 0 && trimmed.includes('\t')) {
        const lines = trimmed.split(/\r?\n/);
        for (const line of lines) {
            if (!line || line.trim().startsWith('#')) continue;
            const parts = line.split('\t');
            if (parts.length >= 7) {
                map[parts[5].trim()] = parts[6].trim();
            }
        }
    }

    if (Object.keys(map).length === 0 && trimmed.includes('=')) {
        const pairs = trimmed.replace(/^Cookie:\s*/i, '').split(/;|\r?\n/);
        for (const pair of pairs) {
            const idx = pair.indexOf('=');
            if (idx > 0) {
                const k = pair.slice(0, idx).trim();
                const v = pair.slice(idx + 1).trim();
                if (k && !k.startsWith('#') && !k.includes('\t')) map[k] = v;
            }
        }
    }

    if (!map.digest || !map.csrfToken) {
        throw new Error('Cookie thiếu trường "digest" hoặc "csrfToken".');
    }

    if (!map.AccountID || !map._accountName) {
        try {
            const jwtParts = (map.digest || '').split('.');
            if (jwtParts.length >= 2) {
                const payload = JSON.parse(Buffer.from(jwtParts[1], 'base64').toString('utf8'));
                if (payload.sub && !map.AccountID) map.AccountID = String(payload.sub);
                if (payload.name) map._accountName = String(payload.name);
            }
        } catch (_) {}
    }
    if (customLabel && !map._accountName) {
        map._accountName = customLabel;
    }

    return map;
}

function parseMultipleCookiesFromText(rawText) {
    if (!rawText || !rawText.trim()) throw new Error('Nội dung Cookie trống!');
    const trimmed = rawText.trim();
    const list = [];

    const deduplicate = (arr) => {
        const seen = new Map();
        for (const c of arr) {
            const key = c.AccountID || c.digest;
            seen.set(key, c);
        }
        return Array.from(seen.values());
    };

    const rawLines = trimmed.split(/\r?\n/);
    const singleLineCandidates = [];
    const remainingLines = [];

    for (const line of rawLines) {
        const t = line.trim();
        if (!t || t.startsWith('#')) {
            remainingLines.push(line);
            continue;
        }
        if (!t.includes('\t') && t.includes('digest') && t.includes('csrfToken')) {
            singleLineCandidates.push(t);
        } else {
            remainingLines.push(line);
        }
    }

    for (const lineCookie of singleLineCandidates) {
        try { list.push(parseFlexibleCookieText(lineCookie)); } catch (_) {}
    }

    const remText = remainingLines.join('\n').trim();
    if (remText) {
        if (remText.includes('\t')) {
            let curBlock = [];
            let curDigest = null;
            for (const line of remainingLines) {
                const t = line.trim();
                if (!t) continue;
                if (/^#\s*Netscape/i.test(t) || /^[-=]{3,}$/.test(t)) {
                    if (curBlock.length > 0 && curDigest) {
                        try { list.push(parseFlexibleCookieText(curBlock.join('\n'))); } catch (_) {}
                        curBlock = [];
                        curDigest = null;
                    }
                    continue;
                }
                const parts = line.split('\t');
                if (parts.length >= 7 && parts[5].trim() === 'digest') {
                    const dVal = parts[6].trim();
                    if (curDigest && curDigest !== dVal) {
                        try { list.push(parseFlexibleCookieText(curBlock.join('\n'))); } catch (_) {}
                        curBlock = [];
                    }
                    curDigest = dVal;
                }
                curBlock.push(line);
            }
            if (curBlock.length > 0) {
                try { list.push(parseFlexibleCookieText(curBlock.join('\n'))); } catch (_) {}
            }
        } else {
            const blocks = remText.split(/\r?\n\s*[-=]{3,}\s*\r?\n/);
            for (const b of blocks) {
                if (!b.trim()) continue;
                try { list.push(parseFlexibleCookieText(b)); } catch (_) {}
            }
        }
    }

    if (list.length === 0) {
        list.push(parseFlexibleCookieText(trimmed));
    }

    return deduplicate(list);
}

function cryptoJsAesEncrypt(plaintext, passphrase) {
    const salt = crypto.randomBytes(8);
    const passBuf = Buffer.from(passphrase, 'utf8');
    let d = Buffer.alloc(0);
    let dPrev = Buffer.alloc(0);
    while (d.length < 48) {
        const md5 = crypto.createHash('md5');
        md5.update(Buffer.concat([dPrev, passBuf, salt]));
        dPrev = md5.digest();
        d = Buffer.concat([d, dPrev]);
    }
    const key = d.subarray(0, 32);
    const iv = d.subarray(32, 48);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return Buffer.concat([Buffer.from('Salted__', 'utf8'), salt, encrypted]).toString('base64');
}

function buildHeaders(cookies, isJson = true) {
    const cookieHeader = Object.entries(cookies)
        .filter(([k]) => !k.startsWith('_account'))
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
    const webId = cookies.monitor_huoshan_web_id || '7700630355762677301';
    const xWebId = cryptoJsAesEncrypt(webId, WEB_ID_SECRET);

    const headers = {
        'X-Csrf-Token': cookies.csrfToken || '',
        'x-ark-verify-fp': cookies.s_v_web_id || '',
        'x-web-id': xWebId,
        'Cookie': cookieHeader,
        'Origin': 'https://console.byteplus.com',
        'Referer': 'https://console.byteplus.com/',
        'Accept-Language': 'en-US,en;q=0.9,vi;q=0.8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, Gecko) Chrome/131.0.0.0 Safari/537.36'
    };
    if (isJson) headers['Content-Type'] = 'application/json';
    return headers;
}

// ==================== QUẢN LÝ TÀI KHOẢN COOKIE ====================
function loadSavedAccounts() {
    let list = [];
    if (fs.existsSync(DIRS.accountsFile)) {
        try {
            list = JSON.parse(fs.readFileSync(DIRS.accountsFile, 'utf8'));
        } catch (_) { list = []; }
    }

    const rootCookieFile = path.join(ROOT_DIR, 'cookies.txt');
    if (list.length === 0 && fs.existsSync(rootCookieFile)) {
        try {
            const parsedList = parseMultipleCookiesFromText(fs.readFileSync(rootCookieFile, 'utf8'));
            for (const c of parsedList) {
                const accountId = c.AccountID || crypto.randomUUID().slice(0, 8);
                list.push({
                    id: accountId,
                    accountId: accountId,
                    name: c._accountName || `Acc_${accountId.slice(-4)}`,
                    addedAt: new Date().toISOString(),
                    cookies: c,
                    quotas: {}
                });
            }
            if (list.length > 0) saveAccounts(list);
        } catch (_) {}
    }
    return list;
}

function saveAccounts(list) {
    fs.writeFileSync(DIRS.accountsFile, JSON.stringify(list, null, 2), 'utf8');
}

async function fetchAccountQuota(cookies) {
    const res = await fetch(`${CONSOLE_BASE}/api/top/ark/ap-southeast-1/2024-01-01/ListModelChargeItems`, {
        method: 'POST',
        headers: buildHeaders(cookies, true),
        body: JSON.stringify({ ProjectName: 'default', PageNumber: 1, PageSize: 100 })
    });
    if (!res.ok) throw new Error(`Cookie hết hạn (HTTP ${res.status})`);
    const data = await res.json();
    if (data?.ResponseMetadata?.Error) {
        throw new Error(data.ResponseMetadata.Error.Message || 'Cookie hết hạn');
    }
    const items = data?.Result?.Items || [];
    const quotas = {};
    for (const item of items) {
        if (item.FoundationModelName && item.FoundationModelName.includes('seedance') && item.InferenceFreeUsage) {
            const total = item.InferenceFreeUsage.Total || 0;
            const consumed = item.InferenceFreeUsage.Consumed || 0;
            quotas[item.FoundationModelName] = {
                total,
                consumed,
                remaining: Math.max(0, total - consumed)
            };
        }
    }
    return quotas;
}

// ==================== LOGIC TẠO VIDEO ====================
const MODEL_MAP = {
    'seedance-1-5-pro-251215': { modelId: 'seedance-1-5-pro-251215', modelName: 'seedance-1-5-pro', modelVersion: '251215', label: 'Seedance 1.5 Pro' },
    'seedance-1-0-pro-250528': { modelId: 'seedance-1-0-pro-250528', modelName: 'seedance-1-0-pro', modelVersion: '250528', label: 'Seedance 1.0 Pro' },
    'seedance-1-0-pro-fast-251015': { modelId: 'seedance-1-0-pro-fast-251015', modelName: 'seedance-1-0-pro-fast', modelVersion: '251015', label: 'Seedance 1.0 Fast' }
};

function loadInitialHistoryJobs() {
    const history = [];
    try {
        if (!fs.existsSync(DIRS.cleanOut)) return history;
        const files = fs.readdirSync(DIRS.cleanOut)
            .filter(f => f.toLowerCase().endsWith('.mp4'))
            .map(f => {
                const stat = fs.statSync(path.join(DIRS.cleanOut, f));
                return { name: f, mtime: stat.mtimeMs };
            })
            .sort((a, b) => b.mtime - a.mtime)
            .slice(0, 20);

        files.forEach((f, idx) => {
            const rawExists = fs.existsSync(path.join(DIRS.rawOut, f.name));
            history.push({
                id: files.length - idx,
                prompt: f.name,
                imagePath: null,
                status: 'done',
                statusText: 'Đã xoá sạch logo',
                accountId: null,
                taskId: null,
                cleanVideoUrl: `/files/clean/${encodeURIComponent(f.name)}`,
                rawVideoUrl: rawExists ? `/files/raw/${encodeURIComponent(f.name)}` : `/files/clean/${encodeURIComponent(f.name)}`
            });
        });
    } catch (_) {}
    return history;
}

let RUN_STATE = {
    isRunning: false,
    stopRequested: false,
    encoderName: detectBestEncoder().name,
    jobs: loadInitialHistoryJobs(),
    logs: []
};

function addLog(msg, type = 'info') {
    const time = new Date().toLocaleTimeString('vi-VN');
    RUN_STATE.logs.unshift({ time, msg, type });
    if (RUN_STATE.logs.length > 100) RUN_STATE.logs.pop();
    console.log(`[${time}] ${msg}`);
}

async function createWorkerSession(cookies, modelId) {
    const headers = buildHeaders(cookies, true);
    const convRes = await fetch(`${BFF_BASE}/api/2024-10-01/GetConversationDraft`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ Type: 'video', ProjectName: 'default' })
    });
    const convJson = await convRes.json();
    const conversationId = convJson?.Result?.Sid;
    if (!conversationId) throw new Error(`Không tạo được Conversation`);

    const sessRes = await fetch(`${BFF_BASE}/api/2024-10-01/CreateSession`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            ConversationId: conversationId,
            ModelType: 'foundation',
            ModelId: modelId
        })
    });
    const sessJson = await sessRes.json();
    const sessionId = sessJson?.Result?.Sid;
    if (!sessionId) throw new Error(`Không tạo được Session`);

    return { conversationId, sessionId, lastMessageId: undefined };
}

async function uploadImageToTos(cookies, imagePath, modelSpec) {
    const absPath = path.isAbsolute(imagePath) ? imagePath : path.join(ROOT_DIR, imagePath);
    if (!fs.existsSync(absPath)) throw new Error(`Không tìm thấy ảnh: ${absPath}`);
    const imgBuf = fs.readFileSync(absPath);
    const ext = path.extname(absPath).toLowerCase().replace('.', '') || 'jpeg';
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    const fileName = path.basename(absPath);

    const form = new FormData();
    form.append('file', new Blob([imgBuf], { type: mime }), fileName);
    form.append('biz', 'experience_video');
    form.append('type', 'image');
    form.append('modelName', modelSpec.modelName);
    form.append('modelVersion', modelSpec.modelVersion);

    const res = await fetch(`${BFF_BASE}/api/2024-10-01/UploadArkTosFile`, {
        method: 'POST',
        headers: buildHeaders(cookies, false),
        body: form
    });
    const data = await res.json();
    const r = data?.Result;
    if (!r || !r.Url || !r.Bucket || !r.Prefix) {
        throw new Error(`Upload ảnh thất bại`);
    }
    return { url: r.Url, bucketName: r.Bucket, objectKey: r.Prefix, label: fileName };
}

function parseSseEvents(rawText) {
    const blocks = rawText.split(/\r?\n\r?\n/);
    const events = [];
    for (const block of blocks) {
        if (!block.trim()) continue;
        let eventName = '';
        let dataStr = '';
        for (const line of block.split(/\r?\n/)) {
            if (line.startsWith('event:')) eventName = line.slice(6).trim();
            else if (line.startsWith('data:')) dataStr += line.slice(5).trim();
        }
        if (eventName) {
            let parsed = dataStr;
            try { parsed = JSON.parse(dataStr); } catch (_) {}
            events.push({ event: eventName, data: parsed });
        }
    }
    return events;
}

async function submitVideoTask(cookies, workerState, job, options, modelSpec) {
    const inputArr = [];
    let videoTaskType = 'text_to_video';
    let ratio = options.ratio || '16:9';

    if (job.imagePath) {
        const uploaded = await uploadImageToTos(cookies, job.imagePath, modelSpec);
        inputArr.push({
            Type: 'image',
            Content: uploaded.url,
            MediaMeta: {
                Tos: { ObjectKey: uploaded.objectKey, BucketName: uploaded.bucketName },
                Type: 'first_frame',
                Label: uploaded.label
            }
        });
        videoTaskType = 'first_frame';
        if (options.ratio === 'adaptive') ratio = 'adaptive';
    }

    inputArr.push({ Type: 'text', Content: job.prompt });

    const inferenceObj = {
        seed: -1,
        resolution: options.resolution || '720p',
        ratio: ratio,
        duration: Number(options.duration) || 12,
        camera_fixed: false,
        watermark: true,
        execution_expires_after: 172800
    };
    if (modelSpec.modelName === 'seedance-1-5-pro') {
        inferenceObj.generate_audio = Boolean(options.generateAudio);
        inferenceObj.draft = false;
    }

    const payload = {
        ConversationId: workerState.conversationId,
        SessionId: workerState.sessionId,
        ProjectName: 'default',
        ClientSubmissionId: crypto.randomUUID(),
        ModelInfo: {
            ModelId: modelSpec.modelId,
            Provider: 'ark',
            ModelName: modelSpec.modelName,
            ModelType: 'foundation',
            ModelVersion: modelSpec.modelVersion
        },
        Input: inputArr,
        Params: {
            Mode: 'generation-task',
            ConsoleParams: {
                VideoTaskType: videoTaskType,
                GenerationTaskType: 'video',
                GenerationTaskCount: 1
            },
            InferenceParams: JSON.stringify(inferenceObj)
        }
    };

    if (workerState.lastMessageId) {
        payload.LastMessageId = workerState.lastMessageId;
    }

    const res = await fetch(`${BFF_BASE}/chat/2026-04-30/SendExperienceMessage`, {
        method: 'POST',
        headers: buildHeaders(cookies, true),
        body: JSON.stringify(payload)
    });

    const rawText = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const events = parseSseEvents(rawText);
    const convMeta = events.find(e => e.event === 'conversation-meta');
    if (convMeta?.data?.meta?.assistantMessageId) {
        workerState.lastMessageId = convMeta.data.meta.assistantMessageId;
    }

    const errEvt = events.find(e => e.event === 'error' || e.event === 'generation.video.part.error');
    if (errEvt) {
        const errCode = errEvt?.data?.error?.code || '';
        const errMsg = errEvt?.data?.error?.message || JSON.stringify(errEvt.data);
        const err = new Error(`${errCode}: ${errMsg}`);
        err.code = errCode;
        throw err;
    }

    const createdEvt = events.find(e => e.event === 'generation.video.task-created');
    const partAddedEvt = events.find(e => e.event === 'generation.video.part.added');
    const messageItemId = createdEvt?.data?.meta?.messageItemId || partAddedEvt?.data?.meta?.messageItemId;
    const taskId = createdEvt?.data?.meta?.taskId || 'unknown';

    if (!messageItemId) throw new Error(`Không nhận được messageItemId`);
    return { messageItemId, taskId };
}

function estimateVideoTokens(options, dims = null) {
    const dur = Number(options?.duration) || 12;
    let w = 1280, h = 720;
    if (dims && dims.width && dims.height) {
        w = dims.width;
        h = dims.height;
    } else if (options?.resolution === '480p') {
        w = 854; h = 480;
    } else if (options?.resolution === '1080p') {
        w = 1920; h = 1080;
    }
    return Math.round((w * h * 24 * dur) / 1024) + 900;
}

async function startBatchGeneration(options, rawPrompts) {
    if (RUN_STATE.isRunning) throw new Error('Hệ thống đang chạy tiến trình tạo video!');

    const modelSpec = MODEL_MAP[options.modelId] || MODEL_MAP['seedance-1-5-pro-251215'];
    const concurrency = Math.max(1, Math.min(10, Number(options.concurrency) || 3));
    const accounts = loadSavedAccounts();

    if (accounts.length === 0) {
        throw new Error('Chưa có Cookie nào! Hãy dán Cookie vào cột bên trái trước.');
    }

    RUN_STATE.isRunning = true;
    RUN_STATE.stopRequested = false;

    const newJobs = rawPrompts.map((item, idx) => ({
        id: idx + 1,
        prompt: item.prompt,
        imagePath: item.imagePath || null,
        status: 'waiting',
        statusText: 'Đang chờ...',
        workerId: null,
        accountId: null,
        taskId: null,
        elapsedSec: 0,
        cleanVideoUrl: null,
        rawVideoUrl: null,
        error: null
    }));

    const oldDoneJobs = (RUN_STATE.jobs || []).filter(j => j.status === 'done').slice(0, 20);
    RUN_STATE.jobs = [...newJobs, ...oldDoneJobs];

    addLog(`🚀 Tạo ${newJobs.length} video | ${modelSpec.modelName} | ${options.duration}s ${options.resolution}`, 'success');

    (async () => {
        try {
            const estTokensPerVid = estimateVideoTokens(options);
            const accStates = [];

            for (const acc of accounts) {
                try {
                    const prevQ = acc.quotas?.[modelSpec.modelName];
                    const serverQuotas = await fetchAccountQuota(acc.cookies);
                    for (const [mKey, sVal] of Object.entries(serverQuotas)) {
                        const oldVal = acc.quotas?.[mKey];
                        if (oldVal && oldVal.consumed > sVal.consumed) {
                            serverQuotas[mKey] = {
                                total: sVal.total,
                                consumed: oldVal.consumed,
                                remaining: Math.max(0, sVal.total - oldVal.consumed)
                            };
                        }
                    }
                    acc.quotas = serverQuotas;
                    if (!acc.quotas[modelSpec.modelName]) {
                        acc.quotas[modelSpec.modelName] = prevQ || { total: 2000000, consumed: 0, remaining: 2000000 };
                    }
                    const qModel = acc.quotas[modelSpec.modelName];
                    if (qModel.remaining < estTokensPerVid) {
                        addLog(`⚠️ Bỏ qua Acc ${acc.name}: Còn ${qModel.remaining.toLocaleString()} token (Không đủ ${estTokensPerVid.toLocaleString()} token cho 1 video)`, 'warn');
                        continue;
                    }
                    accStates.push({
                        acc,
                        qModel,
                        inFlightReservedTokens: 0,
                        activeWorkers: 0,
                        exhausted: false,
                        notifiedInsufficient: false
                    });
                } catch (err) {
                    addLog(`⚠️ Bỏ qua Acc ${acc.name}: Lỗi kiểm tra Cookie (${err.message})`, 'warn');
                }
            }
            saveAccounts(accounts);

            if (accStates.length === 0) {
                const msg = `Không có Cookie nào đủ ${estTokensPerVid.toLocaleString()} token ở model ${modelSpec.modelName}! Hãy thêm Cookie mới, hạ thời lượng/độ phân giải, hoặc đổi sang model 1.0 Pro / Fast.`;
                addLog(`⛔ ${msg}`, 'error');
                for (const j of newJobs) {
                    if (j.status === 'waiting') {
                        j.status = 'error';
                        j.statusText = `Không đủ Token (Cần ${estTokensPerVid.toLocaleString()} token/video)`;
                    }
                }
                RUN_STATE.isRunning = false;
                return;
            }

            // BỘ ĐIỀU PHỐI ĐA TÀI KHOẢN & ĐA LUỒNG TỰ ĐỘNG CHUYỂN PROMPT KHI HẾT/THIẾU TOKEN
            const activePromises = new Set();

            async function executeJobOnAccount(accState, job, workerSlot) {
                const { acc, qModel } = accState;
                const estTokens = estimateVideoTokens(options);

                job.workerId = workerSlot;
                job.accountId = acc.name || acc.accountId;
                job.status = 'submitting';
                job.statusText = `${acc.name} (Luồng ${workerSlot}): Đang gửi lệnh...`;

                try {
                    const workerState = await createWorkerSession(acc.cookies, modelSpec.modelId);
                    const { messageItemId, taskId } = await submitVideoTask(acc.cookies, workerState, job, options, modelSpec);
                    job.taskId = taskId;
                    job.status = 'rendering';
                    job.statusText = `${acc.name} (Luồng ${workerSlot}): Đang tạo video...`;

                    const startPoll = Date.now();
                    let downloadUrl = null;
                    while (!RUN_STATE.stopRequested) {
                        await new Promise(r => setTimeout(r, 4000));
                        const pollRes = await fetch(`${BFF_BASE}/api/2024-10-01/GetMessageItem`, {
                            method: 'POST',
                            headers: buildHeaders(acc.cookies, true),
                            body: JSON.stringify({ MessageItemId: messageItemId, ProjectName: 'default' })
                        });
                        const pollData = await pollRes.json();
                        const result = pollData?.Result;
                        if (!result) continue;

                        const st = (result.Status || '').toLowerCase();
                        job.elapsedSec = Math.round((Date.now() - startPoll) / 1000);
                        job.statusText = `${acc.name} (Luồng ${workerSlot}): Đang render (${job.elapsedSec}s)...`;

                        if (st === 'success' || st === 'succeeded') {
                            const contentObj = JSON.parse(result.Content || '{}');
                            downloadUrl = contentObj.downloadUrl || contentObj.url;
                            break;
                        } else if (st === 'failed' || st === 'error' || st === 'cancelled') {
                            const errMsg = result.ErrorMessage || result.StatusMessage || 'Render lỗi trên server';
                            throw new Error(errMsg);
                        }
                    }

                    if (RUN_STATE.stopRequested) {
                        accState.inFlightReservedTokens = Math.max(0, accState.inFlightReservedTokens - estTokens);
                        job.status = 'error';
                        job.statusText = 'Đã dừng';
                        return;
                    }

                    job.status = 'cleaning';
                    job.statusText = `${acc.name} (Luồng ${workerSlot}): Đang xoá logo...`;

                    const fileName = `video_${String(job.id).padStart(3, '0')}_${taskId}.mp4`;
                    const rawPath = path.join(DIRS.rawOut, fileName);
                    const cleanPath = path.join(DIRS.cleanOut, fileName);

                    const dlRes = await fetch(downloadUrl);
                    if (!dlRes.ok) throw new Error(`Lỗi tải MP4`);
                    fs.writeFileSync(rawPath, Buffer.from(await dlRes.arrayBuffer()));

                    const delogoInfo = await removeLogoFFmpeg(rawPath, cleanPath, true);

                    accState.inFlightReservedTokens = Math.max(0, accState.inFlightReservedTokens - estTokens);
                    const actualTokens = estimateVideoTokens(options, delogoInfo.dims);
                    qModel.consumed = Math.min(qModel.total, (qModel.consumed || 0) + actualTokens);
                    qModel.remaining = Math.max(0, qModel.total - qModel.consumed);

                    try {
                        const remoteQ = await fetchAccountQuota(acc.cookies);
                        const rq = remoteQ?.[modelSpec.modelName];
                        if (rq) {
                            qModel.consumed = Math.max(qModel.consumed, rq.consumed);
                            qModel.remaining = Math.min(qModel.remaining, rq.remaining);
                        }
                    } catch (_) {}

                    saveAccounts(accounts);
                    if (qModel.remaining < estTokens) {
                        accState.exhausted = true;
                    }

                    job.rawVideoUrl = `/files/raw/${encodeURIComponent(fileName)}`;
                    job.cleanVideoUrl = `/files/clean/${encodeURIComponent(fileName)}`;
                    job.status = 'done';
                    job.statusText = `Hoàn tất (${acc.name} • -${(actualTokens/1000).toFixed(0)}k token • xoá logo ${delogoInfo.elapsed}s)`;
                    addLog(`✨ Bài #${job.id} xong! Trừ ${actualTokens.toLocaleString()} token của ${acc.name} (còn ${qModel.remaining.toLocaleString()})`, 'success');
                } catch (err) {
                    accState.inFlightReservedTokens = Math.max(0, accState.inFlightReservedTokens - estTokens);
                    const errStr = String(err.message || err.code || '');
                    const isQuotaOrSessionError =
                        err.code === 'QuotaExceeded.FreeTrialQuota' ||
                        errStr.includes('QuotaExceeded') ||
                        errStr.includes('quota') ||
                        errStr.includes('balance') ||
                        errStr.includes('Draft') ||
                        errStr.includes('Session') ||
                        errStr.includes('401') ||
                        errStr.includes('403');

                    job._retryCount = (job._retryCount || 0) + 1;

                    if (isQuotaOrSessionError || job._retryCount <= accStates.length) {
                        if (err.code === 'QuotaExceeded.FreeTrialQuota' || errStr.includes('QuotaExceeded')) {
                            qModel.consumed = qModel.total || 2000000;
                            qModel.remaining = 0;
                            saveAccounts(accounts);
                        }
                        accState.exhausted = true;
                        job.accountId = null;
                        job.status = 'waiting';
                        job.statusText = `🔄 Acc ${acc.name} hết/thiếu token -> Tự động chuyển sang Acc khác...`;
                        addLog(`🔄 Bài #${job.id}: Acc ${acc.name} báo lỗi/hết token (${errStr}) -> Chuyển prompt sang Acc tiếp theo!`, 'warn');
                    } else {
                        job.status = 'error';
                        job.statusText = `Lỗi: ${errStr}`;
                    }
                } finally {
                    accState.activeWorkers = Math.max(0, accState.activeWorkers - 1);
                    dispatchPendingJobs();
                }
            }

            function dispatchPendingJobs() {
                if (RUN_STATE.stopRequested) return;
                const estTokens = estimateVideoTokens(options);

                for (const job of newJobs) {
                    if (job.status !== 'waiting') continue;

                    // Tìm Acc còn đủ token cho ít nhất 1 video VÀ chưa vượt quá số luồng/Acc
                    let chosenAccState = null;
                    for (const st of accStates) {
                        if (st.exhausted) continue;
                        const unreservedTokens = st.qModel.remaining - st.inFlightReservedTokens;
                        if (unreservedTokens < estTokens) {
                            if (!st.notifiedInsufficient && st.activeWorkers === 0) {
                                st.notifiedInsufficient = true;
                                addLog(`⚠️ Acc ${st.acc.name} chỉ còn ${st.qModel.remaining.toLocaleString()} token (< ${estTokens.toLocaleString()}) -> Tự động chuyển prompt sang Acc khác`, 'warn');
                            }
                            continue;
                        }
                        if (st.activeWorkers < concurrency) {
                            chosenAccState = st;
                            break;
                        }
                    }

                    if (!chosenAccState) {
                        // Kiểm tra xem có phải tất cả các Acc đều đã hết/không đủ token và không còn luồng nào đang chạy không
                        const anyAccountHasEnoughTokens = accStates.some(
                            st => !st.exhausted && (st.qModel.remaining - st.inFlightReservedTokens) >= estTokens
                        );
                        if (!anyAccountHasEnoughTokens && activePromises.size === 0) {
                            job.status = 'error';
                            job.statusText = `Tất cả Acc đã hết hoặc không đủ ${estTokens.toLocaleString()} token`;
                        }
                        continue;
                    }

                    // Khóa trước số token của video này ngay lập tức để các luồng sau biết chính xác số dư còn lại
                    chosenAccState.inFlightReservedTokens += estTokens;
                    chosenAccState.activeWorkers += 1;
                    const workerSlot = chosenAccState.activeWorkers;
                    job.status = 'submitting';
                    job.accountId = chosenAccState.acc.name || chosenAccState.acc.accountId;

                    const p = executeJobOnAccount(chosenAccState, job, workerSlot).finally(() => {
                        activePromises.delete(p);
                        dispatchPendingJobs();
                    });
                    activePromises.add(p);
                }
            }

            dispatchPendingJobs();

            while (activePromises.size > 0 && !RUN_STATE.stopRequested) {
                await Promise.race(activePromises);
            }

            for (const j of newJobs) {
                if (j.status === 'waiting') {
                    j.status = 'error';
                    j.statusText = `Hết hoặc không đủ ${estTokensPerVid.toLocaleString()} token trên tất cả Cookie`;
                }
            }

            saveAccounts(accounts);
        } finally {
            RUN_STATE.isRunning = false;
        }
    })();
}

// ==================== HỆ THỐNG CẬP NHẬT & ĐẨY CODE QUA GITHUB ====================
const GITHUB_CONFIG_FILE = path.join(ROOT_DIR, 'github_update_config.json');
const GITHUB_TOKEN_FILE = path.join(ROOT_DIR, '.github_token.json');

function loadGithubConfig() {
    const cfg = {
        repo_url: 'https://github.com/trafvina-sketch/gencpu-seedance-studio',
        branch: 'main',
        github_token: '',
        local_commit: '',
        last_updated: '',
        app_version: 'v2.5 Pro'
    };
    try {
        if (fs.existsSync(GITHUB_CONFIG_FILE)) {
            const loaded = JSON.parse(fs.readFileSync(GITHUB_CONFIG_FILE, 'utf8'));
            Object.assign(cfg, loaded);
        }
    } catch (_) {}
    try {
        if (fs.existsSync(GITHUB_TOKEN_FILE)) {
            const tObj = JSON.parse(fs.readFileSync(GITHUB_TOKEN_FILE, 'utf8'));
            if (tObj && tObj.github_token) cfg.github_token = tObj.github_token;
        }
    } catch (_) {}

    const gitDir = path.join(ROOT_DIR, '.git');
    if (fs.existsSync(gitDir)) {
        try {
            const cHash = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT_DIR, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
            if (cHash) cfg.local_commit = cHash;
        } catch (_) {}
    }
    return cfg;
}

function saveGithubConfig(updates = {}) {
    const cfg = loadGithubConfig();
    for (const k of ['repo_url', 'branch', 'github_token', 'local_commit', 'last_updated', 'app_version']) {
        if (updates[k] !== undefined && updates[k] !== null) {
            const val = String(updates[k]).trim();
            if (k === 'github_token' && !val && cfg.github_token) continue;
            cfg[k] = val;
        }
    }
    try {
        const publicCfg = {
            repo_url: cfg.repo_url,
            branch: cfg.branch || 'main',
            local_commit: cfg.local_commit || '',
            last_updated: cfg.last_updated || '',
            app_version: cfg.app_version || 'v2.5 Pro'
        };
        fs.writeFileSync(GITHUB_CONFIG_FILE, JSON.stringify(publicCfg, null, 2), 'utf8');
        if (cfg.github_token) {
            fs.writeFileSync(GITHUB_TOKEN_FILE, JSON.stringify({ github_token: cfg.github_token }, null, 2), 'utf8');
        }
    } catch (_) {}
    return cfg;
}

function parseGithubOwnerRepo(repoUrl) {
    const s = String(repoUrl || '').trim().replace(/\.git$/i, '');
    if (!s) return { owner: null, repo: null };
    const m = s.match(/github\.com[:/]([^/\s]+)\/([^/\s#?]+)/i);
    if (m) return { owner: m[1], repo: m[2] };
    const m2 = s.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
    if (m2) return { owner: m2[1], repo: m2[2] };
    return { owner: null, repo: null };
}

async function getGithubUpdateStatus(checkRemote = true) {
    const cfg = loadGithubConfig();
    const { owner, repo } = parseGithubOwnerRepo(cfg.repo_url);
    const branch = cfg.branch || 'main';
    const res = {
        ok: true,
        repo_url: cfg.repo_url || '',
        branch,
        local_commit: cfg.local_commit || '',
        last_updated: cfg.last_updated || '',
        app_version: cfg.app_version || 'v2.5 Pro',
        has_token: Boolean(cfg.github_token),
        remote_commit: '',
        remote_message: '',
        remote_date: '',
        remote_error: '',
        has_update: false
    };

    if (checkRemote && owner && repo) {
        const apiUrl = `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(branch)}`;
        const headers = {
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'GenCPU-Seedance-Studio-Updater'
        };
        if (cfg.github_token) headers['Authorization'] = `Bearer ${cfg.github_token}`;
        try {
            const resp = await fetch(apiUrl, { headers });
            if (resp.ok) {
                const data = await resp.json();
                const sha = String(data.sha || '').slice(0, 7);
                const msg = String(data.commit?.message || '').split(/\r?\n/)[0].slice(0, 140);
                const dt = String(data.commit?.committer?.date || '').slice(0, 16).replace('T', ' ');
                res.remote_commit = sha;
                res.remote_message = msg;
                res.remote_date = dt;
                if (sha && res.local_commit && sha !== res.local_commit) res.has_update = true;
                else if (sha && !res.local_commit) res.has_update = true;
            } else {
                res.remote_error = `Chưa có nhánh ${branch} trên GitHub (HTTP ${resp.status})`;
            }
        } catch (err) {
            res.remote_error = err.message;
        }
    }
    return res;
}

async function performGithubUpdate(payload = {}) {
    const cfg = saveGithubConfig(payload);
    const { owner, repo } = parseGithubOwnerRepo(cfg.repo_url);
    if (!owner || !repo) {
        return { ok: false, error: 'Đường dẫn GitHub Repo không hợp lệ (VD: https://github.com/username/repo)' };
    }
    const branch = cfg.branch || 'main';
    const headers = { 'User-Agent': 'GenCPU-Seedance-Studio-Updater' };
    if (cfg.github_token) headers['Authorization'] = `Bearer ${cfg.github_token}`;

    const statusInfo = await getGithubUpdateStatus(true);
    const newCommit = statusInfo.remote_commit || 'latest';

    const filesToSync = [
        'server_ui.js',
        'tao_video_cookie_sll.js',
        'xoa_logo_sll.js'
    ];
    let updatedCount = 0;

    for (const relFile of filesToSync) {
        try {
            const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${relFile}?t=${Date.now()}`;
            let resp = await fetch(rawUrl, { headers });
            let contentText = null;
            if (resp.ok) {
                contentText = await resp.text();
            } else {
                const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${relFile}?ref=${encodeURIComponent(branch)}`;
                const apiResp = await fetch(apiUrl, { headers: { ...headers, 'Accept': 'application/vnd.github.v3.raw' } });
                if (apiResp.ok) contentText = await apiResp.text();
            }
            if (contentText && contentText.length > 200) {
                const dest1 = path.join(ROOT_DIR, relFile);
                fs.writeFileSync(dest1, contentText, 'utf8');
                if (relFile === 'server_ui.js' && path.resolve(__filename) !== path.resolve(dest1)) {
                    try { fs.writeFileSync(__filename, contentText, 'utf8'); } catch (_) {}
                }
                updatedCount++;
            }
        } catch (_) {}
    }

    if (updatedCount === 0) {
        return { ok: false, error: 'Không tìm thấy bản cập nhật trên GitHub Repository này (Hãy chắc chắn Admin đã bấm Đẩy Code lên GitHub trước).' };
    }

    const nowStr = new Date().toISOString().slice(0, 16).replace('T', ' ');
    saveGithubConfig({
        repo_url: `https://github.com/${owner}/${repo}`,
        branch,
        local_commit: newCommit,
        last_updated: nowStr
    });

    // Tự động khởi động lại tiến trình sau 900ms để nạp code mới (Electron main.js sẽ tự động bật lại server_ui.js ngay lập tức)
    setTimeout(() => {
        if (!process.env.NO_AUTO_OPEN_BROWSER) {
            const child = spawn(process.execPath, [__filename], {
                cwd: ROOT_DIR,
                detached: true,
                stdio: 'ignore',
                windowsHide: true
            });
            child.unref();
        }
        process.exit(0);
    }, 900);

    return {
        ok: true,
        updated_files: updatedCount,
        new_commit: newCommit,
        last_updated: nowStr
    };
}

async function performGithubPush(payload = {}) {
    const cfg = saveGithubConfig(payload);
    const { owner, repo } = parseGithubOwnerRepo(cfg.repo_url);
    if (!owner || !repo) {
        return { ok: false, error: 'Vui lòng nhập đường dẫn GitHub Repo hợp lệ (VD: https://github.com/trafvina-sketch/gencpu-seedance-studio)' };
    }
    const branch = cfg.branch || 'main';
    const tok = (cfg.github_token || '').trim();
    const commitMsg = String(payload.commit_message || 'Update GenCPU Seedance Studio').trim();

    // Nếu có GitHub Token, tự động tạo Repo trên GitHub nếu chưa tồn tại
    if (tok) {
        try {
            const checkResp = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
                headers: { 'Authorization': `Bearer ${tok}`, 'User-Agent': 'GenCPU-Seedance-Studio' }
            });
            if (checkResp.status === 404) {
                await fetch('https://api.github.com/user/repos', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${tok}`,
                        'Content-Type': 'application/json',
                        'User-Agent': 'GenCPU-Seedance-Studio'
                    },
                    body: JSON.stringify({
                        name: repo,
                        description: 'GenCPU.com & GenPixo.com — Seedance AI Video Studio',
                        private: false
                    })
                });
            }
        } catch (_) {}
    }

    const cleanRemote = `https://github.com/${owner}/${repo}.git`;
    const pushRemote = tok ? `https://x-access-token:${tok}@github.com/${owner}/${repo}.git` : cleanRemote;

    try {
        if (!fs.existsSync(path.join(ROOT_DIR, '.git'))) {
            execFileSync('git', ['init'], { cwd: ROOT_DIR });
        }
        try { execFileSync('git', ['checkout', '-B', branch], { cwd: ROOT_DIR }); } catch (_) {}
        try {
            execFileSync('git', ['remote', 'set-url', 'origin', cleanRemote], { cwd: ROOT_DIR });
        } catch (_) {
            try { execFileSync('git', ['remote', 'add', 'origin', cleanRemote], { cwd: ROOT_DIR }); } catch (__) {}
        }

        execFileSync('git', ['add', '-A'], { cwd: ROOT_DIR });
        try {
            execFileSync('git', ['commit', '-m', commitMsg], { cwd: ROOT_DIR });
        } catch (_) {}

        const pushRes = spawnSync('git', ['push', '-u', pushRemote, `${branch}:${branch}`, '--force'], {
            cwd: ROOT_DIR,
            encoding: 'utf8',
            timeout: 60000
        });
        if (pushRes.status !== 0) {
            let errTxt = (pushRes.stderr || pushRes.stdout || 'Push thất bại').trim();
            if (tok) errTxt = errTxt.split(tok).join('***');
            return { ok: false, error: errTxt };
        }

        const cHash = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT_DIR }).toString().trim();
        const nowStr = new Date().toISOString().slice(0, 16).replace('T', ' ');
        saveGithubConfig({
            repo_url: `https://github.com/${owner}/${repo}`,
            branch,
            local_commit: cHash,
            last_updated: nowStr
        });

        return {
            ok: true,
            commit: cHash,
            branch,
            log: `Đã đẩy bản cập nhật (${cHash}) lên https://github.com/${owner}/${repo}`
        };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

// ==================== GIAO DIỆN GỌN GÀNG 2 CỘT CHUẨN GENCPU.COM ====================
const HTML_UI = `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>GenCPU.com & GenPixo.com — Seedance Studio</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%2314151a' stroke='%23d4b475' stroke-width='4'/%3E%3Crect x='16' y='16' width='32' height='32' rx='6' fill='%23d4b475'/%3E%3Cpolygon points='26,22 26,42 42,32' fill='%23111216'/%3E%3C/svg%3E">
<style>
  :root {
    --bg: #0b0c10;
    --card: #12141c;
    --input: #171a24;
    --border: #232736;
    --gold: #d4b475;
    --gold-light: #e6c88a;
    --text: #f1f5f9;
    --muted: #8b93a7;
    --success: #10b981;
    --danger: #ef4444;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
    background: var(--bg);
    color: var(--text);
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    font-size: 13px;
  }
  /* TOPBAR GỌN 1 DÒNG */
  .topbar {
    height: 52px;
    background: #0e1017;
    border-bottom: 1px solid var(--border);
    padding: 0 18px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .brand-icon {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    background: #171922;
    border: 1px solid var(--gold);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .brand-name { font-size: 15px; font-weight: 800; color: var(--gold-light); }
  .site-link {
    color: var(--gold-light);
    background: rgba(212, 180, 117, 0.12);
    border: 1px solid rgba(212, 180, 117, 0.3);
    padding: 3px 9px;
    border-radius: 6px;
    font-size: 11.5px;
    font-weight: 700;
    text-decoration: none;
  }
  .site-link:hover { background: rgba(212, 180, 117, 0.22); }

  /* BỐ CỤC CHÍNH 2 CỘT RÕ RÀNG */
  .layout {
    flex: 1;
    display: grid;
    grid-template-columns: 370px 1fr;
    gap: 14px;
    padding: 14px 18px;
    overflow: hidden;
  }
  .col {
    display: flex;
    flex-direction: column;
    gap: 12px;
    overflow: hidden;
  }
  .card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 14px;
  }
  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
    font-weight: 700;
    font-size: 13.5px;
    color: var(--gold-light);
  }
  textarea, select {
    width: 100%;
    background: var(--input);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 8px 10px;
    border-radius: 7px;
    font-size: 12.5px;
    font-family: inherit;
    outline: none;
  }
  textarea:focus, select:focus { border-color: var(--gold); }

  .btn {
    cursor: pointer;
    border: 1px solid var(--border);
    background: #1a1e2b;
    color: var(--text);
    padding: 7px 11px;
    border-radius: 7px;
    font-size: 12px;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    text-decoration: none;
    transition: 0.15s;
    white-space: nowrap;
  }
  .btn:hover { border-color: var(--gold); color: var(--gold-light); }
  .btn-gold {
    background: linear-gradient(90deg, #c6a664, #dfc387);
    color: #111216;
    border: none;
    font-weight: 800;
  }
  .btn-gold:hover { filter: brightness(1.07); color: #000; }

  /* DANH SÁCH ACC COOKIE GỌN RÕ GIỚI HẠN */
  .acc-list {
    flex: 1;
    overflow-y: auto;
    padding-right: 4px;
  }
  .acc-item {
    background: #161923;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 12px;
    margin-bottom: 8px;
  }
  .acc-row1 {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 4px;
  }
  .quota-bar {
    height: 5px;
    background: #232736;
    border-radius: 99px;
    overflow: hidden;
    margin-top: 6px;
  }
  .quota-fill { height: 100%; }

  /* DANH SÁCH VIDEO KẾT QUẢ */
  .jobs-scroll {
    flex: 1;
    overflow-y: auto;
    padding-right: 4px;
  }
  .job-item {
    background: #161923;
    border: 1px solid var(--border);
    border-radius: 9px;
    padding: 12px;
    margin-bottom: 10px;
    display: grid;
    grid-template-columns: 1fr 250px;
    gap: 14px;
    align-items: center;
  }
  .job-item video {
    width: 100%;
    max-height: 145px;
    border-radius: 7px;
    background: #000;
    display: block;
  }
</style>
</head>
<body>

<!-- THANH TRÊN CÙNG GỌN 1 HÀNG -->
<header class="topbar">
  <div class="brand">
    <div class="brand-icon">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <rect x="3" y="3" width="18" height="18" rx="4" stroke="#d4b475" stroke-width="2"/>
        <polygon points="10,8 10,16 16,12" fill="#d4b475"/>
      </svg>
    </div>
    <span class="brand-name">GenCPU.com × GenPixo.com</span>
    <a class="site-link" href="https://gencpu.com" target="_blank">🌐 gencpu.com</a>
    <a class="site-link" href="https://genpixo.com" target="_blank">🎨 genpixo.com</a>
  </div>

  <div style="display:flex;align-items:center;gap:10px;">
    <span style="font-size:12px;color:var(--muted);">
      Tổng khả dụng: <b id="totalSummaryBadge" style="color:var(--gold-light);">0 Token</b>
    </span>
    <label class="btn" style="cursor:pointer;" title="Chọn các file video MP4 có sẵn trên máy để xoá logo">
      ✂️ Xoá Logo Video Lẻ
      <input type="file" accept="video/mp4,video/*" multiple style="display:none" onchange="uploadVideosForDelogo(event)">
    </label>
    <button class="btn" onclick="openOutputFolder()">📂 Mở Folder Video</button>
    <button class="btn" id="githubHeaderBtn" onclick="openGithubModal()" style="border-color:rgba(212,180,117,0.45);color:var(--gold-light);">
      🔄 Cập nhật GitHub <span id="ghUpdateDot" style="display:none;background:#10b981;color:#fff;font-size:10px;padding:1px 6px;border-radius:99px;margin-left:4px;">Mới!</span>
    </button>
  </div>
</header>

<!-- MODAL CẬP NHẬT & ĐẨY BẢN UPDATE QUA GITHUB -->
<div id="githubModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:9999;align-items:center;justify-content:center;">
  <div style="width:520px;max-width:94vw;background:#12141c;border:1px solid var(--gold);border-radius:12px;padding:18px;box-shadow:0 20px 50px rgba(0,0,0,0.7);">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <div style="font-size:15px;font-weight:800;color:var(--gold-light);">🔄 Cập Nhật Tự Động Qua GitHub</div>
      <button class="btn" style="padding:3px 9px;" onclick="closeGithubModal()">✕</button>
    </div>

    <div style="background:#171a24;border:1px solid var(--border);border-radius:8px;padding:11px 12px;margin-bottom:12px;font-size:12.5px;line-height:1.6;">
      <div>📦 Phiên bản máy: <b id="ghLocalVer" style="color:var(--gold-light);">v2.5 Pro</b> <span id="ghLocalCommit" style="color:var(--muted);"></span></div>
      <div>☁️ Bản mới nhất trên GitHub: <b id="ghRemoteInfo" style="color:#34d399;">Đang kiểm tra...</b></div>
      <div id="ghStatusMsg" style="color:var(--muted);font-size:11.5px;margin-top:3px;">Giữ nguyên 100% Cookie và Video khi cập nhật.</div>
    </div>

    <div style="display:flex;gap:8px;margin-bottom:14px;">
      <button class="btn btn-gold" id="ghPullBtn" style="flex:1;padding:9px 14px;font-size:13px;" onclick="pullFromGithub()">
        ⬇️ Tải & Cập Nhật Ngay Từ GitHub
      </button>
      <button class="btn" onclick="checkGithubStatus(true)">🔍 Kiểm tra lại</button>
    </div>

    <details style="border-top:1px solid var(--border);padding-top:10px;">
      <summary style="cursor:pointer;font-size:12px;color:var(--gold-light);font-weight:700;user-select:none;">
        🛠️ Dành cho Admin (Cấu hình Repo & Đẩy bản Update lên GitHub)
      </summary>
      <div style="margin-top:10px;display:flex;flex-direction:column;gap:8px;">
        <div>
          <div style="font-size:11.5px;color:var(--muted);margin-bottom:3px;">Link GitHub Repository:</div>
          <input id="ghRepoInput" type="text" placeholder="https://github.com/trafvina-sketch/gencpu-seedance-studio" style="width:100%;background:var(--input);border:1px solid var(--border);color:var(--text);padding:7px 10px;border-radius:6px;font-size:12px;">
        </div>
        <div style="display:grid;grid-template-columns:110px 1fr;gap:8px;">
          <div>
            <div style="font-size:11.5px;color:var(--muted);margin-bottom:3px;">Nhánh (Branch):</div>
            <input id="ghBranchInput" type="text" value="main" style="width:100%;background:var(--input);border:1px solid var(--border);color:var(--text);padding:7px 10px;border-radius:6px;font-size:12px;">
          </div>
          <div>
            <div style="font-size:11.5px;color:var(--muted);margin-bottom:3px;">GitHub Token (Tùy chọn nếu chưa login Git):</div>
            <input id="ghTokenInput" type="password" placeholder="ghp_... (Chỉ lưu ở máy Admin, không đẩy lên mạng)" style="width:100%;background:var(--input);border:1px solid var(--border);color:var(--text);padding:7px 10px;border-radius:6px;font-size:12px;">
          </div>
        </div>
        <div>
          <div style="font-size:11.5px;color:var(--muted);margin-bottom:3px;">Ghi chú bản cập nhật (Commit Message):</div>
          <input id="ghCommitMsgInput" type="text" value="Update GenCPU Seedance Studio" style="width:100%;background:var(--input);border:1px solid var(--border);color:var(--text);padding:7px 10px;border-radius:6px;font-size:12px;">
        </div>
        <div style="display:flex;gap:8px;margin-top:4px;">
          <button class="btn" onclick="saveGithubRepoConfig()">💾 Lưu Link Repo</button>
          <button class="btn btn-gold" id="ghPushBtn" style="flex:1;" onclick="pushToGithub()">🚀 Đẩy Code Lên GitHub (Admin Push)</button>
        </div>
      </div>
    </details>
  </div>
</div>

<!-- BỐ CỤC 2 CỘT CHÍNH: TRÁI (COOKIE & GIỚI HẠN TOKEN) - PHẢI (TẠO VIDEO) -->
<div class="layout">

  <!-- CỘT TRÁI: THÊM COOKIE & BÁO GIỚI HẠN TOKEN -->
  <div class="col">
    <div class="card">
      <div class="card-header">
        <span>1. Thêm Cookie (Mỗi hàng 1 Acc)</span>
        <span id="cookieDetectBadge" style="font-size:11px;color:var(--muted);font-weight:500;">Tự nhận diện</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px;">
        <a class="btn" href="https://ai.byteplus.com/ark/region:ap-southeast-1/experience/gen_video?model=seedance-1-5-pro-251215" target="_blank" style="font-size:11.5px;padding:6px 8px;border-color:rgba(212,180,117,0.4);color:var(--gold-light);" title="Mở trang đăng ký BytePlus nhận 2,000,000 Token miễn phí">
          🎁 Đăng Ký Acc (2M Token)
        </a>
        <a class="btn" href="https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc?hl=en-US&utm_source=ext_sidebar" target="_blank" style="font-size:11.5px;padding:6px 8px;" title="Tải tiện ích Chrome Get cookies.txt LOCALLY để xuất Cookie">
          🧩 Tải Extension Lấy Cookie
        </a>
      </div>
      <textarea id="cookieInput" rows="4" oninput="previewCookieCount()" placeholder="Dán mỗi Cookie 1 hàng (hoặc khối Netscape / JSON) vào đây..."></textarea>
      <div style="display:flex;gap:6px;margin-top:8px;">
        <button class="btn btn-gold" id="addCookieBtn" style="flex:1;" onclick="addCookie()">＋ Thêm & Check Token</button>
        <label class="btn" style="cursor:pointer;">
          📄 File .txt
          <input type="file" accept=".txt,.json" multiple style="display:none" onchange="uploadCookieFile(event)">
        </label>
      </div>
    </div>

    <div class="card" style="flex:1;display:flex;flex-direction:column;overflow:hidden;">
      <div class="card-header">
        <span>🔑 Tài Khoản & Giới Hạn (<span id="accCount">0</span>)</span>
        <div style="display:flex;gap:5px;">
          <button class="btn" style="padding:3px 7px;font-size:11px;" onclick="refreshAccounts()" title="Kiểm tra lại số dư Token">🔄 Check lại</button>
          <button class="btn" style="padding:3px 7px;font-size:11px;" onclick="removeExhausted()" title="Xoá các tài khoản đã hết sạch Token">🗑️ Xoá acc hết</button>
        </div>
      </div>
      <div class="acc-list" id="accountsList"></div>
    </div>
  </div>

  <!-- CỘT PHẢI: TẠO VIDEO & DANH SÁCH KẾT QUẢ -->
  <div class="col">
    <div class="card">
      <div class="card-header">
        <span>2. Nhập Prompt Tạo Video (Mỗi dòng = 1 Video • Tự động xoá logo)</span>
        <label class="btn" style="padding:4px 9px;font-size:11.5px;cursor:pointer;">
          🖼️ + Chọn Ảnh (Image-to-Video)
          <input type="file" accept="image/*" multiple style="display:none" onchange="uploadRefImages(event)">
        </label>
      </div>

      <textarea id="promptsInput" rows="5" oninput="updatePromptCount()" placeholder="Mỗi dòng là 1 video..."></textarea>

      <div style="display:grid;grid-template-columns:1.5fr 0.8fr 0.8fr 0.8fr 0.9fr auto auto;gap:8px;margin-top:10px;align-items:center;">
        <select id="modelSelect" onchange="renderAccounts()">
          <option value="seedance-1-5-pro-251215">Seedance 1.5 Pro (2M Token)</option>
          <option value="seedance-1-0-pro-250528">Seedance 1.0 Pro (2M riêng)</option>
          <option value="seedance-1-0-pro-fast-251015">Seedance 1.0 Fast (2M riêng)</option>
        </select>
        <select id="durationSelect" onchange="renderAccounts()">
          <option value="12" selected>12 giây</option>
          <option value="10">10 giây</option>
          <option value="8">8 giây</option>
          <option value="5">5 giây</option>
        </select>
        <select id="resSelect" onchange="renderAccounts()">
          <option value="720p" selected>720p</option>
          <option value="480p">480p</option>
          <option value="1080p">1080p</option>
        </select>
        <select id="ratioSelect">
          <option value="16:9" selected>16:9</option>
          <option value="9:16">9:16</option>
          <option value="1:1">1:1</option>
          <option value="adaptive">Theo ảnh</option>
        </select>
        <select id="concurrencySelect">
          <option value="3" selected>3 Luồng/Acc</option>
          <option value="2">2 Luồng/Acc</option>
          <option value="1">1 Luồng/Acc</option>
          <option value="5">5 Luồng/Acc</option>
        </select>
        <label style="display:flex;align-items:center;gap:5px;background:var(--input);border:1px solid var(--border);padding:7px 10px;border-radius:7px;cursor:pointer;white-space:nowrap;">
          <input type="checkbox" id="audioCheck" checked> 🔊 Audio
        </label>
        <button class="btn btn-gold" id="startBtn" style="padding:8px 16px;font-size:13px;" onclick="startBatch()">
          🚀 Tạo Video (<span id="genBtnCount">0</span>)
        </button>
        <button class="btn" id="stopBtn" style="display:none;background:#ef4444;color:#fff;border:none;padding:8px 16px;" onclick="stopBatch()">
          ⏹ Dừng
        </button>
      </div>
    </div>

    <div class="card" style="flex:1;display:flex;flex-direction:column;overflow:hidden;">
      <div class="card-header">
        <span>🎞️ Tiến Trình & Video Đã Xoá Logo (<span id="jobsSummary">0</span>)</span>
        <span style="font-size:11.5px;color:var(--muted);font-weight:500;">Bộ xoá logo: <b id="encoderBadge" style="color:#34d399;">Auto</b></span>
      </div>
      <div class="jobs-scroll" id="jobsList"></div>
    </div>
  </div>

</div>

<script>
let currentAccounts = [];
let lastJobsJson = '';
let lastAccountsJson = '';

function getEstimatedTokensPerVideo() {
  const dur = Number(document.getElementById('durationSelect').value) || 12;
  const res = document.getElementById('resSelect').value;
  let w = 1280, h = 720;
  if (res === '480p') { w = 854; h = 480; }
  else if (res === '1080p') { w = 1920; h = 1080; }
  return Math.round((w * h * 24 * dur) / 1024) + 900;
}

function getPromptLines() {
  return document.getElementById('promptsInput').value
    .split(/\\r?\\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));
}

function updatePromptCount() {
  document.getElementById('genBtnCount').textContent = getPromptLines().length;
}

async function loadAccounts() {
  const res = await fetch('/api/accounts');
  const data = await res.json();
  currentAccounts = data.accounts || [];
  renderAccounts();
}

function renderAccounts() {
  document.getElementById('accCount').textContent = currentAccounts.length;
  const selectedModel = document.getElementById('modelSelect').value;
  const modelKey = selectedModel.includes('1-5-pro') ? 'seedance-1-5-pro'
    : selectedModel.includes('fast') ? 'seedance-1-0-pro-fast' : 'seedance-1-0-pro';

  const costPerVid = getEstimatedTokensPerVideo();
  let totalRem = 0;
  let totalVids = 0;

  for (const acc of currentAccounts) {
    const rem = acc.quotas?.[modelKey]?.remaining ?? 0;
    totalRem += rem;
    if (rem >= costPerVid) totalVids += Math.floor(rem / costPerVid);
  }

  document.getElementById('totalSummaryBadge').textContent =
    \`\${totalRem.toLocaleString()} Token (~\${totalVids} video)\`;

  const container = document.getElementById('accountsList');
  if (currentAccounts.length === 0) {
    container.innerHTML = '<p style="color:var(--muted);font-size:12px;padding:8px 0;">Chưa có Cookie nào. Hãy dán Cookie vào ô phía trên.</p>';
    return;
  }

  container.innerHTML = currentAccounts.map(acc => {
    const activeQ = (acc.quotas && acc.quotas[modelKey]) || { remaining: 0, total: 2000000 };
    const rem = activeQ.remaining ?? 0;
    const total = activeQ.total || 2000000;
    const pct = Math.round((rem / total) * 100);
    const estVids = rem >= costPerVid ? Math.floor(rem / costPerVid) : 0;
    const hasEnough = estVids > 0;
    const badgeBg = hasEnough ? 'rgba(16,185,129,0.16)' : (rem > 0 ? 'rgba(245,158,11,0.18)' : 'rgba(239,68,68,0.16)');
    const badgeColor = hasEnough ? '#34d399' : (rem > 0 ? '#fbbf24' : '#f87171');
    const badgeText = hasEnough ? \`Còn ~\${estVids} video (\${pct}%)\` : (rem > 0 ? \`Thiếu token (0 video)\` : 'Hết Token');

    return \`
      <div class="acc-item">
        <div class="acc-row1">
          <div>
            <strong style="color:#fff;">👤 \${acc.name || 'BytePlus'}</strong>
            <span style="font-size:11px;color:var(--muted);"> (\${acc.accountId})</span>
          </div>
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="font-size:11px;font-weight:700;padding:2px 7px;border-radius:99px;background:\${badgeBg};color:\${badgeColor};">
              \${badgeText}
            </span>
            <button class="btn" style="padding:1px 6px;font-size:11px;" onclick="deleteAccount('\${acc.id}')">✕</button>
          </div>
        </div>
        <div style="font-size:11.5px;color:var(--muted);display:flex;justify-content:space-between;">
          <span>Giới hạn \${modelKey}:</span>
          <b style="color:\${hasEnough?'var(--gold-light)':badgeColor}">\${rem.toLocaleString()} / 2,000,000</b>
        </div>
        <div class="quota-bar">
          <div class="quota-fill" style="width:\${pct}%;background:\${hasEnough?'#10b981':badgeColor}"></div>
        </div>
      </div>
    \`;
  }).join('');
}

function previewCookieCount() {
  const raw = document.getElementById('cookieInput').value.trim();
  const badge = document.getElementById('cookieDetectBadge');
  if (!raw) {
    badge.textContent = 'Tự nhận diện';
    badge.style.color = 'var(--muted)';
    return;
  }
  const lines = raw.split(/\\r?\\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  const singleLineMatches = lines.filter(l => !l.includes('\\t') && l.includes('digest') && l.includes('csrfToken'));
  if (singleLineMatches.length > 0) {
    badge.textContent = '✅ ' + singleLineMatches.length + ' Cookie';
    badge.style.color = '#34d399';
  } else if (raw.includes('digest') && raw.includes('csrfToken')) {
    badge.textContent = '✅ Hợp lệ';
    badge.style.color = '#34d399';
  } else {
    badge.textContent = '⚠️ Thiếu digest/csrfToken';
    badge.style.color = '#fbbf24';
  }
}

async function addCookie() {
  const raw = document.getElementById('cookieInput').value.trim();
  if (!raw) return alert('Hãy dán Cookie vào ô trước!');
  const btn = document.getElementById('addCookieBtn');
  const oldText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Đang kiểm tra...';
  try {
    const res = await fetch('/api/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rawCookie: raw })
    });
    const data = await res.json();
    if (!res.ok) return alert('Lỗi: ' + (data.error || 'Không thể thêm cookie'));
    document.getElementById('cookieInput').value = '';
    previewCookieCount();
    currentAccounts = data.accounts;
    renderAccounts();
  } finally {
    btn.disabled = false;
    btn.textContent = oldText;
  }
}

async function uploadCookieFile(ev) {
  const files = Array.from(ev.target.files || []);
  if (!files.length) return;
  const texts = [];
  for (const f of files) texts.push(await f.text());
  document.getElementById('cookieInput').value = texts.join('\\n---\\n');
  previewCookieCount();
  await addCookie();
  ev.target.value = '';
}

async function refreshAccounts() {
  const res = await fetch('/api/accounts/refresh', { method: 'POST' });
  const data = await res.json();
  currentAccounts = data.accounts || [];
  renderAccounts();
}

async function deleteAccount(id) {
  const res = await fetch('/api/accounts/' + encodeURIComponent(id), { method: 'DELETE' });
  const data = await res.json();
  currentAccounts = data.accounts || [];
  renderAccounts();
}

async function removeExhausted() {
  const costPerVid = getEstimatedTokensPerVideo();
  const modelKey = document.getElementById('modelSelect').value.includes('1-5-pro') ? 'seedance-1-5-pro'
    : document.getElementById('modelSelect').value.includes('fast') ? 'seedance-1-0-pro-fast' : 'seedance-1-0-pro';
  for (const acc of [...currentAccounts]) {
    const rem = acc.quotas?.[modelKey]?.remaining ?? 0;
    if (rem < costPerVid) {
      await fetch('/api/accounts/' + encodeURIComponent(acc.id), { method: 'DELETE' });
    }
  }
  await loadAccounts();
}

async function uploadRefImages(ev) {
  const files = Array.from(ev.target.files);
  if (!files.length) return;
  const addedLines = [];
  for (const f of files) {
    const buf = await f.arrayBuffer();
    const res = await fetch('/api/upload-image?name=' + encodeURIComponent(f.name), {
      method: 'POST',
      body: buf
    });
    const data = await res.json();
    if (data.savedPath) {
      addedLines.push(\`\${data.savedPath} | Chuyển động điện ảnh mượt mà\`);
    }
  }
  const box = document.getElementById('promptsInput');
  box.value = (box.value.trim() ? box.value.trim() + '\\n' : '') + addedLines.join('\\n');
  document.getElementById('ratioSelect').value = 'adaptive';
  updatePromptCount();
  ev.target.value = '';
}

async function startBatch() {
  const lines = getPromptLines();
  if (lines.length === 0) return alert('Hãy nhập ít nhất 1 dòng Prompt!');

  const prompts = lines.map(line => {
    if (line.includes('|')) {
      const [img, ...rest] = line.split('|');
      return { imagePath: img.trim(), prompt: rest.join('|').trim() };
    }
    return { imagePath: null, prompt: line };
  });

  const options = {
    modelId: document.getElementById('modelSelect').value,
    duration: Number(document.getElementById('durationSelect').value),
    resolution: document.getElementById('resSelect').value,
    ratio: document.getElementById('ratioSelect').value,
    concurrency: Number(document.getElementById('concurrencySelect').value),
    generateAudio: document.getElementById('audioCheck').checked
  };

  const res = await fetch('/api/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ options, prompts })
  });
  const data = await res.json();
  if (!res.ok) return alert(data.error || 'Không thể bắt đầu');
}

async function stopBatch() {
  await fetch('/api/stop', { method: 'POST' });
}

async function openOutputFolder() {
  await fetch('/api/open-folder', { method: 'POST' });
}

async function uploadVideosForDelogo(ev) {
  const files = Array.from(ev.target.files || []);
  if (!files.length) return;
  for (const f of files) {
    const buf = await f.arrayBuffer();
    await fetch('/api/delogo-upload?name=' + encodeURIComponent(f.name), {
      method: 'POST',
      body: buf
    });
  }
  ev.target.value = '';
}

async function pollStatus() {
  try {
    const res = await fetch('/api/status');
    const state = await res.json();

    if (state.encoderName) {
      document.getElementById('encoderBadge').textContent = state.encoderName;
    }

    document.getElementById('startBtn').style.display = state.isRunning ? 'none' : 'inline-flex';
    document.getElementById('stopBtn').style.display = state.isRunning ? 'inline-flex' : 'none';

    if (state.accounts) {
      const accJson = JSON.stringify(state.accounts.map(a => ({ id: a.id, q: a.quotas })));
      if (accJson !== lastAccountsJson) {
        lastAccountsJson = accJson;
        currentAccounts = state.accounts;
        renderAccounts();
      }
    }

    const jobs = state.jobs || [];
    const doneCount = jobs.filter(j => j.status === 'done').length;
    const runningCount = jobs.filter(j => j.status === 'submitting' || j.status === 'rendering' || j.status === 'cleaning').length;
    document.getElementById('jobsSummary').textContent = runningCount > 0 ? \`\${runningCount} đang chạy • \${doneCount} xong\` : \`\${doneCount} video\`;

    const jobsJson = JSON.stringify(jobs);
    if (jobsJson !== lastJobsJson) {
      lastJobsJson = jobsJson;
      if (jobs.length === 0) {
        document.getElementById('jobsList').innerHTML = '<p style="color:var(--muted);padding:16px 0;">Chưa có video nào.</p>';
      } else {
        document.getElementById('jobsList').innerHTML = jobs.map(j => \`
          <div class="job-item">
            <div>
              <div style="font-size:11.5px;color:var(--muted);margin-bottom:3px;">
                <b style="color:var(--gold-light);">Bài #\${j.id}</b>
                \${j.accountId ? ' • Acc: ' + j.accountId : ''}
                \${j.taskId ? ' • ' + j.taskId : ''}
              </div>
              <div style="font-size:12.5px;color:#e2e8f0;margin-bottom:6px;">\${j.prompt}</div>
              <div style="font-size:12px;font-weight:700;color:\${j.status==='done'?'#34d399':j.status==='error'?'#f87171':'#fbbf24'};">
                ● \${j.statusText}
              </div>
              \${j.cleanVideoUrl ? \`
                <div style="margin-top:8px;display:flex;gap:8px;">
                  <a class="btn btn-gold" style="padding:5px 12px;" href="\${j.cleanVideoUrl}" download>⬇️ Tải Video Sạch Logo</a>
                  <a class="btn" style="padding:5px 10px;" href="\${j.rawVideoUrl}" download>File Gốc</a>
                </div>
              \` : ''}
            </div>
            <div>
              \${j.cleanVideoUrl ? \`<video src="\${j.cleanVideoUrl}" controls preload="metadata"></video>\` : ''}
            </div>
          </div>
        \`).join('');
      }
    }
  } catch (_) {}
}

document.getElementById('promptsInput').value = [
  'A cinematic tracking shot of a samurai walking through a neon-lit cyberpunk Tokyo alley in heavy rain, reflections on wet asphalt, 4k photorealistic.',
  'Aerial drone shot flying over a majestic waterfall in a lush tropical jungle at golden hour, mist rising, flocks of birds flying across the sun.',
  'Close-up cinematic portrait of an astronaut looking out the spacecraft window at a glowing blue nebula, subtle camera push-in.'
].join('\\n');

function openGithubModal() {
  document.getElementById('githubModal').style.display = 'flex';
  checkGithubStatus(true);
}

function closeGithubModal() {
  document.getElementById('githubModal').style.display = 'none';
}

async function checkGithubStatus(showLoading = false) {
  try {
    if (showLoading) {
      document.getElementById('ghRemoteInfo').textContent = '⏳ Đang kiểm tra GitHub...';
    }
    const res = await fetch('/api/github/status');
    const data = await res.json();
    document.getElementById('ghLocalVer').textContent = data.app_version || 'v2.5 Pro';
    document.getElementById('ghLocalCommit').textContent = data.local_commit ? \`(Commit: \${data.local_commit})\` : '';
    if (data.repo_url && !document.getElementById('ghRepoInput').value) {
      document.getElementById('ghRepoInput').value = data.repo_url;
    }
    if (data.branch) {
      document.getElementById('ghBranchInput').value = data.branch;
    }
    const dot = document.getElementById('ghUpdateDot');
    if (data.remote_commit) {
      document.getElementById('ghRemoteInfo').textContent = \`Commit \${data.remote_commit} (\${data.remote_date || 'Mới nhất'}) — \${data.remote_message || ''}\`;
      document.getElementById('ghRemoteInfo').style.color = data.has_update ? '#34d399' : 'var(--gold-light)';
      dot.style.display = data.has_update ? 'inline-block' : 'none';
      document.getElementById('ghStatusMsg').textContent = data.has_update
        ? '✨ Phát hiện có bản cập nhật mới trên GitHub! Bấm nút bên dưới để cập nhật ngay.'
        : '✅ Bạn đang sử dụng phiên bản mới nhất trên GitHub.';
    } else {
      document.getElementById('ghRemoteInfo').textContent = data.remote_error || 'Chưa có commit trên GitHub Repo này';
      document.getElementById('ghRemoteInfo').style.color = '#fbbf24';
      dot.style.display = 'none';
    }
  } catch (_) {}
}

async function saveGithubRepoConfig() {
  const repo_url = document.getElementById('ghRepoInput').value.trim();
  const branch = document.getElementById('ghBranchInput').value.trim() || 'main';
  const github_token = document.getElementById('ghTokenInput').value.trim();
  const res = await fetch('/api/github/save-config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo_url, branch, github_token })
  });
  const data = await res.json();
  if (data.ok) {
    document.getElementById('ghStatusMsg').textContent = '✅ Đã lưu cấu hình GitHub Repo!';
    checkGithubStatus(true);
  }
}

async function pullFromGithub() {
  const btn = document.getElementById('ghPullBtn');
  const oldTxt = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Đang tải bản cập nhật từ GitHub...';
  try {
    const repo_url = document.getElementById('ghRepoInput').value.trim();
    const branch = document.getElementById('ghBranchInput').value.trim() || 'main';
    const res = await fetch('/api/github/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo_url, branch })
    });
    const data = await res.json();
    if (!data.ok) {
      alert('Lỗi cập nhật: ' + (data.error || 'Không thể tải từ GitHub'));
      btn.disabled = false;
      btn.textContent = oldTxt;
      return;
    }
    document.getElementById('ghStatusMsg').textContent = \`🎉 Đã cập nhật xong (\${data.new_commit})! Đang tự động khởi động lại ứng dụng...\`;
    btn.textContent = '🔄 Đang khởi động lại...';
    setTimeout(() => {
      const waitServer = setInterval(async () => {
        try {
          const r = await fetch('/api/status');
          if (r.ok) {
            clearInterval(waitServer);
            window.location.reload();
          }
        } catch (_) {}
      }, 600);
    }, 1200);
  } catch (err) {
    alert('Lỗi kết nối khi cập nhật: ' + err.message);
    btn.disabled = false;
    btn.textContent = oldTxt;
  }
}

async function pushToGithub() {
  const btn = document.getElementById('ghPushBtn');
  const oldTxt = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Đang đẩy code lên GitHub...';
  try {
    const repo_url = document.getElementById('ghRepoInput').value.trim();
    const branch = document.getElementById('ghBranchInput').value.trim() || 'main';
    const github_token = document.getElementById('ghTokenInput').value.trim();
    const commit_message = document.getElementById('ghCommitMsgInput').value.trim() || 'Update GenCPU Seedance Studio';
    const res = await fetch('/api/github/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo_url, branch, github_token, commit_message })
    });
    const data = await res.json();
    if (!data.ok) {
      alert('Lỗi đẩy lên GitHub: ' + (data.error || 'Không thành công'));
    } else {
      document.getElementById('ghStatusMsg').textContent = '✅ ' + data.log;
      await checkGithubStatus(true);
      alert('🚀 Đã đẩy bản cập nhật lên GitHub thành công! Tất cả máy khách bấm Cập Nhật sẽ nhận được bản mới ngay.');
    }
  } finally {
    btn.disabled = false;
    btn.textContent = oldTxt;
  }
}

updatePromptCount();
loadAccounts();
pollStatus();
checkGithubStatus(false);
setInterval(pollStatus, 1500);
</script>
</body>
</html>`;

// ==================== HTTP SERVER ====================
function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try { resolve(body ? JSON.parse(body) : {}); }
            catch (e) { reject(e); }
        });
    });
}

const server = http.createServer(async (req, res) => {
    const urlObj = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = urlObj.pathname;

    try {
        if (req.method === 'GET' && pathname === '/') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end(HTML_UI);
        }

        if (req.method === 'GET' && pathname === '/api/accounts') {
            const accounts = loadSavedAccounts();
            let changed = false;
            for (const acc of accounts) {
                if (!acc.quotas || Object.keys(acc.quotas).length === 0) {
                    try {
                        acc.quotas = await fetchAccountQuota(acc.cookies);
                        changed = true;
                    } catch (_) {}
                }
            }
            if (changed) saveAccounts(accounts);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ accounts }));
        }

        if (req.method === 'POST' && pathname === '/api/accounts') {
            const { rawCookie } = await readJsonBody(req);
            const cookieMaps = parseMultipleCookiesFromText(rawCookie);
            const accounts = loadSavedAccounts();

            const checkResults = await Promise.all(cookieMaps.map(async (cookies, idx) => {
                const accountId = cookies.AccountID || crypto.randomUUID().slice(0, 8);
                const name = cookies._accountName || `Acc_${accountId.slice(-4)}`;
                try {
                    const quotas = await fetchAccountQuota(cookies);
                    return { ok: true, accountId, name, cookies, quotas };
                } catch (err) {
                    return { ok: false, accountId, name, cookies, error: err.message || 'Cookie hết hạn', idx: idx + 1 };
                }
            }));

            let successCount = 0;
            for (const item of checkResults) {
                if (!item.ok) continue;
                successCount++;
                const entry = {
                    id: item.accountId,
                    accountId: item.accountId,
                    name: item.name,
                    addedAt: new Date().toISOString(),
                    cookies: item.cookies,
                    quotas: item.quotas
                };
                const existingIdx = accounts.findIndex(a => a.accountId === item.accountId);
                if (existingIdx >= 0) accounts[existingIdx] = entry;
                else accounts.unshift(entry);
            }

            if (successCount === 0 && checkResults.length > 0) {
                throw new Error(checkResults[0].error || 'Cookie không hợp lệ hoặc hết hạn!');
            }

            saveAccounts(accounts);
            try {
                const linesOut = accounts.map(a =>
                    Object.entries(a.cookies)
                        .filter(([k]) => !k.startsWith('_account'))
                        .map(([k, v]) => `${k}=${v}`)
                        .join('; ')
                );
                fs.writeFileSync(path.join(ROOT_DIR, 'cookies.txt'), linesOut.join('\n'), 'utf8');
            } catch (_) {}

            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ accounts, addedCount: successCount }));
        }

        if (req.method === 'POST' && pathname === '/api/delogo-upload') {
            const rawName = path.basename(urlObj.searchParams.get('name') || 'video.mp4');
            const safeName = `delogo_${Date.now()}_${rawName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
            const rawPath = path.join(DIRS.inputLogo, safeName);
            const cleanPath = path.join(DIRS.cleanOut, safeName);
            const chunks = [];
            req.on('data', d => chunks.push(d));
            req.on('end', async () => {
                try {
                    fs.writeFileSync(rawPath, Buffer.concat(chunks));
                    const job = {
                        id: RUN_STATE.jobs.length + 1,
                        prompt: `[Xoá Logo] ${rawName}`,
                        imagePath: null,
                        status: 'cleaning',
                        statusText: `Đang xoá logo (${RUN_STATE.encoderName})...`,
                        accountId: RUN_STATE.encoderName,
                        taskId: null,
                        cleanVideoUrl: null,
                        rawVideoUrl: null
                    };
                    RUN_STATE.jobs.unshift(job);
                    const info = await removeLogoFFmpeg(rawPath, cleanPath, true);
                    job.cleanVideoUrl = `/files/clean/${encodeURIComponent(safeName)}`;
                    job.rawVideoUrl = `/files/clean/${encodeURIComponent(safeName)}`;
                    job.status = 'done';
                    job.statusText = `Đã xoá sạch logo (${info.dims.width}x${info.dims.height}, ${info.elapsed}s)`;
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: true }));
                } catch (err) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: err.message }));
                }
            });
            return;
        }

        if (req.method === 'POST' && pathname === '/api/accounts/refresh') {
            const accounts = loadSavedAccounts();
            for (const acc of accounts) {
                try { acc.quotas = await fetchAccountQuota(acc.cookies); } catch (_) {}
            }
            saveAccounts(accounts);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ accounts }));
        }

        if (req.method === 'DELETE' && pathname.startsWith('/api/accounts/')) {
            const id = decodeURIComponent(pathname.replace('/api/accounts/', ''));
            let accounts = loadSavedAccounts().filter(a => a.id !== id);
            saveAccounts(accounts);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ accounts }));
        }

        if (req.method === 'POST' && pathname === '/api/upload-image') {
            const rawName = path.basename(urlObj.searchParams.get('name') || 'ref.jpg');
            const safeName = `${Date.now()}_${rawName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
            const fullPath = path.join(DIRS.uploads, safeName);
            const chunks = [];
            req.on('data', d => chunks.push(d));
            req.on('end', () => {
                fs.writeFileSync(fullPath, Buffer.concat(chunks));
                const relPath = path.relative(ROOT_DIR, fullPath);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ savedPath: relPath }));
            });
            return;
        }

        if (req.method === 'POST' && pathname === '/api/start') {
            const { options, prompts } = await readJsonBody(req);
            await startBatchGeneration(options, prompts);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ ok: true }));
        }

        if (req.method === 'POST' && pathname === '/api/stop') {
            RUN_STATE.stopRequested = true;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ ok: true }));
        }

        if (req.method === 'POST' && pathname === '/api/open-folder') {
            exec(`explorer.exe "${DIRS.cleanOut}"`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ ok: true }));
        }

        if (req.method === 'GET' && pathname === '/api/status') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ ...RUN_STATE, accounts: loadSavedAccounts() }));
        }

        if (req.method === 'GET' && pathname === '/api/github/status') {
            const st = await getGithubUpdateStatus(true);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(st));
        }

        if (req.method === 'POST' && pathname === '/api/github/save-config') {
            const body = await readJsonBody(req);
            const cfg = saveGithubConfig(body);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ ok: true, repo_url: cfg.repo_url, branch: cfg.branch }));
        }

        if (req.method === 'POST' && pathname === '/api/github/update') {
            const body = await readJsonBody(req);
            const result = await performGithubUpdate(body);
            res.writeHead(result.ok ? 200 : 400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(result));
        }

        if (req.method === 'POST' && pathname === '/api/github/push') {
            const body = await readJsonBody(req);
            const result = await performGithubPush(body);
            res.writeHead(result.ok ? 200 : 400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(result));
        }

        if (req.method === 'GET' && (pathname.startsWith('/files/clean/') || pathname.startsWith('/files/raw/'))) {
            const isClean = pathname.startsWith('/files/clean/');
            const fileName = path.basename(decodeURIComponent(pathname.replace(/^\/files\/(clean|raw)\//, '')));
            const filePath = path.join(isClean ? DIRS.cleanOut : DIRS.rawOut, fileName);
            if (!fs.existsSync(filePath)) {
                res.writeHead(404);
                return res.end('Not found');
            }
            const stat = fs.statSync(filePath);
            res.writeHead(200, {
                'Content-Type': 'video/mp4',
                'Content-Length': stat.size,
                'Content-Disposition': `inline; filename="${fileName}"`
            });
            return fs.createReadStream(filePath).pipe(res);
        }

        res.writeHead(404);
        res.end('Not found');
    } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
    }
});

server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
        const url = `http://localhost:${PORT}`;
        console.log(`🌟 Công cụ đã đang chạy sẵn tại ${url}`);
        if (process.env.NO_AUTO_OPEN_BROWSER !== '1') {
            exec(`start "" "${url}"`);
        }
        setTimeout(() => process.exit(0), 1000);
    } else {
        console.error('Lỗi khởi động Server:', err);
    }
});

if (process.argv.includes('--github-push')) {
    (async () => {
        const cfg = loadGithubConfig();
        const msgIdx = process.argv.indexOf('--msg');
        const msg = (msgIdx >= 0 && process.argv[msgIdx + 1]) ? process.argv[msgIdx + 1] : 'Update GenCPU Seedance Studio';
        const repoIdx = process.argv.indexOf('--repo');
        const repo = (repoIdx >= 0 && process.argv[repoIdx + 1]) ? process.argv[repoIdx + 1] : cfg.repo_url;
        console.log(`[*] Đang đẩy bản cập nhật lên GitHub: ${repo} ...`);
        const res = await performGithubPush({ repo_url: repo, commit_message: msg });
        console.log('\n[KẾT QUẢ]:', JSON.stringify(res, null, 2));
        process.exit(res.ok ? 0 : 1);
    })();
} else if (process.argv.includes('--github-update')) {
    (async () => {
        process.env.NO_AUTO_OPEN_BROWSER = '1';
        const cfg = loadGithubConfig();
        console.log(`[*] Đang kiểm tra & tải bản cập nhật từ GitHub: ${cfg.repo_url} ...`);
        const res = await performGithubUpdate({});
        console.log('\n[KẾT QUẢ]:', JSON.stringify(res, null, 2));
        process.exit(res.ok ? 0 : 1);
    })();
} else {
    server.listen(PORT, () => {
        const url = `http://localhost:${PORT}`;
        console.log('====================================================================');
        console.log(`🌟 SEEDANCE STUDIO (GENCPU.COM & GENPIXO.COM) ĐÃ MỞ TẠI: ${url}`);
        console.log('🌐 Website chính thức: https://gencpu.com  |  https://genpixo.com');
        console.log(`⚡ Bộ xử lý xoá logo hiện tại: ${RUN_STATE.encoderName}`);
        console.log('====================================================================');
        if (process.env.NO_AUTO_OPEN_BROWSER !== '1') {
            exec(`start "" "${url}"`);
        }
    });
}
