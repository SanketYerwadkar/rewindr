const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn, exec, execFile } = require('child_process');
const urlModule = require('url');

const PORT = 3001;
const YTDLP_PATH = path.join(__dirname, 'yt-dlp.exe');
const FFMPEG_PATH = path.join(__dirname, 'ffmpeg.exe');
const FFPROBE_PATH = path.join(__dirname, 'ffprobe.exe');
const ARIA2_PATH = path.join(__dirname, 'aria2c.exe');
const TEMP_DIR = path.join(__dirname, 'temp_downloads');

// Ensure temp directory exists
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR);
}

// Download tracker state
const downloads = {};

// Helper to download yt-dlp.exe if not present
function ensureYtDlp() {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(YTDLP_PATH)) {
      return resolve(YTDLP_PATH);
    }
    console.log("yt-dlp.exe not found. Downloading the latest version...");
    const downloadUrl = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
    
    const downloadFile = (url) => {
      https.get(url, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          downloadFile(response.headers.location);
          return;
        }
        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download yt-dlp: Status Code ${response.statusCode}`));
          return;
        }
        const file = fs.createWriteStream(YTDLP_PATH);
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          console.log("yt-dlp.exe downloaded successfully.");
          resolve(YTDLP_PATH);
        });
      }).on('error', (err) => {
        fs.unlink(YTDLP_PATH, () => {});
        reject(err);
      });
    };

    downloadFile(downloadUrl);
  });
}

let ffmpegPromise = null;

// Helper to download ffmpeg/ffprobe if not present
function ensureFfmpeg() {
  if (ffmpegPromise) return ffmpegPromise;

  ffmpegPromise = new Promise((resolve, reject) => {
    if (fs.existsSync(FFMPEG_PATH) && fs.existsSync(FFPROBE_PATH)) {
      return resolve();
    }
    console.log("ffmpeg/ffprobe binaries not found. Downloading Windows binaries...");
    
    const psCommand = `
      $ProgressPreference = 'SilentlyContinue';
      Write-Host "Downloading ffmpeg...";
      Invoke-WebRequest -Uri 'https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v4.4.1/ffmpeg-4.4.1-win-64.zip' -OutFile 'ffmpeg.zip';
      Write-Host "Downloading ffprobe...";
      Invoke-WebRequest -Uri 'https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v4.4.1/ffprobe-4.4.1-win-64.zip' -OutFile 'ffprobe.zip';
      Write-Host "Extracting binaries...";
      Expand-Archive -Path 'ffmpeg.zip' -DestinationPath '.' -Force;
      Expand-Archive -Path 'ffprobe.zip' -DestinationPath '.' -Force;
      Remove-Item 'ffmpeg.zip' -Force;
      Remove-Item 'ffprobe.zip' -Force;
    `;
    
    const child = spawn('powershell', ['-ExecutionPolicy', 'Bypass', '-Command', psCommand]);
    
    child.stdout.on('data', (data) => {
      console.log(data.toString().trim());
    });
    
    child.stderr.on('data', (data) => {
      console.error(data.toString().trim());
    });
    
    child.on('close', (code) => {
      if (code === 0 && fs.existsSync(FFMPEG_PATH) && fs.existsSync(FFPROBE_PATH)) {
        console.log("ffmpeg and ffprobe downloaded and extracted successfully.");
        resolve();
      } else {
        ffmpegPromise = null; // reset to allow retry
        reject(new Error("Failed to download or extract ffmpeg/ffprobe binaries. Code: " + code));
      }
    });
  });

  return ffmpegPromise;
}

let aria2Promise = null;

// Helper to download aria2c if not present
function ensureAria2() {
  if (aria2Promise) return aria2Promise;

  aria2Promise = new Promise((resolve, reject) => {
    if (fs.existsSync(ARIA2_PATH)) {
      return resolve(ARIA2_PATH);
    }
    console.log("aria2c.exe binary not found. Downloading Windows binary...");
    
    // Downloading stable aria2c win-64 build
    const psCommand = `
      $ProgressPreference = 'SilentlyContinue';
      Write-Host "Downloading aria2...";
      Invoke-WebRequest -Uri 'https://github.com/aria2/aria2/releases/download/release-1.36.0/aria2-1.36.0-win-64bit-build1.zip' -OutFile 'aria2.zip';
      Write-Host "Extracting aria2c.exe...";
      Expand-Archive -Path 'aria2.zip' -DestinationPath 'aria2_temp' -Force;
      Copy-Item -Path 'aria2_temp\\*\\aria2c.exe' -Destination '${__dirname}' -Force;
      Remove-Item 'aria2.zip' -Force;
      Remove-Item 'aria2_temp' -Recurse -Force;
    `;
    
    const child = spawn('powershell', ['-ExecutionPolicy', 'Bypass', '-Command', psCommand]);
    
    child.stdout.on('data', (data) => {
      console.log(data.toString().trim());
    });
    
    child.stderr.on('data', (data) => {
      console.error(data.toString().trim());
    });
    
    child.on('close', (code) => {
      if (code === 0 && fs.existsSync(ARIA2_PATH)) {
        console.log("aria2c.exe downloaded and extracted successfully.");
        resolve(ARIA2_PATH);
      } else {
        aria2Promise = null; // reset to allow retry
        reject(new Error("Failed to download or extract aria2c.exe binary. Code: " + code));
      }
    });
  });

  return aria2Promise;
}

function updateYtDlp() {
  return new Promise((resolve) => {
    console.log("Checking for yt-dlp updates...");
    const child = spawn(YTDLP_PATH, ['-U']);
    let output = '';
    child.stdout.on('data', (d) => { output += d.toString(); });
    child.stderr.on('data', (d) => { output += d.toString(); });
    child.on('close', (code) => {
      console.log(`yt-dlp update finished with code ${code}. Output:\n${output.trim()}`);
      resolve();
    });
  });
}

// Start ensuring components are present right away
ensureYtDlp()
  .then(() => updateYtDlp())
  .then(() => ensureFfmpeg())
  .then(() => ensureAria2())
  .catch(err => console.error("Error setting up backend binaries:", err));

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const liveReloadClients = [];

// Watch directory for changes
let watchTimeout;
fs.watch(__dirname, (eventType, filename) => {
  if (filename && (filename.endsWith('.html') || filename.endsWith('.js') || filename.endsWith('.css'))) {
    clearTimeout(watchTimeout);
    watchTimeout = setTimeout(() => {
      console.log(`File changed: ${filename}. Broadcasting reload signal.`);
      liveReloadClients.forEach(client => {
        client.write("data: reload\n\n");
      });
    }, 150);
  }
});

const server = http.createServer(async (req, res) => {
  const parsedUrl = urlModule.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // SSE: Live Reload Endpoint
  if (pathname === '/api/live-reload') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    
    liveReloadClients.push(res);
    
    req.on('close', () => {
      const index = liveReloadClients.indexOf(res);
      if (index !== -1) {
        liveReloadClients.splice(index, 1);
      }
    });
    return;
  }

  // API: Get Info / Qualities
  if (pathname === '/api/info') {
    const videoUrl = parsedUrl.query.url;
    if (!videoUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'URL parameter is required' }));
    }

    try {
      const ytdlp = await ensureYtDlp();
      await ensureFfmpeg(); // Make sure ffmpeg is ready for merges
      
      const child = spawn(ytdlp, ['-J', videoUrl]);
      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => { stdout += data; });
      child.stderr.on('data', (data) => { stderr += data; });

      child.on('close', (code) => {
        if (code !== 0) {
          res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          return res.end(JSON.stringify({ error: 'Failed to extract video info', details: stderr }));
        }

        try {
          const info = JSON.parse(stdout);
          
          // Group and clean formats to avoid duplicates and low-quality options
          const uniqueFormats = {};
          
          (info.formats || []).forEach(f => {
            if (f.vcodec === 'none' && f.acodec === 'none') return; // Skip storyboard images
            
            let height = f.height;
            let width = f.width;
            
            if (f.vcodec === 'none') {
              height = 0; // Audio-only
            } else if (!height) {
              const match = (f.resolution || '').match(/(\d+)x(\d+)/);
              if (match) {
                height = parseInt(match[2]);
                width = parseInt(match[1]);
              } else {
                const heightMatch = (f.format_note || '').match(/(\d+)p/);
                if (heightMatch) height = parseInt(heightMatch[1]);
              }
            }
            
            if (!height && f.vcodec !== 'none') return;

            const key = f.vcodec === 'none' ? 'audio' : `${height}p`;
            
            // Prefer formats with higher file size or direct HTTPS protocol over streaming protocols
            const currentBest = uniqueFormats[key];
            const isNewBetter = !currentBest || 
              (f.filesize && (!currentBest.filesize || f.filesize > currentBest.filesize)) ||
              (f.protocol === 'https' && currentBest.protocol !== 'https');
              
            if (isNewBetter) {
              uniqueFormats[key] = {
                formatId: f.format_id,
                extension: f.ext,
                height: height,
                width: width,
                filesize: f.filesize || f.filesize_approx || null,
                hasVideo: f.vcodec !== 'none',
                hasAudio: f.acodec !== 'none',
                protocol: f.protocol || ''
              };
            }
          });

          // Convert back to array
          let formatsList = Object.values(uniqueFormats);

          // Fallback if no formats are parsed but a direct streaming url is available
          if (formatsList.length === 0 && info.url) {
            formatsList.push({
              formatId: 'best',
              extension: info.ext || 'mp4',
              height: info.height || 720,
              width: info.width || 1280,
              filesize: info.filesize || info.filesize_approx || null,
              hasVideo: true,
              hasAudio: true,
              protocol: 'https'
            });
          }

          // Split video and audio
          const videoFormats = formatsList.filter(f => f.hasVideo);
          const audioFormats = formatsList.filter(f => !f.hasVideo);

          // Find best audio size for combined size calculation
          audioFormats.sort((a, b) => (b.filesize || 0) - (a.filesize || 0));
          const bestAudioSize = audioFormats[0] ? (audioFormats[0].filesize || 0) : 0;

          // Sort video formats by height descending (highest quality first)
          videoFormats.sort((a, b) => b.height - a.height);

          // Map all unique video resolutions
          const formats = videoFormats.map(f => {
            let label = `${f.height}p`;
            if (f.height >= 720 && f.height < 1080) label += ' HD';
            if (f.height >= 1080 && f.height < 1440) label = `${f.height}p Full HD`;
            if (f.height >= 1440 && f.height < 2160) label = `${f.height}p 2K`;
            if (f.height >= 2160 && f.height < 4320) label = `${f.height}p 4K`;
            if (f.height >= 4320) label = `${f.height}p 8K`;
            
            const totalBytes = (f.filesize || 0) + (f.hasAudio ? 0 : bestAudioSize);
            if (totalBytes > 0) {
              const mb = (totalBytes / (1024 * 1024)).toFixed(1);
              label += ` (~${mb} MB)`;
            }
            
            return {
              formatId: f.formatId,
              height: f.height,
              extension: f.extension,
              resolution: label,
              hasVideo: true,
              hasAudio: f.hasAudio
            };
          });

          // Add the single best audio format at the bottom
          if (audioFormats.length > 0) {
            const bestAudio = audioFormats[0];
            let audioLabel = `Audio Only (${bestAudio.extension})`;
            if (bestAudio.filesize) {
              audioLabel += ` (~${(bestAudio.filesize / (1024 * 1024)).toFixed(1)} MB)`;
            }
            formats.push({
              formatId: bestAudio.formatId,
              height: 0,
              extension: bestAudio.extension,
              resolution: audioLabel,
              hasVideo: false,
              hasAudio: true
            });
          }

          res.writeHead(200, { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          });
          res.end(JSON.stringify({
            title: info.title,
            thumbnail: info.thumbnail,
            duration: info.duration,
            formats: formats
          }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: 'Failed to parse video info JSON', details: e.message }));
        }
      });
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // API: Start download job (returns downloadId)
  if (pathname === '/api/download') {
    const videoUrl = parsedUrl.query.url;
    const formatId = parsedUrl.query.formatId;
    const formatHeight = parsedUrl.query.height ? parseInt(parsedUrl.query.height) : null;
    const videoTitle = parsedUrl.query.title || 'video';

    if (!videoUrl || !formatId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'url and formatId are required' }));
    }

    try {
      const ytdlp = await ensureYtDlp();
      await ensureFfmpeg();

      const downloadId = 'dl_' + Date.now();
      // Use wildcard %(ext)s so yt-dlp uses the correct container format (e.g. mp4, mkv, mp3)
      const outputPathTemplate = path.join(TEMP_DIR, `${downloadId}.%(ext)s`);

      downloads[downloadId] = {
        percent: 0,
        status: 'downloading',
        filePath: '',
        filename: '',
        userTitle: videoTitle
      };

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify({ downloadId }));

      const isAudioOnly = formatId === 'audio' || formatId.toLowerCase().includes('audio') || formatId === 'bestaudio';
      let formatStr;
      if (isAudioOnly) {
        formatStr = `${formatId}/bestaudio/best`;
      } else if (formatHeight) {
        formatStr = `bestvideo[height<=${formatHeight}]+bestaudio/bestvideo[format_id=${formatId}]+bestaudio/${formatId}+bestaudio/best`;
      } else {
        formatStr = `${formatId}+bestaudio/bestvideo+bestaudio/best`;
      }

      const args = [
        '-f', formatStr,
        '--ffmpeg-location', __dirname,
        '--newline',
        '-N', '8',
        '--buffer-size', '16M',
        '--remux-video', 'mp4',
        '--postprocessor-args', 'ffmpeg:-threads 0 -preset ultrafast',
        '-o', outputPathTemplate,
        videoUrl
      ];

      console.log(`Spawning yt-dlp with optimized concurrent args:`, args);
      const child = spawn(ytdlp, args);

      child.stdout.on('data', (data) => {
        const text = data.toString();
        const match = text.match(/(\d+(?:\.\d+)?)%/);
        if (match) {
          downloads[downloadId].percent = parseFloat(match[1]);
        }
      });

      child.stderr.on('data', (data) => {
        const text = data.toString();
        const match = text.match(/(\d+(?:\.\d+)?)%/);
        if (match) {
          downloads[downloadId].percent = parseFloat(match[1]);
        }
      });

      child.on('close', (code) => {
        if (code === 0) {
          try {
            const files = fs.readdirSync(TEMP_DIR);
            const matchedFile = files.find(f => f.startsWith(downloadId) && !f.endsWith('.part') && !f.endsWith('.ytdl'));
            
            if (matchedFile) {
              const ext = path.extname(matchedFile) || '.mp4';
              const cleanTitle = downloads[downloadId].userTitle.replace(/[\\/*?:"<>|]/g, "_");
              
              downloads[downloadId].status = 'ready';
              downloads[downloadId].percent = 100;
              downloads[downloadId].filePath = path.join(TEMP_DIR, matchedFile);
              downloads[downloadId].filename = `${cleanTitle}${ext}`;
              console.log(`Download ${downloadId} completed successfully: ${downloads[downloadId].filename}`);
            } else {
              downloads[downloadId].status = 'error';
              console.error(`Downloaded file not found for job ${downloadId}`);
            }
          } catch (e) {
            downloads[downloadId].status = 'error';
            console.error(`Error locating finished file:`, e);
          }
        } else {
          downloads[downloadId].status = 'error';
          console.error(`yt-dlp exited with code ${code}`);
        }
      });

    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: err.message }));
      }
    }
    return;
  }

  // API: Browse for file using native OS dialog (Windows PowerShell)
  if (pathname === '/api/browse-file') {
    const psCommand = `
      Add-Type -AssemblyName System.Windows.Forms;
      $f = New-Object System.Windows.Forms.OpenFileDialog;
      $f.Filter = 'Video files (*.mp4;*.webm;*.ogg;*.mkv;*.avi)|*.mp4;*.webm;*.ogg;*.mkv;*.avi|All files (*.*)|*.*';
      $f.Title = 'Select a Video File';
      if($f.ShowDialog() -eq 'OK'){
          Write-Output $f.FileName
      }
    `;
    
    // We must run it without a hidden window so the dialog actually shows
    const child = spawn('powershell', ['-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-Command', psCommand]);
    
    let resultPath = '';
    child.stdout.on('data', (data) => {
      resultPath += data.toString();
    });

    child.on('close', (code) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ path: resultPath.trim() }));
    });
    return;
  }

  // API: Cut Video job
  if (pathname === '/api/cut-video') {
    const sourcePath = parsedUrl.query.sourcePath;
    const start = parsedUrl.query.start;
    const end = parsedUrl.query.end;
    const outputFilename = parsedUrl.query.outputFilename || 'cut_video';

    if (!sourcePath || !start || !end) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'sourcePath, start, and end are required' }));
    }

    try {
      await ensureFfmpeg();

      const jobId = 'cut_' + Date.now();
      const ext = path.extname(sourcePath) || '.mp4';
      const outputFilePath = path.join(TEMP_DIR, `${jobId}${ext}`);

      downloads[jobId] = {
        percent: 0,
        status: 'downloading', // reuse same states so frontend progress works seamlessly
        filePath: '',
        filename: '',
        userTitle: outputFilename
      };

      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ downloadId: jobId }));

      // Convert HH:MM:SS to seconds for percentage calculation
      let duration = 0;
      try {
        const getSecs = (str) => {
          const parts = str.split(':').map(Number);
          if (parts.length === 3) return parts[0]*3600 + parts[1]*60 + parts[2];
          if (parts.length === 2) return parts[0]*60 + parts[1];
          return Number(str);
        };
        duration = getSecs(end) - getSecs(start);
      } catch (e) {}

      const args = [
        '-i', sourcePath,
        '-ss', start,
        '-to', end,
        '-c', 'copy',
        '-y',
        outputFilePath
      ];

      console.log(`Spawning ffmpeg for cut job:`, args);
      const child = spawn(FFMPEG_PATH, args);

      child.stderr.on('data', (data) => {
        const text = data.toString();
        // ffmpeg progress is sent to stderr
        const timeMatch = text.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d+)/);
        if (timeMatch && duration > 0) {
          const t = Number(timeMatch[1])*3600 + Number(timeMatch[2])*60 + Number(timeMatch[3]);
          let p = (t / duration) * 100;
          if (p > 100) p = 100;
          if (p > downloads[jobId].percent) {
             downloads[jobId].percent = p;
          }
        }
      });

      child.on('close', (code) => {
        if (code === 0 && fs.existsSync(outputFilePath)) {
           const cleanTitle = downloads[jobId].userTitle.replace(/[\\/*?:"<>|]/g, "_");
           downloads[jobId].status = 'ready';
           downloads[jobId].percent = 100;
           downloads[jobId].filePath = outputFilePath;
           downloads[jobId].filename = `${cleanTitle}${ext}`;
           console.log(`Cut job ${jobId} completed successfully.`);
        } else {
           downloads[jobId].status = 'error';
           console.error(`ffmpeg cut exited with code ${code}`);
        }
      });
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: err.message }));
      }
    }
    return;
  }

  // API: Get download job status
  if (pathname === '/api/progress') {
    const id = parsedUrl.query.id;
    const download = downloads[id];

    if (!download) {
      res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ error: 'Download job not found' }));
    }

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({
      status: download.status,
      percent: download.percent,
      filename: download.filename
    }));
    return;
  }

  // API: Stream the completed file
  if (pathname === '/api/get-file') {
    const id = parsedUrl.query.id;
    const download = downloads[id];

    if (!download || download.status !== 'ready' || !download.filePath || !fs.existsSync(download.filePath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
      return res.end('File not ready or not found');
    }

    try {
      const stat = fs.statSync(download.filePath);
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': stat.size,
        'Access-Control-Allow-Origin': '*',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(download.filename)}`
      });

      const fileStream = fs.createReadStream(download.filePath);
      fileStream.pipe(res);

      fileStream.on('close', () => {
        // Schedule cleanup after 2 minutes so repeated requests or retries succeed
        setTimeout(() => {
          if (download && download.filePath && fs.existsSync(download.filePath)) {
            fs.unlink(download.filePath, () => {});
          }
          delete downloads[id];
        }, 120000);
      });
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Error reading file: ' + err.message);
      }
    }
    return;
  }

  // Static files server
  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.access(filePath, fs.constants.F_OK, (err) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }

    fs.readFile(filePath, (error, content) => {
      if (error) {
        res.writeHead(500);
        res.end('500 Internal Server Error');
      } else {
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content, 'utf-8');
      }
    });
  });
});

server.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
  // Automatically open browser on startup
  exec(`start http://localhost:${PORT}`);
});
