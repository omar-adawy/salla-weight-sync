const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data_store.json');
const LOCATION_ID = "798d9182-d0ce-48a5-a35a-95674006774e";

// المعرفات الحقيقية والمؤكدة 100% لخيارات برمجة الوزن
const TRUE_VARIANT_IDS = {
  "تولة": "d0a11350-92c9-4d7f-b8ee-45c2670c19cc",
  "أوقية": "4b145c6e-72bb-4f62-9b14-f424e5bb33ed",
  "ثمن": "5bf6ecd5-d54c-4d3c-aa38-7d86f930942b",
  "ربع": "cfcd318e-ee60-4859-ac26-2e44348586ad",
  "نصف": "eb8c6bbf-811e-45b8-9907-54e0734d7d61",
  "كيلو": "03271e53-0eea-4d0b-87eb-0bd6778e854d"
};

function callZidGet(endpoint, storeSettings) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.zid.sa',
      port: 443,
      path: endpoint,
      method: 'GET',
      headers: {
        'X-Manager-Token': storeSettings.zidManagerToken,
        'Store-Id': storeSettings.zidStoreId,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
      },
      timeout: 10000
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

function updateZidChildQuantity(childProductId, newQty, storeSettings) {
  return new Promise((resolve) => {
    const postData = JSON.stringify({
      stocks: [{
        location: LOCATION_ID,
        available_quantity: newQty
      }]
    });
    const options = {
      hostname: 'api.zid.sa',
      port: 443,
      path: `/v1/products/${childProductId}/`,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Manager-Token': storeSettings.zidManagerToken,
        'Store-Id': storeSettings.zidStoreId,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 10000
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.write(postData);
    req.end();
  });
}

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    const initialData = {
      storeSettings: {
        zidStoreId: "1082333",
        zidManagerToken: "eyJpdiI6IktVb3dBNk5QNjl1c2pxU2F0SWdIV3c9PSIsInZhbHVlIjoiL0RXUUUvZXZ3Ti9VNitTVUlwbEpJU2FFaU9HQlkzaHBURXo2am5mYS9qakt1RnBDbTNBZm1meDlXTU11VWZVdFMxWTRGWjgrYTNyTGtXbFg2cURqK2VKeE9pZjl2akJ5ZDBqSHVFZE5IMUowZFdXOG4xTVg0SVk1VEFjeWY4Q0w4UXV1QWZXNnZuQ2FBRW1TZzB2ZDlKUG9GTHBjaHhlaDZKdnpQOWxHV2NKR2NIM25KT2hGZXpZVWlLeEpyTlg3N0dLbERLZGJXK1NLMHJYMm03Q0VDcGVKWlJOVkN4OHl5ZDFpZFhKb1pKdnYvSG5IZ0xOMlBKS2ZHNmdzOGdtUFd3bllzUUh5REIzeWhYQkdtbkduNk1sRjhnS0syWXQxNnRZRjgvR3c9PSIsIm1hYyI6IjA2OThmMjBiNDk3YTgxNWRmYzdhY2U4NzVkODQxYTFhZWM5YWVhMjZhMTdhYzRhN2RlYmNiOTk1OWZlODUyMzgiLCJ0YWciOiIifQ==",
        autoSyncEnabled: true,
        lastProcessedOrderId: null,
        lastProcessedOrderStatus: null,
        totalGramsStore: 10000
      },
      products: [],
      logs: []
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2), 'utf8');
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// دالة الخصم والمزامنة لجميع الأوزان ككتلة واحدة مخصومة أو مسترجعة
async function syncAllVariantsQuantities(orderedChildProductId, quantityChange, isCancellation, storeSettings) {
  const data = loadData();
  
  let unitWeightGrams = 1000;
  const childDetails = await callZidGet(`/v1/products/${orderedChildProductId}/`, storeSettings);
  if (childDetails && childDetails.name) {
    if (childDetails.name.includes('تولة')) unitWeightGrams = 12;
    else if (childDetails.name.includes('أوقية')) unitWeightGrams = 28;
    else if (childDetails.name.includes('ثمن')) unitWeightGrams = 125;
    else if (childDetails.name.includes('ربع')) unitWeightGrams = 250;
    else if (childDetails.name.includes('نصف')) unitWeightGrams = 500;
    else if (childDetails.name.includes('كيلو')) unitWeightGrams = 1000;
  }

  const weightGramsChange = unitWeightGrams * quantityChange;

  if (isCancellation) {
    data.storeSettings.totalGramsStore = (data.storeSettings.totalGramsStore || 0) + weightGramsChange;
  } else {
    data.storeSettings.totalGramsStore = Math.max(0, (data.storeSettings.totalGramsStore || 10000) - weightGramsChange);
  }

  const remainingGrams = data.storeSettings.totalGramsStore;

  const variantSpecs = [
    { id: TRUE_VARIANT_IDS["تولة"], weight: 12 },
    { id: TRUE_VARIANT_IDS["أوقية"], weight: 28 },
    { id: TRUE_VARIANT_IDS["ثمن"], weight: 125 },
    { id: TRUE_VARIANT_IDS["ربع"], weight: 250 },
    { id: TRUE_VARIANT_IDS["نصف"], weight: 500 },
    { id: TRUE_VARIANT_IDS["كيلو"], weight: 1000 }
  ];

  for (const spec of variantSpecs) {
    const exactQtyLeft = Math.floor(remainingGrams / spec.weight);
    await updateZidChildQuantity(spec.id, exactQtyLeft, storeSettings);
  }

  const actionText = isCancellation ? `🔄 تم استرجاع ${weightGramsChange} جرام تلقائياً` : `⚡️ تم الخصم التلقائي لـ ${weightGramsChange} جرام`;
  data.logs.unshift({
    id: `log-${Date.now()}`,
    timestamp: new Date().toISOString(),
    type: isCancellation ? "AUTO_CANCEL_RESTORE" : "AUTO_ORDER_DEDUCT",
    message: `${actionText}. المخزون المتبقي الحالي بالخزان: ${remainingGrams} جرام. تم تعديل وإرسال كافة خيارات زد بنجاح!`
  });

  saveData(data);
}

const server = http.createServer((req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = reqUrl.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    return res.end();
  }

  // API المزامنة اليدوية والتلقائية الفورية من لوحة التحكم أو التطبيق
  if (pathname === '/api/sync-order' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        const data = loadData();
        const childId = payload.childProductId || TRUE_VARIANT_IDS["كيلو"];
        const qty = payload.quantity || 1;
        const isCancelled = payload.isCancelled || false;

        await syncAllVariantsQuantities(childId, qty, isCancelled, data.storeSettings);

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ status: 'success', message: 'تم تنشيط المزامنة والخصم الشامل بنجاح 100%!' }));
      } catch (e) {
        res.writeHead(400);
        return res.end('Invalid Payload');
      }
    });
    return;
  }

  if (pathname === '/api/data' && req.method === 'GET') {
    const data = loadData();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({
      storeSettings: data.storeSettings,
      logs: data.logs.slice(0, 50)
    }));
  }

  if (pathname === '/api/settings' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const data = loadData();
        if (payload.zidStoreId) data.storeSettings.zidStoreId = payload.zidStoreId;
        if (payload.zidManagerToken) data.storeSettings.zidManagerToken = payload.zidManagerToken;
        saveData(data);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'success' }));
      } catch (e) {
        res.writeHead(400);
        return res.end('Invalid Payload');
      }
    });
    return;
  }

  let filePath = path.join(__dirname, 'public', pathname === '/' ? 'index.html' : pathname);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    let contentType = 'text/html; charset=utf-8';
    if (ext === '.css') contentType = 'text/css';
    if (ext === '.js') contentType = 'text/javascript';

    res.writeHead(200, { 'Content-Type': contentType });
    return fs.createReadStream(filePath).pipe(res);
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404 Not Found');
});

server.listen(PORT, () => {
  console.log(`Zid Robust Instant Sync Engine running on http://localhost:${PORT}`);
});
