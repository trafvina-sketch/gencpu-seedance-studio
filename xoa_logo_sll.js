/**
 * TOOL XOÁ LOGO "AI generated" BYTEPLUS SEEDANCE HÀNG LOẠT (SLL)
 * Hỗ trợ đa luồng (Parallel Workers) + Tăng tốc GPU NVIDIA (h264_nvenc) / CPU (libx264)
 * Tự động nhận diện mọi độ phân giải (480p, 720p, 1080p - Ngang 16:9, Dọc 9:16, Vuông 1:1)
 */

const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

// Cấu hình mặc định
const CONFIG = {
    inputDir: process.argv[2] || __dirname,
    outputDir: process.argv[3] || path.join(__dirname, 'output_khong_logo'),
    mode: (process.argv[4] || 'delogo').toLowerCase(), // 'delogo' (giữ nguyên góc nhìn) hoặc 'crop' (zoom nhẹ 8% cắt bỏ góc)
    concurrency: parseInt(process.argv[5] || '3', 10), // Số luồng chạy song song (GTX 1050 hỗ trợ tốt 2-3 luồng NVENC cùng lúc)
    useGpu: true
};

function findBinary(name) {
    // 1. Kiểm tra đường dẫn cố định đã biết trên máy (khởi động tức thì 0.01s)
    const desktopDir = path.join(process.env.USERPROFILE || 'C:\\Users\\Admin', 'Desktop');
    const directCandidates = [
        path.join(__dirname, 'bin', name),
        path.join(__dirname, name),
        path.join(desktopDir, 'Dự Án Riêng', 'capcut tho', 'ffmpeg-2025-12-24-git-abb1524138-full_build', 'bin', name)
    ];
    for (const p of directCandidates) {
        if (fs.existsSync(p)) return p;
    }

    // 2. Kiểm tra trong PATH hệ thống
    try {
        execFileSync(name, ['-version'], { stdio: 'ignore' });
        return name;
    } catch (_) {}

    // 3. Quét tìm trong Desktop nếu đổi tên thư mục
    function walk(dir, depth = 0) {
        if (depth > 4) return [];
        let results = [];
        try {
            const list = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of list) {
                if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    results = results.concat(walk(fullPath, depth + 1));
                } else if (entry.isFile() && entry.name.toLowerCase() === name.toLowerCase()) {
                    results.push(fullPath);
                }
            }
        } catch (_) {}
        return results;
    }
    const found = walk(desktopDir);
    const fullBuild = found.find(p => p.includes('full_build')) || found[0];
    if (!fullBuild) {
        throw new Error(`Không tìm thấy ${name}. Hãy cài đặt FFmpeg hoặc đặt vào thư mục dự án.`);
    }
    return fullBuild;
}

const FFMPEG = findBinary('ffmpeg.exe');
const FFPROBE = findBinary('ffprobe.exe');

/**
 * Lấy kích thước hiển thị thực tế của video (đã tính góc xoay rotation metadata -90/90 độ)
 */
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
    if (!stream) throw new Error('Không đọc được thông tin stream video');

    let w = parseInt(stream.width, 10);
    let h = parseInt(stream.height, 10);
    let rotation = 0;

    if (stream.side_data_list) {
        for (const sd of stream.side_data_list) {
            if (sd.rotation !== undefined) {
                rotation = Math.abs(parseInt(sd.rotation, 10));
            }
        }
    }

    if (rotation === 90 || rotation === 270) {
        const tmp = w;
        w = h;
        h = tmp;
    }
    return { width: w, height: h };
}

/**
 * Tính toạ độ chuẩn của watermark "AI generated" của BytePlus theo tỷ lệ min(W, H)
 * Đã đo đạc chính xác từ sample 480x848 và 1280x720:
 * - Ở 480p (min=480): w=146, h=30, lề phải=26, lề dưới=26
 * - Ở 720p (min=720, tỷ lệ 1.5x): w=216, h=44, lề phải=39, lề dưới=40
 */
function buildFilter(width, height, mode) {
    if (mode === 'crop') {
        // Cắt 12% góc dưới-phải rồi phóng lại kích thước chuẩn với bộ lọc Lanczos sắc nét
        return `crop=iw*0.88:ih*0.88:0:0,scale=${width}:${height}:flags=lanczos`;
    }

    const scale = Math.min(width, height) / 480.0;
    const w = Math.round(146 * scale);
    const h = Math.round(30 * scale);
    const marginX = Math.round(26 * scale);
    const marginY = Math.round(27 * scale);

    const x = width - marginX - w;
    const y = height - marginY - h;

    return `delogo=x=${x}:y=${y}:w=${w}:h=${h}`;
}

function processSingleVideo(inputPath, outputPath, mode, useGpu) {
    return new Promise((resolve, reject) => {
        let dims;
        try {
            dims = getVideoDimensions(inputPath);
        } catch (err) {
            return reject(err);
        }

        const vf = buildFilter(dims.width, dims.height, mode);
        const videoCodecArgs = useGpu
            ? ['-c:v', 'h264_nvenc', '-preset', 'p4', '-cq', '21']
            : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20'];

        const args = [
            '-hide_banner',
            '-loglevel', 'error',
            '-y',
            '-i', inputPath,
            '-vf', vf,
            ...videoCodecArgs,
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
                resolve({ inputPath, outputPath, dims, elapsed });
            } else if (useGpu) {
                // Tự động fallback về CPU nếu quá số luồng NVENC tối đa của card rời
                processSingleVideo(inputPath, outputPath, mode, false)
                    .then(resolve)
                    .catch(reject);
            } else {
                reject(new Error(`FFmpeg lỗi (${code}): ${stderr}`));
            }
        });
    });
}

async function main() {
    if (!fs.existsSync(CONFIG.outputDir)) {
        fs.mkdirSync(CONFIG.outputDir, { recursive: true });
    }

    const allFiles = fs.readdirSync(CONFIG.inputDir)
        .filter(f => f.toLowerCase().endsWith('.mp4') && !f.includes('_xoalogo_'))
        .map(f => path.join(CONFIG.inputDir, f));

    if (allFiles.length === 0) {
        console.log('Không tìm thấy file .mp4 nào cần xử lý.');
        return;
    }

    console.log('==============================================================');
    console.log(`🚀 BẮT ĐẦU XOÁ LOGO HÀNG LOẠT (SLL)`);
    console.log(`📂 Thư mục nguồn : ${CONFIG.inputDir}`);
    console.log(`📂 Thư mục xuất  : ${CONFIG.outputDir}`);
    console.log(`🛠️  Chế độ xoá    : ${CONFIG.mode.toUpperCase()} | Số luồng song song: ${CONFIG.concurrency}`);
    console.log(`🎬 Tổng số video : ${allFiles.length} file`);
    console.log('==============================================================');

    const startTime = Date.now();
    let index = 0;
    let completed = 0;

    async function worker(workerId) {
        while (index < allFiles.length) {
            const currentIdx = index++;
            const inFile = allFiles[currentIdx];
            const fileName = path.basename(inFile);
            const outFile = path.join(CONFIG.outputDir, fileName);

            try {
                const res = await processSingleVideo(inFile, outFile, CONFIG.mode, CONFIG.useGpu);
                completed++;
                console.log(`[Luồng ${workerId}] ✅ (${completed}/${allFiles.length}) ${fileName} [${res.dims.width}x${res.dims.height}] -> Xong trong ${res.elapsed}s`);
            } catch (err) {
                console.error(`[Luồng ${workerId}] ❌ Lỗi file ${fileName}: ${err.message}`);
            }
        }
    }

    const workers = [];
    for (let i = 1; i <= Math.min(CONFIG.concurrency, allFiles.length); i++) {
        workers.push(worker(i));
    }

    await Promise.all(workers);

    const totalSec = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log('==============================================================');
    console.log(`🎉 HOÀN TẤT ${completed}/${allFiles.length} VIDEO TRONG ${totalSec} GIÂY!`);
    console.log(`📁 Video sạch logo đã lưu tại: ${CONFIG.outputDir}`);
    console.log('==============================================================');
}

main();
