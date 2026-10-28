const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const cscCandidates = [
    'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
    'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe'
];
const csc = cscCandidates.find(p => fs.existsSync(p));
if (!csc) throw new Error('Không tìm thấy trình biên dịch csc.exe của Windows .NET Framework!');

// 1. Tạo file Icon đa độ phân giải (256x256, 64x64, 48x48, 32x32, 16x16) bằng System.Drawing
const iconGenCs = `
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;

class IconGen
{
    static byte[] RenderPng(int size)
    {
        using (Bitmap bmp = new Bitmap(size, size, PixelFormat.Format32bppArgb))
        using (Graphics g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.Clear(Color.Transparent);

            float pad = size * 0.04f;
            float w = size - pad * 2;
            float r = size * 0.24f;

            using (GraphicsPath path = RoundedRect(new RectangleF(pad, pad, w, w), r))
            using (LinearGradientBrush bg = new LinearGradientBrush(
                new PointF(0, 0),
                new PointF(size, size),
                Color.FromArgb(255, 22, 24, 34),
                Color.FromArgb(255, 11, 12, 16)))
            {
                g.FillPath(bg, path);
                using (Pen borderPen = new Pen(Color.FromArgb(255, 212, 180, 117), Math.Max(2f, size * 0.055f)))
                {
                    g.DrawPath(borderPen, path);
                }
            }

            // Viền chip vàng bên trong giống logo GenCPU.com
            float innerPad = size * 0.22f;
            float innerW = size - innerPad * 2;
            using (GraphicsPath innerPath = RoundedRect(new RectangleF(innerPad, innerPad, innerW, innerW), size * 0.10f))
            using (LinearGradientBrush goldBrush = new LinearGradientBrush(
                new PointF(innerPad, innerPad),
                new PointF(size - innerPad, size - innerPad),
                Color.FromArgb(255, 230, 200, 138),
                Color.FromArgb(255, 184, 138, 50)))
            {
                g.FillPath(goldBrush, innerPath);
            }

            // Nút Play màu tối ở trung tâm chip vàng
            PointF[] playPts = new PointF[]
            {
                new PointF(size * 0.40f, size * 0.34f),
                new PointF(size * 0.40f, size * 0.66f),
                new PointF(size * 0.65f, size * 0.50f)
            };
            using (SolidBrush darkBrush = new SolidBrush(Color.FromArgb(255, 15, 17, 23)))
            {
                g.FillPolygon(darkBrush, playPts);
            }

            using (MemoryStream ms = new MemoryStream())
            {
                bmp.Save(ms, ImageFormat.Png);
                return ms.ToArray();
            }
        }
    }

    static GraphicsPath RoundedRect(RectangleF bounds, float radius)
    {
        float d = radius * 2;
        GraphicsPath path = new GraphicsPath();
        path.AddArc(bounds.X, bounds.Y, d, d, 180, 90);
        path.AddArc(bounds.Right - d, bounds.Y, d, d, 270, 90);
        path.AddArc(bounds.Right - d, bounds.Bottom - d, d, d, 0, 90);
        path.AddArc(bounds.X, bounds.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }

    static void Main(string[] args)
    {
        int[] sizes = new int[] { 256, 64, 48, 32, 16 };
        byte[][] pngs = new byte[sizes.Length][];
        for (int i = 0; i < sizes.Length; i++) pngs[i] = RenderPng(sizes[i]);

        using (FileStream fs = new FileStream(args[0], FileMode.Create, FileAccess.Write))
        using (BinaryWriter bw = new BinaryWriter(fs))
        {
            bw.Write((short)0);
            bw.Write((short)1);
            bw.Write((short)sizes.Length);

            int offset = 6 + (16 * sizes.Length);
            for (int i = 0; i < sizes.Length; i++)
            {
                int s = sizes[i];
                bw.Write((byte)(s >= 256 ? 0 : s));
                bw.Write((byte)(s >= 256 ? 0 : s));
                bw.Write((byte)0);
                bw.Write((byte)0);
                bw.Write((short)1);
                bw.Write((short)32);
                bw.Write((int)pngs[i].Length);
                bw.Write((int)offset);
                offset += pngs[i].Length;
            }
            for (int i = 0; i < sizes.Length; i++)
            {
                bw.Write(pngs[i]);
            }
        }
    }
}
`;

const iconGenCsPath = path.join(__dirname, 'icon_gen.cs');
const iconGenExePath = path.join(__dirname, 'icon_gen.exe');
const icoPath = path.join(__dirname, 'gencpu_icon.ico');

fs.writeFileSync(iconGenCsPath, iconGenCs, 'utf8');
execFileSync(csc, ['/nologo', '/r:System.Drawing.dll', `/out:${iconGenExePath}`, iconGenCsPath], { stdio: 'inherit' });
execFileSync(iconGenExePath, [icoPath], { stdio: 'inherit' });
fs.unlinkSync(iconGenCsPath);
fs.unlinkSync(iconGenExePath);
console.log(`🎨 Đã tạo file Icon chuẩn đa phân giải: ${icoPath} (${(fs.statSync(icoPath).size / 1024).toFixed(1)} KB)`);

// 2. Nhúng server_ui.js và biên dịch file EXE có gắn Icon + thương hiệu gencpu.com & genpixo.com
const serverCode = fs.readFileSync(path.join(__dirname, 'server_ui.js'), 'utf8');
const compressedBase64 = zlib.gzipSync(Buffer.from(serverCode, 'utf8')).toString('base64');

const csSource = `
using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Reflection;
using System.Text;

[assembly: AssemblyTitle("GenCPU.com & GenPixo.com — Seedance AI Video Studio & GPU Delogo")]
[assembly: AssemblyDescription("Seedance 1.5 Pro Multi-Cookie Video Generator (3 Threads, 12s, 720p) + GPU Logo Remover - Powered by gencpu.com & genpixo.com")]
[assembly: AssemblyCompany("gencpu.com & genpixo.com")]
[assembly: AssemblyProduct("GenCPU x GenPixo Seedance Studio")]
[assembly: AssemblyCopyright("Copyright © gencpu.com & genpixo.com")]
[assembly: AssemblyVersion("2.5.0.0")]
[assembly: AssemblyFileVersion("2.5.0.0")]

namespace SeedanceStudio
{
    class Program
    {
        private const string EMBEDDED_SERVER_GZ_B64 = @"${compressedBase64}";

        static void Main(string[] args)
        {
            Console.OutputEncoding = Encoding.UTF8;
            Console.Title = "GenCPU.com & GenPixo.com — Seedance Cookie Studio (1 Acc 3 Luong - 12s 720p - Xoa Logo GPU)";

            Console.ForegroundColor = ConsoleColor.Cyan;
            Console.WriteLine("============================================================================");
            Console.WriteLine("   🌟 SEEDANCE AI VIDEO STUDIO & CONG CU XOA LOGO GPU (STANDALONE EXE)");
            Console.ForegroundColor = ConsoleColor.Green;
            Console.WriteLine("   🌐 Website chinh thuc: https://gencpu.com  |  https://genpixo.com");
            Console.ForegroundColor = ConsoleColor.Cyan;
            Console.WriteLine("   - Moi Cookie 1 hang (Tu nhan dien & Kiem tra 2,000,000 Token)");
            Console.WriteLine("   - Tu dong tru Token tuc thi & Xoay vong Cookie khi het Token");
            Console.WriteLine("   - Chay 1 Acc 3 Luong (Max 12s, 720p) + Tich hop Xoa Logo GPU NVENC");
            Console.WriteLine("============================================================================");
            Console.ResetColor();
            Console.WriteLine();

            try
            {
                ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12 | (SecurityProtocolType)3072;
                string exeDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\\\', '/');
                string binDir = Path.Combine(exeDir, "bin");
                if (!Directory.Exists(binDir)) Directory.CreateDirectory(binDir);

                // 1. Luon giai nen ban server_ui.js moi nhat tu EXE ra bin/server_ui.js
                string serverJsPath = Path.Combine(binDir, "server_ui.js");
                string localServerJs = Path.Combine(exeDir, "server_ui.js");
                if (File.Exists(localServerJs))
                {
                    serverJsPath = localServerJs;
                }
                else
                {
                    byte[] gzBytes = Convert.FromBase64String(EMBEDDED_SERVER_GZ_B64);
                    using (var ms = new MemoryStream(gzBytes))
                    using (var gz = new GZipStream(ms, CompressionMode.Decompress))
                    using (var outFs = new FileStream(serverJsPath, FileMode.Create, FileAccess.Write))
                    {
                        gz.CopyTo(outFs);
                    }
                }

                // 2. Tim hoac tu dong tai Node.js Portable (neu may nguoi nhan chua cai Node.js)
                string nodeExe = FindNodeExecutable(exeDir, binDir);
                if (string.IsNullOrEmpty(nodeExe))
                {
                    nodeExe = Path.Combine(binDir, "node.exe");
                    Console.ForegroundColor = ConsoleColor.Yellow;
                    Console.WriteLine("[*] May tinh nay chua co Node.js. Dang tu dong tai Node.js Portable (~30MB, chi tai 1 lan duy nhat)...");
                    Console.ResetColor();
                    DownloadFileWithProgress("https://nodejs.org/dist/v20.18.0/win-x64/node.exe", nodeExe);
                    Console.ForegroundColor = ConsoleColor.Green;
                    Console.WriteLine("[OK] Da tai xong Node.js Portable!");
                    Console.ResetColor();
                }

                // 3. Tim hoac tu dong tai FFmpeg Portable (neu may nguoi nhan chua co FFmpeg de xoa logo)
                string ffmpegExe = FindFfmpegExecutable(exeDir, binDir);
                if (string.IsNullOrEmpty(ffmpegExe))
                {
                    ffmpegExe = Path.Combine(binDir, "ffmpeg.exe");
                    Console.ForegroundColor = ConsoleColor.Yellow;
                    Console.WriteLine("[*] May tinh nay chua co FFmpeg. Dang tu dong tai FFmpeg GPU Portable (chi tai 1 lan duy nhat de xoa logo)...");
                    Console.ResetColor();
                    DownloadFileWithProgress("https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0/ffmpeg-win32-x64", ffmpegExe);
                    Console.ForegroundColor = ConsoleColor.Green;
                    Console.WriteLine("[OK] Da tai xong FFmpeg GPU Portable!");
                    Console.ResetColor();
                }

                // 4. Khoi chay Web Studio Server
                var psi = new ProcessStartInfo
                {
                    FileName = nodeExe,
                    Arguments = "\\"" + serverJsPath + "\\"",
                    WorkingDirectory = exeDir,
                    UseShellExecute = false
                };
                psi.EnvironmentVariables["SEEDANCE_ROOT_DIR"] = exeDir;
                psi.EnvironmentVariables["SEEDANCE_FFMPEG_PATH"] = ffmpegExe;

                var proc = Process.Start(psi);
                proc.WaitForExit();
            }
            catch (Exception ex)
            {
                Console.ForegroundColor = ConsoleColor.Red;
                Console.WriteLine("\\n[LOI] " + ex.Message);
                Console.ResetColor();
                Console.WriteLine("Nhan phim bat ky de dong cua so...");
                Console.ReadKey();
            }
        }

        static string FindNodeExecutable(string exeDir, string binDir)
        {
            string[] candidates = new string[]
            {
                Path.Combine(binDir, "node.exe"),
                Path.Combine(exeDir, "node.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe")
            };
            foreach (var c in candidates)
            {
                if (File.Exists(c)) return c;
            }
            try
            {
                var p = Process.Start(new ProcessStartInfo
                {
                    FileName = "node",
                    Arguments = "-v",
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    CreateNoWindow = true
                });
                p.WaitForExit(3000);
                if (p.ExitCode == 0) return "node";
            }
            catch { }
            return null;
        }

        static string FindFfmpegExecutable(string exeDir, string binDir)
        {
            string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            string[] candidates = new string[]
            {
                Path.Combine(binDir, "ffmpeg.exe"),
                Path.Combine(exeDir, "ffmpeg.exe"),
                Path.Combine(desktop, "Dự Án Riêng", "capcut tho", "ffmpeg-2025-12-24-git-abb1524138-full_build", "bin", "ffmpeg.exe")
            };
            foreach (var c in candidates)
            {
                if (File.Exists(c)) return c;
            }
            try
            {
                var p = Process.Start(new ProcessStartInfo
                {
                    FileName = "ffmpeg",
                    Arguments = "-version",
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    CreateNoWindow = true
                });
                p.WaitForExit(3000);
                if (p.ExitCode == 0) return "ffmpeg";
            }
            catch { }
            return null;
        }

        static void DownloadFileWithProgress(string url, string destPath)
        {
            string tmpPath = destPath + ".downloading";
            if (File.Exists(tmpPath)) File.Delete(tmpPath);

            HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url);
            req.UserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) GenCPU-GenPixo-SeedanceStudio/2.5";
            req.AllowAutoRedirect = true;

            using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
            using (Stream inStream = resp.GetResponseStream())
            using (FileStream outStream = new FileStream(tmpPath, FileMode.Create, FileAccess.Write))
            {
                long total = resp.ContentLength;
                byte[] buffer = new byte[65536];
                long readTotal = 0;
                int read;
                int lastPct = -1;
                while ((read = inStream.Read(buffer, 0, buffer.Length)) > 0)
                {
                    outStream.Write(buffer, 0, read);
                    readTotal += read;
                    if (total > 0)
                    {
                        int pct = (int)((readTotal * 100L) / total);
                        if (pct != lastPct && pct % 5 == 0)
                        {
                            lastPct = pct;
                            Console.Write("\\r    -> Dang tai: {0}% ({1:0.0} / {2:0.0} MB)   ", pct, readTotal / 1048576.0, total / 1048576.0);
                        }
                    }
                }
                Console.WriteLine();
            }

            if (File.Exists(destPath)) File.Delete(destPath);
            File.Move(tmpPath, destPath);
        }
    }
}
`;

const csPath = path.join(__dirname, 'launcher_build.cs');
fs.writeFileSync(csPath, csSource, 'utf8');

const outTargets = [
    path.join(__dirname, 'Seedance_Cookie_Studio.exe'),
    path.join(__dirname, 'GenCPU_GenPixo_Seedance_Studio.exe')
];

for (const targetExe of outTargets) {
    try {
        execFileSync(csc, [
            '/nologo',
            '/optimize+',
            '/target:exe',
            `/win32icon:${icoPath}`,
            `/out:${targetExe}`,
            csPath
        ], { stdio: 'inherit' });
        const stat = fs.statSync(targetExe);
        console.log(`✅ Đã đóng gói kèm Icon thành công: ${targetExe} (${(stat.size / 1024).toFixed(1)} KB)`);
    } catch (e) {
        console.warn(`⚠️ Không ghi đè được ${path.basename(targetExe)} (đang chạy): ${e.message}`);
    }
}

fs.unlinkSync(csPath);
