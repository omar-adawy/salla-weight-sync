const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data_store.json');
const DEFAULT_LOCATION_ID = "798d9182-d0ce-48a5-a35a-95674006774e";

// المعرفات الحقيقية والمؤكدة 100% لخيارات برمجة الوزن
const TRUE_VARIANT_IDS = {
  "تولة": "d0a11350-92c9-4d7f-b8ee-45c2670c19cc",
  "أوقية": "4b145c6e-72bb-4f62-9b14-f424e5bb33ed",
  "ثمن": "5bf6ecd5-d54c-4d3c-aa38-7d86f930942b",
  "ربع": "cfcd318e-ee60-4859-ac26-2e44348586ad",
  "نصف": "eb8c6bbf-811e-45b8-9907-54e0734d7d61",
  "كيلو": "03271e53-0eea-4d0b-87eb-0bd6778e854d"
};

function buildZidHeaders(storeSettings) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    'Accept': 'application/json',
    'Accept-Language': 'ar'
  };
  if (storeSettings.zidManagerToken) {
    headers['X-Manager-Token'] = storeSettings.zidManagerToken;
  }
  if (storeSettings.zidStoreId) {
    headers['Store-Id'] = storeSettings.zidStoreId;
  }
  if (storeSettings.zidAuthorizationToken) {
    headers['Authorization'] = storeSettings.zidAuthorizationToken.startsWith('Bearer ')
      ? storeSettings.zidAuthorizationToken
      : `Bearer ${storeSettings.zidAuthorizationToken}`;
  }
  return headers;
}

function callZidGet(endpoint, storeSettings) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.zid.sa',
      port: 443,
      path: endpoint,
      method: 'GET',
      headers: buildZidHeaders(storeSettings),
      timeout: 12000
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(body); } catch (e) { parsed = body; }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ ok: true, status: res.statusCode, data: parsed });
        } else {
          console.error(`[Zid GET Error] ${endpoint} Status: ${res.statusCode}`, body);
          resolve({ ok: false, status: res.statusCode, error: parsed });
        }
      });
    });
    req.on('error', (err) => {
      console.error(`[Zid GET Network Error] ${endpoint}:`, err.message);
      resolve({ ok: false, status: 0, error: err.message });
    });
    req.on('timeout', () => {
      req.destroy();
      console.error(`[Zid GET Timeout] ${endpoint}`);
      resolve({ ok: false, status: 408, error: 'Request Timeout' });
    });
    req.end();
  });
}

function updateZidChildQuantity(childProductId, newQty, storeSettings) {
  return new Promise((resolve) => {
    const locationId = storeSettings.locationId || DEFAULT_LOCATION_ID;
    const postData = JSON.stringify({
      stocks: [{
        location: locationId,
        available_quantity: newQty
      }]
    });
    const headers = buildZidHeaders(storeSettings);
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(postData);

    const options = {
      hostname: 'api.zid.sa',
      port: 443,
      path: `/v1/products/${childProductId}/`,
      method: 'PATCH',
      headers: headers,
      timeout: 12000
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(body); } catch (e) { parsed = body; }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ ok: true, status: res.statusCode, data: parsed });
        } else {
          console.error(`[Zid Stock Update Error] Product: ${childProductId} Status: ${res.statusCode}`, body);
          resolve({ ok: false, status: res.statusCode, error: parsed });
        }
      });
    });

    req.on('error', (err) => {
      console.error(`[Zid Stock Network Error] Product: ${childProductId}:`, err.message);
      resolve({ ok: false, status: 0, error: err.message });
    });

    req.on('timeout', () => {
      req.destroy();
      console.error(`[Zid Stock Timeout] Product: ${childProductId}`);
      resolve({ ok: false, status: 408, error: 'Request Timeout' });
    });

    req.write(postData);
    req.end();
  });
}

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    const initialData = {
      storeSettings: {
        zidStoreId: "1082333",
        zidManagerToken: "",
        zidAuthorizationToken: "",
        locationId: DEFAULT_LOCATION_ID,
        autoSyncEnabled: true,
        totalGramsStore: 10000,
        processedOrderIds: []
      },
      products: [],
      logs: []
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2), 'utf8');
  }
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  if (!data.storeSettings.processedOrderIds) {
    data.storeSettings.processedOrderIds = [];
  }
  if (!data.storeSettings.locationId) {
    data.storeSettings.locationId = DEFAULT_LOCATION_ID;
  }
  return data;
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// دالة التعرف على وزن وحدة الصنف بالجرام
function detectUnitWeightGrams(name) {
  if (!name || typeof name !== 'string') return null;
  const n = name.trim();

  if (n.includes('نصف كيلو') || n.includes('نص كيلو') || n.includes('1/2 كيلو')) return 500;
  if (n.includes('ربع كيلو') || n.includes('1/4 كيلو')) return 250;
  if (n.includes('ثمن كيلو') || n.includes('1/8 كيلو')) return 125;
  if (n.includes('نصف أوقية') || n.includes('نصف وقية') || n.includes('نص أوقية')) return 14;
  if (n.includes('ربع أوقية') || n.includes('ربع وقية')) return 7;
  if (n.includes('أوقية') || n.includes('وقية') || n.includes('واقية')) return 28;
  if (n.includes('تولة') || n.includes('توله')) return 12;
  if (n.includes('كيلو')) return 1000;
  if (n.includes('ثمن')) return 125;
  if (n.includes('ربع')) return 250;
  if (n.includes('نصف') || n.includes('نص')) return 500;

  return null;
}

// دالة التحديث والمزامنة الشاملة لجميع خيارات الوزن
async function syncAllVariantsQuantities(productsList, isCancellation, storeSettings, orderId = null) {
  const data = loadData();
  let totalOrderGrams = 0;
  const itemsProcessed = [];

  for (const item of productsList) {
    let unitWeight = null;
    let productName = item.name || '';

    if (!productName && item.id) {
      const details = await callZidGet(`/v1/products/${item.id}/`, storeSettings);
      if (details.ok && details.data && details.data.name) {
        productName = details.data.name;
      }
    }

    unitWeight = detectUnitWeightGrams(productName);

    if (!unitWeight) {
      console.warn(`[Warning] Could not resolve unit weight for product "${productName}" (ID: ${item.id}). Defaulting to 0g deduction to prevent stock corruption.`);
      itemsProcessed.push({ name: productName || item.id, qty: item.quantity || 1, grams: 0, status: 'UNRESOLVED_WEIGHT' });
      continue;
    }

    const qty = item.quantity || 1;
    const itemGrams = unitWeight * qty;
    totalOrderGrams += itemGrams;
    itemsProcessed.push({ name: productName, qty: qty, grams: itemGrams, unitWeight: unitWeight, status: 'SUCCESS' });
  }

  if (totalOrderGrams > 0) {
    if (isCancellation) {
      data.storeSettings.totalGramsStore = (data.storeSettings.totalGramsStore || 0) + totalOrderGrams;
    } else {
      data.storeSettings.totalGramsStore = Math.max(0, (data.storeSettings.totalGramsStore || 10000) - totalOrderGrams);
    }
  }

  const remainingGrams = data.storeSettings.totalGramsStore;

  const variantSpecs = [
    { name: "تولة", id: TRUE_VARIANT_IDS["تولة"], weight: 12 },
    { name: "أوقية", id: TRUE_VARIANT_IDS["أوقية"], weight: 28 },
    { name: "ثمن", id: TRUE_VARIANT_IDS["ثمن"], weight: 125 },
    { name: "ربع", id: TRUE_VARIANT_IDS["ربع"], weight: 250 },
    { name: "نصف", id: TRUE_VARIANT_IDS["نصف"], weight: 500 },
    { name: "كيلو", id: TRUE_VARIANT_IDS["كيلو"], weight: 1000 }
  ];

  let successCount = 0;
  let failCount = 0;
  const updateResults = [];

  for (const spec of variantSpecs) {
    const exactQtyLeft = Math.floor(remainingGrams / spec.weight);
    const res = await updateZidChildQuantity(spec.id, exactQtyLeft, storeSettings);
    if (res.ok) {
      successCount++;
      updateResults.push(`${spec.name}: ${exactQtyLeft} قطعة (نجاح)`);
    } else {
      failCount++;
      updateResults.push(`${spec.name}: ${exactQtyLeft} قطعة (فشل كود ${res.status})`);
    }
  }

  const actionText = isCancellation ? `🔄 تم استرجاع ${totalOrderGrams} جرام` : `⚡️ تم خصم ${totalOrderGrams} جرام`;
  const orderRefText = orderId ? ` للطلب #${orderId}` : '';
  const statusSummary = failCount === 0 
    ? `تم تحديث كافة خيارات زد البالغة 6 خيارات بنجاح 100%.` 
    : `تم تحديث ${successCount} خياراً وفشل ${failCount} خيار (يرجى التحقق من التوكين و Location ID).`;

  data.logs.unshift({
    id: `log-${Date.now()}`,
    timestamp: new Date().toISOString(),
    type: isCancellation ? "AUTO_CANCEL_RESTORE" : "AUTO_ORDER_DEDUCT",
    message: `${actionText}${orderRefText}. المخزون المتبقي حالياً بالخزان: ${remainingGrams} جرام. ${statusSummary}`
  });

  saveData(data);
  return { totalOrderGrams, remainingGrams, successCount, failCount, updateResults };
}

// الاستطلاع التلقائي المستمر للطلبات كل 15 ثانية
async function pollZidOrdersAndSync() {
  try {
    const data = loadData();
    if (!data.storeSettings.autoSyncEnabled || !data.storeSettings.zidManagerToken) return;

    const res = await callZidGet('/v1/managers/store/orders?page=1', data.storeSettings);
    if (res.ok && res.data && res.data.orders && Array.isArray(res.data.orders)) {
      const orders = res.data.orders;
      
      for (const order of orders) {
        const orderId = String(order.id);
        const orderStatus = order.order_status ? order.order_status.code : null;

        const processedList = data.storeSettings.processedOrderIds || [];
        const existingRecord = processedList.find(p => p.id === orderId);

        if (!existingRecord) {
          // طلب جديد لم يتم معالجته من قبل
          if (order.products && order.products.length > 0) {
            await syncAllVariantsQuantities(order.products, false, data.storeSettings, orderId);
          }
          
          processedList.unshift({ id: orderId, status: orderStatus, processedAt: new Date().toISOString() });
          if (processedList.length > 300) processedList.pop();
          data.storeSettings.processedOrderIds = processedList;
          saveData(data);
        } 
        else if (existingRecord.status !== 'cancelled' && orderStatus === 'cancelled') {
          // الطلب تم إلغاؤه لاحقاً
          if (order.products && order.products.length > 0) {
            await syncAllVariantsQuantities(order.products, true, data.storeSettings, orderId);
          }

          existingRecord.status = 'cancelled';
          existingRecord.cancelledAt = new Date().toISOString();
          saveData(data);
        }
      }
    }
  } catch (e) {
    console.error("Polling Error:", e);
  }
}

setInterval(pollZidOrdersAndSync, 15000);

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

  // دعم الـ Webhook المباشر
  if ((pathname === '/api/zid-webhook/order-create' || pathname === '/zid-webhook') && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        const data = loadData();
        const order = payload.order || payload;
        const orderId = order.id ? String(order.id) : null;
        const isCancelled = (payload.event === 'order.cancelled' || (order.order_status && order.order_status.code === 'cancelled'));

        if (order && order.products && Array.isArray(order.products) && order.products.length > 0) {
          await syncAllVariantsQuantities(order.products, isCancelled, data.storeSettings, orderId);
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ status: 'success' }));
      } catch (e) {
        console.error("Webhook Invalid Payload:", e);
        res.writeHead(400);
        return res.end('Invalid Payload');
      }
    });
    return;
  }

  if (pathname === '/api/sync-order' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        const data = loadData();
        const isCancelled = payload.isCancelled || false;
        let products = [];

        if (payload.products && Array.isArray(payload.products)) {
          products = payload.products;
        } else if (payload.childProductId || payload.productName) {
          products = [{
            id: payload.childProductId || TRUE_VARIANT_IDS["كيلو"],
            name: payload.productName || 'كيلو',
            quantity: payload.quantity || 1
          }];
        } else {
          products = [{ id: TRUE_VARIANT_IDS["كيلو"], name: 'كيلو', quantity: 1 }];
        }

        const result = await syncAllVariantsQuantities(products, isCancelled, data.storeSettings);

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({
          status: 'success',
          message: 'تم تنفيذ المزامنة وحساب الأوزان بنجاح!',
          details: result
        }));
      } catch (e) {
        console.error("Sync-order Error:", e);
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
        if (payload.zidStoreId !== undefined) data.storeSettings.zidStoreId = payload.zidStoreId;
        if (payload.zidManagerToken !== undefined) data.storeSettings.zidManagerToken = payload.zidManagerToken;
        if (payload.zidAuthorizationToken !== undefined) data.storeSettings.zidAuthorizationToken = payload.zidAuthorizationToken;
        if (payload.locationId !== undefined) data.storeSettings.locationId = payload.locationId;
        if (payload.totalGramsStore !== undefined) data.storeSettings.totalGramsStore = Number(payload.totalGramsStore);
        if (payload.autoSyncEnabled !== undefined) data.storeSettings.autoSyncEnabled = Boolean(payload.autoSyncEnabled);
        
        saveData(data);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ status: 'success', message: 'تم حفظ الإعدادات بنجاح' }));
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
  console.log(`Zid Permanent Auto-Polling & Webhook Engine running on http://localhost:${PORT}`);
});
