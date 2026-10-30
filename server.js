const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const url = require('url');

const PORT = Number(process.env.PORT) || 3000;
const SALT = '8IAcbWyCsVhYv82S2eofRqK1DF3nNDAv&';
const API_BASE = 'https://apiv2.free-reels.com';
const FIREBASE_ID = '8d8531095094f6794fedbb722eb35921';
const APP_NAME = 'com.freereels.app';
const APP_VERSION = '2.3.60';

let cachedToken = null;
let tokenExpiresAt = 0;

function createSignature(secret) {
    return crypto.createHash('md5').update(SALT + secret).digest('hex');
}

async function getAuthToken() {
    if (cachedToken && Date.now() < tokenExpiresAt) {
        return cachedToken;
    }
    const deviceId = crypto.randomUUID();
    const sign = createSignature(deviceId);

    const res = await fetch(`${API_BASE}/frv2-api/anonymous/login`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'app-name': APP_NAME,
            'app-version': APP_VERSION,
            'firebase-id': FIREBASE_ID,
            'device': 'android'
        },
        body: JSON.stringify({
            device_id: deviceId,
            device_name: 'Web-Client',
            sign: sign
        })
    });

    const json = await res.json();
    if (json.code === 200 && json.data) {
        const authKey = json.data.auth_key;
        const authSecret = json.data.auth_secret;
        const authSig = createSignature(authSecret);
        cachedToken = `oauth_signature=${authSig},oauth_token=${authKey},ts=${Date.now()}`;
        tokenExpiresAt = Date.now() + 1000 * 60 * 60; // 1 hour
        return cachedToken;
    }
    throw new Error('Anonymous login failed: ' + JSON.stringify(json));
}

async function apiFetch(path, body = null, method = 'GET', lang = 'vi-VN') {
    const token = await getAuthToken();
    const country = lang.includes('en') ? 'US' : 'VN';
    const options = {
        method: method,
        headers: {
            'Authorization': token,
            'app-name': APP_NAME,
            'app-version': APP_VERSION,
            'firebase-id': FIREBASE_ID,
            'device': 'android',
            'country': country,
            'language': lang,
            'Content-Type': 'application/json'
        }
    };
    if (body) {
        options.body = JSON.stringify(body);
    }
    const res = await fetch(`${API_BASE}${path}`, options);
    return await res.json();
}

function findBoxes(buf) {
    const boxes = [];
    let off = 0;
    while (off + 8 <= buf.length) {
        const size = buf.readUInt32BE(off);
        const type = buf.toString('ascii', off + 4, off + 8);
        if (size < 8 || off + size > buf.length) break;
        boxes.push({ type, data: buf.subarray(off, off + size), body: buf.subarray(off + 8, off + size) });
        off += size;
    }
    return boxes;
}

function findBox(buf, type) {
    return findBoxes(buf).find(b => b.type === type) || null;
}

function makeBox(type, payloads) {
    const total = 8 + payloads.reduce((s, p) => s + p.length, 0);
    const out = Buffer.allocUnsafe(total);
    out.writeUInt32BE(total, 0);
    out.write(type, 4, 4, 'ascii');
    let pos = 8;
    for (const p of payloads) {
        p.copy(out, pos);
        pos += p.length;
    }
    return out;
}

function patchTrackIdInInit(initBuf, newTrackId) {
    const b = Buffer.from(initBuf);
    const moov = findBox(b, 'moov');
    const trak = findBox(moov.body, 'trak');
    const tkhd = findBox(trak.body, 'tkhd');
    tkhd.body.writeUInt32BE(newTrackId, tkhd.body[0] === 1 ? 20 : 12);
    const mvex = findBox(moov.body, 'mvex');
    const trex = findBox(mvex.body, 'trex');
    trex.body.writeUInt32BE(newTrackId, 4);
    return { trak: trak.data, trex: trex.data };
}

function patchSegment(segBuf, newTrackId, seqRef) {
    const b = Buffer.from(segBuf);
    for (const box of findBoxes(b)) {
        if (box.type === 'moof') {
            const mfhd = findBox(box.body, 'mfhd');
            if (mfhd) mfhd.body.writeUInt32BE(seqRef.seq++, 4);
            for (const child of findBoxes(box.body)) {
                if (child.type === 'traf') {
                    const tfhd = findBox(child.body, 'tfhd');
                    if (tfhd) tfhd.body.writeUInt32BE(newTrackId, 4);
                }
            }
        }
    }
    return b;
}

function parseMediaM3u8(text, baseUrl) {
    let initUrl = null;
    const segments = [];
    for (const rawLine of text.split('\n')) {
        const line = rawLine.trim();
        if (!line) continue;
        if (line.startsWith('#EXT-X-MAP:')) {
            const m = line.match(/URI="([^"]+)"/);
            if (m) initUrl = new URL(m[1], baseUrl).href;
        } else if (!line.startsWith('#')) {
            segments.push(new URL(line, baseUrl).href);
        }
    }
    return { initUrl, segments };
}

async function fetchBuffer(targetUrl) {
    const r = await fetch(targetUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Accept': '*/*' }
    });
    if (!r.ok) throw new Error(`Fetch failed (${r.status}): ${targetUrl}`);
    return Buffer.from(await r.arrayBuffer());
}

async function streamM3u8AsMp4(masterUrl, filename, audioParam, res) {
    const masterText = (await fetchBuffer(masterUrl)).toString('utf8');
    const lines = masterText.split('\n').map(l => l.trim()).filter(Boolean);
    const audioTracks = [];
    const variants = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith('#EXT-X-MEDIA:') && line.includes('TYPE=AUDIO')) {
            const uriMatch = line.match(/URI="([^"]+)"/);
            const nameMatch = line.match(/NAME="([^"]+)"/);
            if (uriMatch) {
                audioTracks.push({
                    uri: new URL(uriMatch[1], masterUrl).href,
                    name: nameMatch ? nameMatch[1] : '',
                    isDefault: line.includes('DEFAULT=YES') || line.includes('AUTOSELECT=YES')
                });
            }
        } else if (line.startsWith('#EXT-X-STREAM-INF:')) {
            const bwMatch = line.match(/BANDWIDTH=(\d+)/);
            const bw = bwMatch ? parseInt(bwMatch[1], 10) : 0;
            if (i + 1 < lines.length && !lines[i + 1].startsWith('#')) {
                variants.push({ bw, uri: new URL(lines[i + 1], masterUrl).href });
                i++;
            }
        }
    }

    variants.sort((a, b) => b.bw - a.bw);
    const videoPlaylistUrl = variants.length > 0 ? variants[0].uri : masterUrl;

    let selectedAudio = null;
    if (audioTracks.length > 0) {
        const idx = audioParam !== null ? parseInt(audioParam, 10) : NaN;
        if (!isNaN(idx) && audioTracks[idx]) {
            selectedAudio = audioTracks[idx];
        } else if (audioParam) {
            selectedAudio = audioTracks.find(a => a.name === audioParam);
        }
        if (!selectedAudio) {
            selectedAudio = audioTracks.find(a => a.isDefault) || audioTracks[0];
        }
    }

    const vText = variants.length > 0 ? (await fetchBuffer(videoPlaylistUrl)).toString('utf8') : masterText;
    const vMedia = parseMediaM3u8(vText, videoPlaylistUrl);
    const aMedia = selectedAudio
        ? parseMediaM3u8((await fetchBuffer(selectedAudio.uri)).toString('utf8'), selectedAudio.uri)
        : null;

    const [vInit, aInit] = await Promise.all([
        vMedia.initUrl ? fetchBuffer(vMedia.initUrl) : null,
        aMedia && aMedia.initUrl ? fetchBuffer(aMedia.initUrl) : null
    ]);

    res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Access-Control-Allow-Origin': '*'
    });

    if (vInit && aInit) {
        const ftyp = findBox(vInit, 'ftyp').data;
        const vMoov = findBox(vInit, 'moov');
        const mvhd = Buffer.from(findBox(vMoov.body, 'mvhd').data);
        mvhd.writeUInt32BE(3, mvhd.length - 4);
        const vTrak = findBox(vMoov.body, 'trak').data;
        const vMvex = findBox(vMoov.body, 'mvex');
        const vMehd = findBox(vMvex.body, 'mehd');
        if (vMehd && mvhd[8] === 0 && vMehd.body[0] === 0) {
            mvhd.writeUInt32BE(vMehd.body.readUInt32BE(4), 24);
        }
        const vTrex = findBox(vMvex.body, 'trex').data;
        const { trak: aTrak, trex: aTrex } = patchTrackIdInInit(aInit, 2);
        const newMvex = makeBox('mvex', vMehd ? [vMehd.data, vTrex, aTrex] : [vTrex, aTrex]);
        const newMoov = makeBox('moov', [mvhd, vTrak, aTrak, newMvex]);
        res.write(Buffer.concat([ftyp, newMoov]));
    } else if (vInit) {
        res.write(vInit);
    }

    const seqRef = { seq: 1 };
    const vSegs = vMedia.segments;
    const aSegs = aMedia ? aMedia.segments : [];
    const maxLen = Math.max(vSegs.length, aSegs.length);

    for (let i = 0; i < maxLen; i += 6) {
        const batch = [];
        for (let j = i; j < Math.min(i + 6, maxLen); j++) {
            batch.push(Promise.all([
                vSegs[j] ? fetchBuffer(vSegs[j]) : null,
                aSegs[j] ? fetchBuffer(aSegs[j]) : null
            ]));
        }
        const results = await Promise.all(batch);
        for (const [vSeg, aSeg] of results) {
            if (vSeg) res.write(aInit ? patchSegment(vSeg, 1, seqRef) : vSeg);
            if (aSeg) res.write(patchSegment(aSeg, 2, seqRef));
        }
    }
    res.end();
}

const server = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    const pathname = parsedUrl.pathname;
    const lang = parsedUrl.searchParams.get('lang') || 'vi-VN';

    try {
        if (pathname === '/' || pathname === '/index.html' || pathname === '/player.html') {
            const htmlPath = path.join(__dirname, 'player.html');
            if (fs.existsSync(htmlPath)) {
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                fs.createReadStream(htmlPath).pipe(res);
                return;
            }
        }

        // Swagger UI & Swagger JSON documentation
        if (pathname === '/swagger' || pathname === '/swagger.html' || pathname === '/docs') {
            const swaggerHtmlPath = path.join(__dirname, 'swagger.html');
            if (fs.existsSync(swaggerHtmlPath)) {
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                fs.createReadStream(swaggerHtmlPath).pipe(res);
                return;
            }
        }

        if (pathname === '/swagger.json') {
            const swaggerJsonPath = path.join(__dirname, 'swagger.json');
            if (fs.existsSync(swaggerJsonPath)) {
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                fs.createReadStream(swaggerJsonPath).pipe(res);
                return;
            }
        }

        // Hướng dẫn sử dụng API (API Guide Markdown & Rendered HTML)
        if (pathname === '/guide' || pathname === '/api-docs' || pathname === '/api-guide' || pathname === '/API_DOCUMENTATION.md') {
            const docPath = path.join(__dirname, 'API_DOCUMENTATION.md');
            if (fs.existsSync(docPath)) {
                const mdContent = fs.readFileSync(docPath, 'utf8');
                if (parsedUrl.searchParams.get('raw') === '1') {
                    res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
                    res.end(mdContent);
                    return;
                }
                const htmlWrapper = `<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Hướng Dẫn Sử Dụng API - Drama Streaming Service</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/github-markdown-css/5.5.0/github-markdown-dark.min.css">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css">
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
    <style>
        body {
            background-color: #0d1117;
            color: #c9d1d9;
            margin: 0;
            padding: 24px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        }
        .container {
            max-width: 960px;
            margin: 0 auto;
            background: #161b22;
            padding: 32px 48px;
            border-radius: 12px;
            border: 1px solid #30363d;
            box-shadow: 0 8px 24px rgba(0,0,0,0.5);
        }
        .top-bar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 24px;
            padding-bottom: 16px;
            border-bottom: 1px solid #30363d;
            flex-wrap: wrap;
            gap: 12px;
        }
        .btn-nav {
            display: inline-block;
            background: #238636;
            color: #fff;
            padding: 8px 16px;
            border-radius: 6px;
            text-decoration: none;
            font-weight: 600;
            font-size: 14px;
            margin-right: 8px;
        }
        .btn-nav:hover { background: #2ea043; }
        .btn-secondary { background: #21262d; border: 1px solid #30363d; color: #c9d1d9; }
        .btn-secondary:hover { background: #30363d; }
    </style>
</head>
<body>
    <div class="container">
        <div class="top-bar">
            <div>
                <a href="/" class="btn-nav btn-secondary">🏠 Web Player</a>
                <a href="/swagger" class="btn-nav btn-secondary">📑 Swagger UI</a>
            </div>
            <div>
                <a href="/API_DOCUMENTATION.md?raw=1" class="btn-nav">⬇️ Tải File .MD Thô</a>
            </div>
        </div>
        <div id="content" class="markdown-body"></div>
    </div>
    <script id="rawMarkdown" type="text/plain">${mdContent.replace(/<\/script>/g, '<\\/script>')}</script>
    <script>
        const raw = document.getElementById('rawMarkdown').textContent;
        document.getElementById('content').innerHTML = marked.parse(raw);
        hljs.highlightAll();
    </script>
</body>
</html>`;
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(htmlWrapper);
                return;
            }
        }

        // API: Tải file về máy với Content-Disposition đính kèm
        if (pathname === '/api/download') {
            const targetUrl = parsedUrl.searchParams.get('url');
            const filename = parsedUrl.searchParams.get('filename') || 'video.mp4';
            const audioParam = parsedUrl.searchParams.get('audio');
            if (!targetUrl) {
                res.writeHead(400);
                res.end('Missing url');
                return;
            }
            if (targetUrl.includes('.m3u8')) {
                const mp4Name = filename.endsWith('.mp4') ? filename : filename.replace(/\.m3u8$/i, '') + '.mp4';
                await streamM3u8AsMp4(targetUrl, mp4Name, audioParam, res);
                return;
            }
            const fetchRes = await fetch(targetUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                    'Accept': '*/*'
                }
            });
            if (!fetchRes.ok) {
                res.writeHead(fetchRes.status);
                res.end('Download fetch error');
                return;
            }
            const contentType = fetchRes.headers.get('content-type') || 'application/octet-stream';
            res.writeHead(200, {
                'Content-Type': contentType,
                'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
                'Access-Control-Allow-Origin': '*'
            });
            const arrayBuffer = await fetchRes.arrayBuffer();
            res.end(Buffer.from(arrayBuffer));
            return;
        }

        // API: Danh mục / Tabs thể loại
        if (pathname === '/api/tabs') {
            const data = await apiFetch('/frv2-api/homepage/v3/tab/list', null, 'GET', lang);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(data));
            return;
        }

        // API: Danh sách phim theo Tab Index
        if (pathname === '/api/tab-index') {
            const tabKey = parsedUrl.searchParams.get('tab_key') || '503';
            const pos = parsedUrl.searchParams.get('pos') || '10000';
            const data = await apiFetch(`/frv2-api/homepage/v2/tab/index?tab_key=${tabKey}&position_index=${pos}&rec_trigger=1&user_new_theater=false`, null, 'GET', lang);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(data));
            return;
        }

        // API: Feed cuộn thêm phim
        if (pathname === '/api/feed') {
            const moduleKey = parsedUrl.searchParams.get('module_key') || '1036';
            const next = parsedUrl.searchParams.get('next') || '';
            const data = await apiFetch('/frv2-api/homepage/v2/tab/feed', { module_key: moduleKey, next: next, rec_trigger: 1 }, 'POST', lang);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(data));
            return;
        }

        // API: Bảng xếp hạng phim (Top Rank)
        if (pathname === '/api/rank') {
            const page = parseInt(parsedUrl.searchParams.get('page') || '1');
            const data = await apiFetch('/frv2-api/homepage/v2/rank', { page: page, page_size: 20 }, 'POST', lang);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(data));
            return;
        }

        // API: Danh sách phim hot (Hot List)
        if (pathname === '/api/hot-list') {
            const page = parseInt(parsedUrl.searchParams.get('page') || '1');
            const data = await apiFetch('/frv2-api/search/hot-list-v2', { page: page, page_size: 30 }, 'POST', lang);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(data));
            return;
        }

        // API: Tìm kiếm phim
        if (pathname === '/api/search') {
            const keyword = parsedUrl.searchParams.get('q') || '';
            const next = parsedUrl.searchParams.get('next') || '';
            const data = await apiFetch('/frv2-api/search/drama', { keyword: keyword, next: next }, 'POST', lang);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(data));
            return;
        }

        // API: Chi tiết phim & danh sách tập
        if (pathname === '/api/drama') {
            const seriesId = parsedUrl.searchParams.get('id');
            if (!seriesId) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Missing series id' }));
                return;
            }
            const data = await apiFetch(`/frv2-api/drama/info_v2?series_id=${encodeURIComponent(seriesId)}`, null, 'GET', lang);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(data));
            return;
        }

        // PROXY: Stream M3U8, TS video chunks, audio chunks, and VTT subtitles with CORS enabled
        if (pathname === '/proxy') {
            const targetUrl = parsedUrl.searchParams.get('url');
            if (!targetUrl) {
                res.writeHead(400);
                res.end('Missing url param');
                return;
            }

            const parsedTarget = new URL(targetUrl);
            const isM3U8 = parsedTarget.pathname.endsWith('.m3u8') || targetUrl.includes('.m3u8');

            const fetchRes = await fetch(targetUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                    'Accept': '*/*'
                }
            });

            if (!fetchRes.ok) {
                res.writeHead(fetchRes.status);
                res.end(`Proxy error: ${fetchRes.statusText}`);
                return;
            }

            if (isM3U8) {
                const text = await fetchRes.text();
                const targetBase = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);

                // Rewrite relative URIs inside m3u8 playlist to route back to /proxy
                const rewritten = text
                    .split('\n')
                    .map(line => {
                        const trimmed = line.trim();
                        if (!trimmed) return line;

                        // Check for URI="child.m3u8" inside tags like #EXT-X-MEDIA:TYPE=AUDIO...
                        let modified = line.replace(/URI="([^"]+)"/g, (match, relUri) => {
                            const full = new URL(relUri, targetBase).href;
                            return `URI="/proxy?url=${encodeURIComponent(full)}"`;
                        });

                        // If line does not start with #, it is a segment or sub-playlist URL
                        if (!trimmed.startsWith('#')) {
                            const full = new URL(trimmed, targetBase).href;
                            return `/proxy?url=${encodeURIComponent(full)}`;
                        }

                        return modified;
                    })
                    .join('\n');

                res.writeHead(200, {
                    'Content-Type': 'application/vnd.apple.mpegurl',
                    'Access-Control-Allow-Origin': '*'
                });
                res.end(rewritten);
                return;
            } else {
                // For video segments (.ts, .aac, .vtt)
                const contentType = fetchRes.headers.get('content-type') || 'application/octet-stream';
                res.writeHead(200, {
                    'Content-Type': contentType,
                    'Access-Control-Allow-Origin': '*'
                });
                const arrayBuffer = await fetchRes.arrayBuffer();
                res.end(Buffer.from(arrayBuffer));
                return;
            }
        }

        res.writeHead(404);
        res.end('Not found');
    } catch (err) {
        console.error('Server error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
    }
});

function getLanUrls(port) {
    const nets = os.networkInterfaces();
    const urls = [];
    for (const items of Object.values(nets)) {
        for (const net of items || []) {
            if (net.family === 'IPv4' && !net.internal) {
                urls.push(`http://${net.address}:${port}`);
            }
        }
    }
    return urls;
}

server.listen(PORT, '0.0.0.0', () => {
    console.log(`====================================================`);
    console.log(`🎬 ReelSnap Web Player Server running at:`);
    console.log(`👉 Local:   http://localhost:${PORT}`);
    for (const lanUrl of getLanUrls(PORT)) {
        console.log(`👉 Network: ${lanUrl}`);
    }
    console.log(`====================================================`);
});
