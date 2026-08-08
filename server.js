const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data_store.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// الأوزان بالجرام للخيارات
const WEIGHT_MAP = {
  "تولة": 12,
  "أوقية": 28,
  "ثمن": 125,
  "ربع": 250,
  "نصف": 500,
  "كيلو": 1000
};

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
    googleSheetUrl: '',
    products: {
      "تايجر": 40000,
      "دقة": 2000,
      "مروكي": 5000
    },
    logs: []
  };
}

function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving data file:', e);
  }
}

// الاتصال بـ Salla API v2
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
          resolve({ ok: false, status: res.statusCode, error: parsed });
        }
      });
    });

    req.on('error', (err) => resolve({ ok: false, status: 0, error: err.message }));
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
        merchantId: store.merchantId || '',
        googleSheetUrl: store.googleSheetUrl || '',
        products: store.products || {},
        logs: store.logs || []
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
          if (payload.googleSheetUrl !== undefined) store.googleSheetUrl = payload.googleSheetUrl.trim();
          if (payload.products !== undefined) store.products = payload.products;
          saveData(store);
          return sendJson(200, { ok: true, message: 'تم حفظ إعدادات المنتجات والربط بنجاح' });
        } catch (e) {
          return sendJson(400, { ok: false, error: 'بيانات غير صالحة' });
        }
      });
      return;
    }
  }

  // Webhook Receiver من سلة لخصم وزن المنتج المحدد
  if (urlParts === '/api/salla/webhook') {
    if (req.method === 'GET') {
      return sendJson(200, { ok: true, message: 'Multi-Product Salla & Google Sheets Sync is Active' });
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const payload = JSON.parse(body);
          console.log('[Webhook Triggered]:', payload?.event);
          
          const store = loadData();
          if (payload.event === 'order.created' && payload.data?.items) {
            payload.data.items.forEach(item => {
              const name = item.name || '';
              // مطابقة اسم العود (تايجر، دقة، مروكي، إلخ)
              Object.keys(store.products).forEach(prodName => {
                if (name.includes(prodName)) {
                  let itemWeightGrams = 0;
                  for (const [wName, wGrams] of Object.entries(WEIGHT_MAP)) {
                    if (name.includes(wName)) {
                      itemWeightGrams = wGrams;
                      break;
                    }
                  }
                  if (itemWeightGrams > 0) {
                    const totalDeducted = itemWeightGrams * (item.quantity || 1);
                    store.products[prodName] = Math.max(0, store.products[prodName] - totalDeducted);
                    const logMsg = `تم خصم ${totalDeducted}g من عود (${prodName}) لطلب #${payload.data.id}. المتبقي: ${store.products[prodName]}g`;
                    store.logs.unshift({ timestamp: new Date().toISOString(), message: logMsg });
                  }
                }
              });
            });
            saveData(store);
          }
        } catch (e) {
          console.error('Webhook error:', e);
        }
        return sendJson(200, { success: true });
      });
      return;
    }
  }

  // Serve static UI
  let filePath = path.join(PUBLIC_DIR, urlParts === '/' ? 'index.html' : urlParts);
  const extname = path.extname(filePath);
  let contentType = MIME_TYPES[extname] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 خادم مزامنة منتجات العود المتعددة (تايجر، دقة، مروكي) يعمل بنجاح`);
  console.log(`دراسة وتصميم: عمر بن حسن العدوي غفر الله له ولأهله`);
  console.log(`====================================================`);
});
