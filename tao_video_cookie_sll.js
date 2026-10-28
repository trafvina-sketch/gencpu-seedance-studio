/**
 * TOOL TẠO VIDEO BYTEPLUS SEEDANCE 1.5 BẰNG COOKIE (1 ACC 3 LUỒNG - MAX 12S - 720P)
 * + TỰ ĐỘNG XOAY VÒNG NHIỀU COOKIE KHI HẾT QUOTA (2,000,000 TOKENS/ACC)
 * + TỰ ĐỘNG TẢI VỀ & XOÁ LOGO "AI generated" BẰNG GPU (h264_nvenc / libx264)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawn } = require('child_process');

// ==================== CẤU HÌNH MẶC ĐỊNH ====================
const CONFIG = {
    cookiesFile: path.join(__dirname, 'cookies.txt'),
    cookiesDir: path.join(__dirname, 'cookies'), // Bỏ nhiều file cookie (acc1.txt, acc2.txt...) vào đây để chạy SLL
    promptsFile: path.join(__dirname, 'prompts.txt'),
    rawOutputDir: path.join(__dirname, 'output_goc'),
    cleanOutputDir: path.join(__dirname, 'output_khong_logo'),

    // Thông số model cố định theo yêu cầu: Seedance 1.5 Pro | Max 12s | 720p | 1 Acc 3 Luồng
    modelId: 'seedance-1-5-pro-251215',
    modelName: 'seedance-1-5-pro',
    modelVersion: '251215',
    duration: 12,          // Max 12 giây
    resolution: '720p',    // Khung chất lượng 720p
    defaultRatio: '16:9',  // Tỷ lệ mặc định cho Text-to-Video (16:9, 9:16, 1:1, 4:3, 3:4, adaptive)
    generateAudio: true,   // Bật âm thanh đồng bộ của Seedance 1.5 Pro
    concurrency: 3,        // 1 acc chạy 3 luồng song song
    pollIntervalMs: 5000,  // Kiểm tra trạng thái mỗi 5 giây
    useGpuDelogo: true     // Tự động xoá logo bằng GPU NVIDIA (fallback CPU nếu cần)
};

const BFF_BASE = 'https://arkbff-ap-southeast1.console.byteplus.com';
const CONSOLE_BASE = 'https://console.byteplus.com';
const WEB_ID_SECRET = 'ark-experience-tod-af9176#!';

// ==================== TIỆN ÍCH FFMPEG XOÁ LOGO ====================
function findBinary(name) {
    const desktopDir = path.join(process.env.USERPROFILE || 'C:\\Users\\Admin', 'Desktop');
    const directCandidates = [
        path.join(__dirname, 'bin', name),
        path.join(__dirname, name),
        path.join(desktopDir, 'Dự Án Riêng', 'capcut tho', 'ffmpeg-2025-12-24-git-abb1524138-full_build', 'bin', name)
    ];
    for (const p of directCandidates) {
        if (fs.existsSync(p)) return p;
    }
    try {
        execFileSync(name, ['-version'], { stdio: 'ignore' });
        return name;
    } catch (_) {}

    function walk(dir, depth = 0) {
        if (depth > 4) return [];
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
const FFPROBE = findBinary('ffprobe.exe');

function getVideoDimensions(filePath) {
    const out = execFileSync(FFPROBE, [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height:stream_side_data=rotation',
        '-of', 'json',
        filePath
    ], { encoding: 'utf8' });
    const data = JSON.parse(out);
    const stream = data.streams && data.streams[0];
    let w = parseInt(stream.width, 10);
    let h = parseInt(stream.height, 10);
    let rotation = 0;
    if (stream.side_data_list) {
        for (const sd of stream.side_data_list) {
            if (sd.rotation !== undefined) rotation = Math.abs(parseInt(sd.rotation, 10));
        }
    }
    if (rotation === 90 || rotation === 270) {
        const tmp = w; w = h; h = tmp;
    }
    return { width: w, height: h };
}

function removeLogoFFmpeg(inputPath, outputPath, useGpu = true) {
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
        const codecArgs = useGpu
            ? ['-c:v', 'h264_nvenc', '-preset', 'p4', '-cq', '21']
            : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20'];

        const args = [
            '-hide_banner', '-loglevel', 'error', '-y',
            '-i', inputPath,
            '-vf', vf,
            ...codecArgs,
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
                resolve({ dims, elapsed });
            } else if (useGpu) {
                removeLogoFFmpeg(inputPath, outputPath, false).then(resolve).catch(reject);
            } else {
                reject(new Error(`FFmpeg lỗi (${code}): ${stderr}`));
            }
        });
    });
}

// ==================== TIỆN ÍCH COOKIE & KIỂM TRA QUOTA ====================
function parseNetscapeCookies(filePath) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`Không tìm thấy file cookie tại: ${filePath}`);
    }
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
    const map = {};
    for (const line of lines) {
        if (!line || line.trim().startsWith('#')) continue;
        const parts = line.split('\t');
        if (parts.length >= 7) {
            map[parts[5].trim()] = parts[6].trim();
        }
    }
    if (!map.digest || !map.csrfToken) {
        throw new Error(`File ${path.basename(filePath)} thiếu trường "digest" hoặc "csrfToken".`);
    }
    return map;
}

function loadAllCookieAccounts() {
    const accounts = [];
    if (fs.existsSync(CONFIG.cookiesFile)) {
        try {
            accounts.push({
                sourceFile: 'cookies.txt',
                cookies: parseNetscapeCookies(CONFIG.cookiesFile)
            });
        } catch (e) {
            console.warn(`⚠️ Bỏ qua cookies.txt: ${e.message}`);
        }
    }
    if (fs.existsSync(CONFIG.cookiesDir)) {
        const files = fs.readdirSync(CONFIG.cookiesDir).filter(f => f.toLowerCase().endsWith('.txt'));
        for (const f of files) {
            const fullPath = path.join(CONFIG.cookiesDir, f);
            try {
                const parsed = parseNetscapeCookies(fullPath);
                // Tránh trùng lặp với cookies.txt nếu cùng AccountID và cùng digest
                if (!accounts.some(a => a.cookies.digest === parsed.digest)) {
                    accounts.push({
                        sourceFile: `cookies/${f}`,
                        cookies: parsed
                    });
                }
            } catch (e) {
                console.warn(`⚠️ Bỏ qua cookies/${f}: ${e.message}`);
            }
        }
    }
    return accounts;
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
    const cookieHeader = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
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

async function checkAccountQuota(cookies) {
    try {
        const res = await fetch(`${CONSOLE_BASE}/api/top/ark/ap-southeast-1/2024-01-01/ListModelChargeItems`, {
            method: 'POST',
            headers: buildHeaders(cookies, true),
            body: JSON.stringify({ ProjectName: 'default', PageNumber: 1, PageSize: 100 })
        });
        const data = await res.json();
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
    } catch (_) {
        return null;
    }
}

// ==================== API TƯƠNG TÁC VỚI BYTEPLUS BFF ====================
async function createWorkerSession(cookies) {
    const headers = buildHeaders(cookies, true);

    const convRes = await fetch(`${BFF_BASE}/api/2024-10-01/GetConversationDraft`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ Type: 'video', ProjectName: 'default' })
    });
    const convJson = await convRes.json();
    const conversationId = convJson?.Result?.Sid;
    if (!conversationId) {
        throw new Error(`Không tạo được Conversation: ${JSON.stringify(convJson)}`);
    }

    const sessRes = await fetch(`${BFF_BASE}/api/2024-10-01/CreateSession`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            ConversationId: conversationId,
            ModelType: 'foundation',
            ModelId: CONFIG.modelId
        })
    });
    const sessJson = await sessRes.json();
    const sessionId = sessJson?.Result?.Sid;
    if (!sessionId) {
        throw new Error(`Không tạo được Session: ${JSON.stringify(sessJson)}`);
    }

    return { conversationId, sessionId, lastMessageId: undefined };
}

async function uploadImageToTos(cookies, imagePath) {
    const absPath = path.isAbsolute(imagePath) ? imagePath : path.join(__dirname, imagePath);
    if (!fs.existsSync(absPath)) {
        throw new Error(`Không tìm thấy file ảnh tham chiếu: ${absPath}`);
    }
    const imgBuf = fs.readFileSync(absPath);
    const ext = path.extname(absPath).toLowerCase().replace('.', '') || 'jpeg';
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    const fileName = path.basename(absPath);

    const form = new FormData();
    form.append('file', new Blob([imgBuf], { type: mime }), fileName);
    form.append('biz', 'experience_video');
    form.append('type', 'image');
    form.append('modelName', CONFIG.modelName);
    form.append('modelVersion', CONFIG.modelVersion);

    const headers = buildHeaders(cookies, false);
    const res = await fetch(`${BFF_BASE}/api/2024-10-01/UploadArkTosFile`, {
        method: 'POST',
        headers,
        body: form
    });
    const data = await res.json();
    const r = data?.Result;
    if (!r || !r.Url || !r.Bucket || !r.Prefix) {
        throw new Error(`Upload ảnh thất bại: ${JSON.stringify(data)}`);
    }
    return {
        url: r.Url,
        bucketName: r.Bucket,
        objectKey: r.Prefix,
        label: fileName
    };
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

async function submitVideoGeneration(cookies, workerState, job) {
    const inputArr = [];
    let videoTaskType = 'text_to_video';
    let ratio = job.ratio || CONFIG.defaultRatio;

    if (job.imagePath) {
        const uploaded = await uploadImageToTos(cookies, job.imagePath);
        inputArr.push({
            Type: 'image',
            Content: uploaded.url,
            MediaMeta: {
                Tos: {
                    ObjectKey: uploaded.objectKey,
                    BucketName: uploaded.bucketName
                },
                Type: 'first_frame',
                Label: uploaded.label
            }
        });
        videoTaskType = 'first_frame';
        ratio = job.ratio || 'adaptive';
    }

    inputArr.push({
        Type: 'text',
        Content: job.prompt
    });

    const payload = {
        ConversationId: workerState.conversationId,
        SessionId: workerState.sessionId,
        ProjectName: 'default',
        ClientSubmissionId: crypto.randomUUID(),
        ModelInfo: {
            ModelId: CONFIG.modelId,
            Provider: 'ark',
            ModelName: CONFIG.modelName,
            ModelType: 'foundation',
            ModelVersion: CONFIG.modelVersion
        },
        Input: inputArr,
        Params: {
            Mode: 'generation-task',
            ConsoleParams: {
                VideoTaskType: videoTaskType,
                GenerationTaskType: 'video',
                GenerationTaskCount: 1
            },
            InferenceParams: JSON.stringify({
                seed: -1,
                resolution: CONFIG.resolution,
                ratio: ratio,
                duration: CONFIG.duration,
                camera_fixed: false,
                watermark: true,
                generate_audio: CONFIG.generateAudio,
                draft: false,
                execution_expires_after: 172800
            })
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
    if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${rawText.slice(0, 300)}`);
    }

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

    if (!messageItemId) {
        throw new Error(`Không nhận được messageItemId từ SSE: ${rawText.slice(0, 400)}`);
    }

    return { messageItemId, taskId };
}

async function pollUntilComplete(cookies, messageItemId, taskId, workerId, jobIndex, totalJobs) {
    const startPoll = Date.now();
    while (true) {
        await new Promise(r => setTimeout(r, CONFIG.pollIntervalMs));
        const res = await fetch(`${BFF_BASE}/api/2024-10-01/GetMessageItem`, {
            method: 'POST',
            headers: buildHeaders(cookies, true),
            body: JSON.stringify({ MessageItemId: messageItemId, ProjectName: 'default' })
        });
        const data = await res.json();
        const result = data?.Result;
        if (!result) continue;

        const status = (result.Status || '').toLowerCase();
        const elapsedSec = Math.round((Date.now() - startPoll) / 1000);

        if (status === 'success' || status === 'succeeded') {
            const contentObj = JSON.parse(result.Content || '{}');
            const downloadUrl = contentObj.downloadUrl || contentObj.url;
            if (!downloadUrl) {
                throw new Error(`Task ${taskId} hoàn tất nhưng không có downloadUrl`);
            }
            return { downloadUrl, taskId: contentObj.taskId || taskId, elapsedSec };
        } else if (status === 'failed' || status === 'error' || status === 'cancelled') {
            throw new Error(`Task ${taskId} thất bại trên server: ${result.Content || JSON.stringify(result)}`);
        } else {
            process.stdout.write(`\r⏳ [Luồng ${workerId}] Đang render bài (${jobIndex}/${totalJobs}) | Task: ${taskId} | Đã chờ: ${elapsedSec}s...   `);
        }
    }
}

async function downloadFile(url, destPath) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Tải video thất bại HTTP ${res.status}`);
    const arrayBuffer = await res.arrayBuffer();
    fs.writeFileSync(destPath, Buffer.from(arrayBuffer));
}

function loadJobs(promptsFile) {
    if (!fs.existsSync(promptsFile)) {
        const sample = [
            '# Mỗi dòng là 1 video cần tạo (12s, 720p).',
            '# Cách 1 (Text-to-Video): Chỉ viết câu prompt',
            '# Cách 2 (Image-to-Video): đường_dẫn_ảnh.jpg | câu prompt',
            'A cinematic tracking shot of a samurai walking through a neon-lit cyberpunk Tokyo alley in heavy rain, reflections on wet asphalt, 4k photorealistic.',
            'Aerial drone shot flying over a majestic waterfall in a lush tropical jungle at golden hour, mist rising, flocks of birds flying across the sun.',
            'Close-up cinematic portrait of an astronaut looking out the spacecraft window at a glowing blue nebula, subtle camera push-in.'
        ].join('\n');
        fs.writeFileSync(promptsFile, sample, 'utf8');
    }

    const lines = fs.readFileSync(promptsFile, 'utf8')
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('#'));

    return lines.map((line, idx) => {
        if (line.includes('|')) {
            const [left, ...rest] = line.split('|');
            return {
                index: idx + 1,
                imagePath: left.trim(),
                prompt: rest.join('|').trim()
            };
        }
        return {
            index: idx + 1,
            imagePath: null,
            prompt: line
        };
    });
}

// ==================== LUỒNG CHẠY CHÍNH (1 ACC 3 LUỒNG + XOAY VÒNG COOKIE) ====================
async function main() {
    if (!fs.existsSync(CONFIG.rawOutputDir)) fs.mkdirSync(CONFIG.rawOutputDir, { recursive: true });
    if (!fs.existsSync(CONFIG.cleanOutputDir)) fs.mkdirSync(CONFIG.cleanOutputDir, { recursive: true });
    if (!fs.existsSync(CONFIG.cookiesDir)) fs.mkdirSync(CONFIG.cookiesDir, { recursive: true });

    const allAccounts = loadAllCookieAccounts();
    const jobs = loadJobs(CONFIG.promptsFile);

    if (allAccounts.length === 0) {
        console.log('❌ Không tìm thấy file cookie nào trong cookies.txt hoặc thư mục cookies/.');
        return;
    }

    console.log('========================================================================');
    console.log('🚀 TOOL TẠO VIDEO BYTEPLUS SEEDANCE 1.5 BẰNG COOKIE + XOÁ LOGO TỰ ĐỘNG');
    console.log(`🎞️  Cấu hình cố định   : Model=${CONFIG.modelId} | Max=${CONFIG.duration}s | Chất lượng=${CONFIG.resolution}`);
    console.log(`⚡ Số luồng song song  : ${CONFIG.concurrency} luồng / 1 acc`);
    console.log(`📋 Tổng số video cần tạo: ${jobs.length} video`);
    console.log(`🔑 Số file Cookie tìm thấy: ${allAccounts.length} tài khoản`);
    console.log('========================================================================\n');

    // Kiểm tra hạn mức Free Trial Quota từng tài khoản
    const validAccounts = [];
    for (const acc of allAccounts) {
        const accId = acc.cookies.AccountID || 'Unknown';
        const quotas = await checkAccountQuota(acc.cookies);
        const q15 = quotas && quotas[CONFIG.modelName];
        if (q15) {
            const remPct = ((q15.remaining / q15.total) * 100).toFixed(1);
            console.log(`📊 [${acc.sourceFile} | AccountID: ${accId}] Quota ${CONFIG.modelName}: còn ${q15.remaining.toLocaleString()} / ${q15.total.toLocaleString()} tokens (${remPct}%)`);
            if (q15.remaining <= 0) {
                console.log(`   ⚠️ Tài khoản ${accId} ĐÃ DÙNG HẾT 100% (2,000,000 / 2,000,000 tokens) của model ${CONFIG.modelName}!`);
                const q10 = quotas['seedance-1-0-pro'];
                const q10f = quotas['seedance-1-0-pro-fast'];
                if (q10 && q10.remaining > 0) {
                    console.log(`   💡 Gợi ý: Tài khoản này vẫn còn ${q10.remaining.toLocaleString()} free tokens ở model "seedance-1-0-pro" và ${(q10f?.remaining || 0).toLocaleString()} tokens ở "seedance-1-0-pro-fast".`);
                }
                console.log(`   👉 Để tạo tiếp với ${CONFIG.modelName}, hãy thay Cookie acc mới vào "cookies.txt" hoặc bỏ thêm các file cookie acc mới vào thư mục "D:\\see byteplus\\cookies\\"!`);
                continue;
            }
        }
        validAccounts.push(acc);
    }

    if (validAccounts.length === 0) {
        console.log('\n========================================================================');
        console.log('⛔ TẤT CẢ COOKIE HIỆN TẠI ĐỀU ĐÃ HẾT 2,000,000 TOKEN FREE CỦA SEEDANCE 1.5 PRO!');
        console.log('📌 Hướng dẫn chạy tiếp:');
        console.log('   1. Dán Cookie của tài khoản BytePlus mới vào file: D:\\see byteplus\\cookies.txt');
        console.log('   2. Hoặc bỏ nhiều file cookie (acc1.txt, acc2.txt...) vào thư mục: D:\\see byteplus\\cookies\\');
        console.log('   3. Bấm chạy lại CHAY_TAO_VIDEO_3_LUONG.bat!');
        console.log('========================================================================');
        return;
    }

    let queueIdx = 0;
    let successCount = 0;

    for (const acc of validAccounts) {
        if (queueIdx >= jobs.length) break;
        const accId = acc.cookies.AccountID || 'Unknown';
        console.log(`\n▶️ Đang chạy tài khoản [${acc.sourceFile} | AccountID: ${accId}] với ${CONFIG.concurrency} luồng song song...`);
        let accountExhausted = false;

        async function worker(workerId) {
            let workerState = null;
            try {
                workerState = await createWorkerSession(acc.cookies);
                console.log(`✅ [Luồng ${workerId}] Đã khởi tạo phiên độc lập: SessionId=${workerState.sessionId}`);
            } catch (err) {
                console.error(`❌ [Luồng ${workerId}] Không thể khởi tạo phiên: ${err.message}`);
                return;
            }

            while (queueIdx < jobs.length && !accountExhausted) {
                const currentIdx = queueIdx++;
                const currentJob = jobs[currentIdx];
                const tag = `[Luồng ${workerId} | Bài #${currentJob.index}/${jobs.length}]`;
                const modeStr = currentJob.imagePath ? `Image2Video (${path.basename(currentJob.imagePath)})` : 'Text2Video';

                try {
                    console.log(`\n🎬 ${tag} Gửi lệnh tạo (${modeStr}): "${currentJob.prompt.slice(0, 65)}..."`);
                    const { messageItemId, taskId } = await submitVideoGeneration(acc.cookies, workerState, currentJob);
                    console.log(`📨 ${tag} Đã nhận TaskID: ${taskId} (MessageItem: ${messageItemId})`);

                    const { downloadUrl, elapsedSec } = await pollUntilComplete(
                        acc.cookies, messageItemId, taskId, workerId, currentJob.index, jobs.length
                    );
                    console.log(`\n📥 ${tag} Render xong sau ${elapsedSec}s! Đang tải MP4 gốc...`);

                    const baseFileName = `video_${String(currentJob.index).padStart(3, '0')}_${taskId}.mp4`;
                    const rawPath = path.join(CONFIG.rawOutputDir, baseFileName);
                    const cleanPath = path.join(CONFIG.cleanOutputDir, baseFileName);

                    await downloadFile(downloadUrl, rawPath);

                    console.log(`🧹 ${tag} Đang xoá logo "AI generated" bằng GPU...`);
                    const delogoRes = await removeLogoFFmpeg(rawPath, cleanPath, CONFIG.useGpuDelogo);
                    successCount++;

                    console.log(`✨ ${tag} HOÀN TẤT! [${delogoRes.dims.width}x${delogoRes.dims.height}, xoá logo ${delogoRes.elapsed}s]`);
                    console.log(`   👉 File sạch logo: ${cleanPath}`);
                } catch (err) {
                    console.error(`\n❌ ${tag} Lỗi: ${err.message}`);
                    if (err.code === 'QuotaExceeded.FreeTrialQuota' || err.message.includes('QuotaExceeded')) {
                        accountExhausted = true;
                        // Đẩy lại bài chưa chạy xong vào hàng đợi cho tài khoản kế tiếp
                        queueIdx = Math.min(queueIdx, currentIdx);
                        break;
                    }
                    try {
                        workerState = await createWorkerSession(acc.cookies);
                    } catch (_) {}
                }
            }
        }

        const activeWorkers = Math.min(CONFIG.concurrency, jobs.length - queueIdx);
        const promises = [];
        for (let w = 1; w <= activeWorkers; w++) {
            promises.push(worker(w));
        }
        await Promise.all(promises);
    }

    console.log('\n========================================================================');
    console.log(`🎉 ĐÃ XỬ LÝ XONG! Thành công: ${successCount}/${jobs.length} video.`);
    console.log(`📁 Thư mục video ĐÃ XOÁ LOGO : ${CONFIG.cleanOutputDir}`);
    console.log(`📁 Thư mục video gốc có logo : ${CONFIG.rawOutputDir}`);
    console.log('========================================================================');
}

if (require.main === module) {
    main().catch(err => console.error('Lỗi nghiêm trọng:', err));
}

module.exports = {
    CONFIG,
    parseNetscapeCookies,
    buildHeaders,
    pollUntilComplete,
    downloadFile,
    removeLogoFFmpeg
};
