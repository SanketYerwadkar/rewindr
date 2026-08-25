const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn, execFile } = require('child_process');
const urlModule = require('url');

const PORT = 3001;
const YTDLP_PATH = path.join(__dirname, 'yt-dlp.exe');

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

// Start ensuring yt-dlp is present right away
ensureYtDlp().catch(err => console.error("Error downloading yt-dlp:", err));

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

const { exec } = require('child_process');

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
      // Execute yt-dlp -J to get info in JSON format
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
          
          // Map and filter formats
          // We want formats that contain both video and audio, or audio-only
          const formats = (info.formats || []).map(f => {
            return {
              formatId: f.format_id,
              extension: f.ext,
              resolution: f.resolution || (f.width && f.height ? `${f.width}x${f.height}` : null) || f.format_note || 'unknown',
              filesize: f.filesize || f.filesize_approx || null,
              hasVideo: f.vcodec !== 'none',
              hasAudio: f.acodec !== 'none',
              fps: f.fps || null,
              note: f.format_note || ''
            };
          }).filter(f => f.hasVideo || f.hasAudio);

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

  // API: Download/Stream Video
  if (pathname === '/api/download') {
    const videoUrl = parsedUrl.query.url;
    const formatId = parsedUrl.query.formatId;

    if (!videoUrl || !formatId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'url and formatId parameters are required' }));
    }

    try {
      const ytdlp = await ensureYtDlp();
      
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Access-Control-Allow-Origin': '*',
        'Content-Disposition': 'attachment'
      });

      // Spawn yt-dlp to output to stdout (-)
      const child = spawn(ytdlp, ['-f', formatId, '-o', '-', videoUrl]);

      child.stdout.pipe(res);

      child.stderr.on('data', (data) => {
        // Log progress/errors silently on server
      });

      req.on('close', () => {
        child.kill();
      });

    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: err.message }));
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
