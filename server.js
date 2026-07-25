const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data_store.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// الأوزان بالجرام
const WEIGHT_MAP = {
  "تولة": 12,
  "أوقية": 28,
  "ثمن": 125,
  "ربع": 250,
  "نصف": 500,
  "كيلو": 1000
};

// تحميل البيانات
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Error reading data file:', e);
  }
  return {
    sallaAccessToken: '',
    merchantId: '',
    products: {}
  };
}

function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving data file:', e);
  }
}

// الاتصال بمنصة سلة Salla API v2
function callSallaApi(endpoint, method = 'GET', postData = null, accessToken = '') {
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.salla.dev',
      port: 443,
      path: `/admin/v2${endpoint}`,
      method: method,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        'Accept': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      timeout: 12000
    };

    let bodyData = null;
    if (postData) {
      bodyData = JSON.stringify(postData);
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(bodyData);
    }

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(body); } catch (e) { parsed = body; }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ ok: true, status: res.statusCode, data: parsed });
        } else {
          console.error(`[Salla API Error] ${endpoint} Status: ${res.statusCode}`, body);
          resolve({ ok: false, status: res.statusCode, error: parsed });
        }
      });
    });

    req.on('error', (err) => {
      console.error(`[Salla Network Error] ${endpoint}:`, err.message);
      resolve({ ok: false, status: 0, error: err.message });
    });

    req.on('timeout', () => {
      req.destroy();
      console.error(`[Salla Timeout] ${endpoint}`);
      resolve({ ok: false, status: 408, error: 'Request Timeout' });
    });

    if (bodyData) req.write(bodyData);
    req.end();
  });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

const server = http.createServer(async (req, res) => {
  const urlParts = req.url.split('?')[0];

  // Helper JSON response
  const sendJson = (statusCode, obj) => {
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  };

  // API Endpoints
  if (urlParts === '/api/settings') {
    if (req.method === 'GET') {
      const store = loadData();
      return sendJson(200, {
        sallaAccessToken: store.sallaAccessToken || '',
        merchantId: store.merchantId || ''
      });
    } else if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const payload = JSON.parse(body);
          const store = loadData();
          if (payload.sallaAccessToken !== undefined) store.sallaAccessToken = payload.sallaAccessToken.trim();
          if (payload.merchantId !== undefined) store.merchantId = payload.merchantId.trim();
          saveData(store);
          return sendJson(200, { ok: true, message: 'تم حفظ إعدادات سلة بنجاح' });
        } catch (e) {
          return sendJson(400, { ok: false, error: 'بيانات غير صالحة' });
        }
      });
      return;
    }
  }

  if (urlParts === '/api/salla/products' && req.method === 'GET') {
    const store = loadData();
    if (!store.sallaAccessToken) {
      return sendJson(400, { ok: false, error: 'يرجى حفظ رمز الوصول (Salla Access Token) أولاً' });
    }
    const response = await callSallaApi('/products', 'GET', null, store.sallaAccessToken);
    if (response.ok) {
      return sendJson(200, { ok: true, data: response.data.data });
    } else {
      return sendJson(response.status || 500, { ok: false, error: response.error });
    }
  }

  // Webhook Receiver
  if (urlParts === '/api/salla/webhook' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      console.log('[Salla Webhook Event Received]');
      return sendJson(200, { success: true });
    });
    return;
  }

  // Serve static files
  let filePath = path.join(PUBLIC_DIR, urlParts === '/' ? 'index.html' : urlParts);
  const extname = path.extname(filePath);
  let contentType = MIME_TYPES[extname] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`Server Error: ${err.code}`);
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 خادم مزامنة أوزان سلة تعمل بنجاح (بدون مكتبات خارجية) على البورت: ${PORT}`);
  console.log(`دراسة وتصميم: عمر بن حسن العدوي غفر الله له ولأهله`);
  console.log(`====================================================`);
});
