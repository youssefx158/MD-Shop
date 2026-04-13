import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

import { config } from "./config.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_DIR = fileUrlToFsPath(config.paths.publicDir);
const DATA_DIR = fileUrlToFsPath(config.paths.dataDir);
const UPLOADS_DIR = fileUrlToFsPath(config.paths.uploadsDir);

const PRODUCTS_FILE = path.join(DATA_DIR, "products.json");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");

const sessions = new Map(); // token -> { lastSeenMs }
const lockouts = new Map(); // ip -> { attempts, lockUntilMs }

await ensureDirs();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const method = (req.method || "GET").toUpperCase();

    // CORS not needed (same-origin). Keep tight.
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url, method);
      return;
    }

    // Admin "secret" entrypoint.
    if (url.pathname === "/md-control-panel" || url.pathname === "/md-control-panel/") {
      await serveFile(res, path.join(PUBLIC_DIR, "admin.html"));
      return;
    }

    // Static: uploads
    if (url.pathname.startsWith("/uploads/")) {
      const rel = url.pathname.replace(/^\/uploads\//, "");
      const abs = safeJoin(UPLOADS_DIR, rel);
      if (!abs) return sendText(res, 400, "Bad request");
      await serveFile(res, abs);
      return;
    }

    // Static: public
    const staticPath = url.pathname === "/" ? "/index.html" : url.pathname;
    const abs = safeJoin(PUBLIC_DIR, staticPath);
    if (!abs) return sendText(res, 400, "Bad request");
    await serveFile(res, abs);
  } catch (err) {
    sendText(res, 500, "Server error");
  }
});

server.listen(config.port, "0.0.0.0", () => {
  // eslint-disable-next-line no-console
  console.log(`MD Store: http://127.0.0.1:${config.port}/`);
  // eslint-disable-next-line no-console
  console.log(`Admin:    http://127.0.0.1:${config.port}/md-control-panel`);
});

async function handleApi(req, res, url, method) {
  if (method === "OPTIONS") return sendJson(res, 204, {});

  if (url.pathname === "/api/health") return sendJson(res, 200, { ok: true });

  // Auth
  if (url.pathname === "/api/admin/login" && method === "POST") {
    const ip = getClientIp(req);
    const lock = lockouts.get(ip);
    if (lock && lock.lockUntilMs > Date.now()) {
      return sendJson(res, 423, { ok: false, message: "الصفحة غير متاحة" });
    }

    const body = await readJsonBody(req, 64_000);
    const password = String(body?.password || "");

    if (password !== config.adminPassword) {
      const next = lock || { attempts: 0, lockUntilMs: 0 };
      next.attempts += 1;
      if (next.attempts >= config.lockoutMaxAttempts) {
        next.lockUntilMs = Date.now() + config.lockoutMinutes * 60_000;
      }
      lockouts.set(ip, next);
      return sendJson(res, 401, { ok: false, message: "الصفحة غير متاحة" });
    }

    lockouts.delete(ip);
    const token = crypto.randomBytes(24).toString("base64url");
    sessions.set(token, { lastSeenMs: Date.now() });
    setCookie(res, "mdsid", token, {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
    });
    return sendJson(res, 200, { ok: true });
  }

  if (url.pathname === "/api/admin/logout" && method === "POST") {
    const token = getCookie(req, "mdsid");
    if (token) sessions.delete(token);
    setCookie(res, "mdsid", "", { path: "/", maxAge: 0 });
    return sendJson(res, 200, { ok: true });
  }

  // Products (public)
  if (url.pathname === "/api/products" && method === "GET") {
    const products = await readProducts();
    const published = products.filter((p) => p.visibility === "published");
    return sendJson(res, 200, { ok: true, products: published });
  }

  // Orders (public)
  if (url.pathname === "/api/orders" && method === "POST") {
    const body = await readJsonBody(req, 256_000);
    const cart = Array.isArray(body?.cart) ? body.cart : [];
    const customer = body?.customer || {};
    const validation = validateOrderInput(cart, customer);
    if (!validation.ok) return sendJson(res, 400, validation);

    const { order, productsNotFound } = await createOrder(cart, customer);
    if (productsNotFound.length) {
      return sendJson(res, 400, {
        ok: false,
        message: "منتجات غير موجودة أو تغيرت",
        productsNotFound,
      });
    }

    const orders = await readOrders();
    orders.unshift(order);
    await writeJson(ORDERS_FILE, orders);
    return sendJson(res, 201, { ok: true, orderId: order.id });
  }

  const orderMatch = url.pathname.match(/^\/api\/orders\/([A-Za-z0-9\-]+)$/);
  if (orderMatch && method === "GET") {
    const orderId = orderMatch[1];
    const orders = await readOrders();
    const order = orders.find((o) => o.id === orderId);
    if (!order) return sendJson(res, 404, { ok: false, message: "رقم الطلب غير موجود" });
    return sendJson(res, 200, {
      ok: true,
      order: {
        id: order.id,
        status: order.status,
        history: order.history,
        createdAt: order.createdAt,
      },
    });
  }

  // Admin protected routes
  if (url.pathname.startsWith("/api/admin/")) {
    const auth = requireAdminSession(req);
    if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: "غير مصرح" });
  }

  // Admin products
  if (url.pathname === "/api/admin/products" && method === "GET") {
    const products = await readProducts();
    return sendJson(res, 200, { ok: true, products });
  }
  if (url.pathname === "/api/admin/products" && method === "POST") {
    const body = await readJsonBody(req, 2_500_000);
    const products = await readProducts();
    const now = new Date().toISOString();
    const productId = `P-${crypto.randomBytes(6).toString("base64url")}`;
    const product = await normalizeProductInput(productId, body, now);
    products.unshift(product);
    await writeJson(PRODUCTS_FILE, products);
    return sendJson(res, 201, { ok: true, product });
  }
  const prodMatch = url.pathname.match(/^\/api\/admin\/products\/(P-[A-Za-z0-9\-_]+)$/);
  if (prodMatch && method === "PUT") {
    const id = prodMatch[1];
    const body = await readJsonBody(req, 2_500_000);
    const products = await readProducts();
    const idx = products.findIndex((p) => p.id === id);
    if (idx < 0) return sendJson(res, 404, { ok: false, message: "غير موجود" });
    const now = new Date().toISOString();
    const updated = await normalizeProductInput(id, body, now, products[idx]);
    products[idx] = updated;
    await writeJson(PRODUCTS_FILE, products);
    return sendJson(res, 200, { ok: true, product: updated });
  }
  if (prodMatch && method === "DELETE") {
    const id = prodMatch[1];
    const products = await readProducts();
    const next = products.filter((p) => p.id !== id);
    if (next.length === products.length) return sendJson(res, 404, { ok: false, message: "غير موجود" });
    await writeJson(PRODUCTS_FILE, next);
    return sendJson(res, 200, { ok: true });
  }

  // Admin orders
  if (url.pathname === "/api/admin/orders" && method === "GET") {
    const orders = await readOrders();
    return sendJson(res, 200, { ok: true, orders });
  }
  const adminOrderMatch = url.pathname.match(/^\/api\/admin\/orders\/([A-Za-z0-9\-]+)$/);
  if (adminOrderMatch && method === "GET") {
    const id = adminOrderMatch[1];
    const orders = await readOrders();
    const order = orders.find((o) => o.id === id);
    if (!order) return sendJson(res, 404, { ok: false, message: "غير موجود" });
    return sendJson(res, 200, { ok: true, order });
  }
  const statusMatch = url.pathname.match(/^\/api\/admin\/orders\/([A-Za-z0-9\-]+)\/status$/);
  if (statusMatch && method === "PUT") {
    const id = statusMatch[1];
    const body = await readJsonBody(req, 64_000);
    const status = String(body?.status || "");
    const allowed = ["new", "prep", "shipped", "out", "delivered", "canceled"];
    if (!allowed.includes(status)) return sendJson(res, 400, { ok: false, message: "حالة غير صحيحة" });
    const orders = await readOrders();
    const idx = orders.findIndex((o) => o.id === id);
    if (idx < 0) return sendJson(res, 404, { ok: false, message: "غير موجود" });
    const now = new Date().toISOString();
    orders[idx].status = status;
    orders[idx].updatedAt = now;
    orders[idx].history.push({ status, at: now });
    await writeJson(ORDERS_FILE, orders);
    return sendJson(res, 200, { ok: true });
  }
  if (adminOrderMatch && method === "DELETE") {
    const id = adminOrderMatch[1];
    const orders = await readOrders();
    const next = orders.filter((o) => o.id !== id);
    if (next.length === orders.length) return sendJson(res, 404, { ok: false, message: "غير موجود" });
    await writeJson(ORDERS_FILE, next);
    return sendJson(res, 200, { ok: true });
  }

  if (url.pathname === "/api/admin/stats" && method === "GET") {
    const [products, orders] = await Promise.all([readProducts(), readOrders()]);
    const byStatus = Object.create(null);
    for (const o of orders) byStatus[o.status] = (byStatus[o.status] || 0) + 1;
    const totalSales = orders
      .filter((o) => o.status !== "canceled")
      .reduce((sum, o) => sum + o.total, 0);
    return sendJson(res, 200, {
      ok: true,
      stats: {
        products: products.length,
        orders: orders.length,
        byStatus,
        totalSales,
      },
    });
  }

  return sendJson(res, 404, { ok: false, message: "Not found" });
}

function requireAdminSession(req) {
  const token = getCookie(req, "mdsid");
  if (!token) return { ok: false, status: 401 };
  const session = sessions.get(token);
  if (!session) return { ok: false, status: 401 };

  const now = Date.now();
  const idleMs = config.sessionIdleMinutes * 60_000;
  if (now - session.lastSeenMs > idleMs) {
    sessions.delete(token);
    return { ok: false, status: 401 };
  }

  session.lastSeenMs = now;
  return { ok: true, status: 200 };
}

async function normalizeProductInput(id, body, nowIso, existing = null) {
  const name = String(body?.name || "").trim();
  const description = String(body?.description || "").trim();
  const sizes = Array.isArray(body?.sizes) ? body.sizes : [];
  const visibility = ["published", "draft", "hidden"].includes(body?.visibility)
    ? body.visibility
    : "published";

  if (!name) throw new Error("Invalid product name");
  const basePrice = toMoneyNumber(body?.basePrice);
  const salePrice =
    body?.salePrice === "" || body?.salePrice == null ? null : toMoneyNumber(body?.salePrice);

  if (!Number.isFinite(basePrice) || basePrice <= 0) throw new Error("Invalid base price");
  const normalizedSale =
    Number.isFinite(salePrice) && salePrice > 0 && salePrice < basePrice ? salePrice : null;

  const normalizedSizes = sizes
    .map((s) => (typeof s === "string" ? s : s?.label))
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .slice(0, 50)
    .map((label) => ({ label }));

  if (normalizedSizes.length === 0) throw new Error("Invalid sizes");

  const cardImage = await maybeStoreImageDataUrl(
    body?.cardImageDataUrl,
    `${id}-card`,
    existing?.cardImage || null,
  );

  const detailImageDataUrls = Array.isArray(body?.detailImageDataUrls) ? body.detailImageDataUrls : [];
  const detailImages = [];
  for (let i = 0; i < Math.min(4, detailImageDataUrls.length); i++) {
    const img = await maybeStoreImageDataUrl(detailImageDataUrls[i], `${id}-d${i + 1}`, null);
    if (img) detailImages.push(img);
  }

  return {
    id,
    name,
    description,
    basePrice,
    salePrice: normalizedSale,
    sizes: normalizedSizes,
    visibility,
    cardImage: cardImage || existing?.cardImage || null,
    detailImages: detailImages.length ? detailImages : existing?.detailImages || [],
    createdAt: existing?.createdAt || nowIso,
    updatedAt: nowIso,
  };
}

async function maybeStoreImageDataUrl(dataUrl, baseName, keepExisting) {
  if (!dataUrl || typeof dataUrl !== "string") return keepExisting;
  if (!dataUrl.startsWith("data:")) return keepExisting;

  const match = dataUrl.match(/^data:(image\/png|image\/jpeg|image\/webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return keepExisting;
  const mime = match[1];
  const b64 = match[2];
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";

  const buf = Buffer.from(b64, "base64");
  // Simple size guard
  if (buf.length > 1_500_000) return keepExisting;

  const file = `${baseName}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.${ext}`;
  const abs = path.join(UPLOADS_DIR, file);
  await fs.writeFile(abs, buf);
  return `/uploads/${file}`;
}

async function createOrder(cart, customer) {
  const products = await readProducts();
  const productsById = new Map(products.map((p) => [p.id, p]));
  const items = [];
  const productsNotFound = [];

  for (const c of cart) {
    const productId = String(c?.productId || "");
    const sizeLabel = String(c?.size || "");
    const qty = clampInt(c?.qty, 1, 99);
    const product = productsById.get(productId);
    if (!product || product.visibility !== "published") {
      productsNotFound.push(productId);
      continue;
    }
    const hasSize = (product.sizes || []).some((s) => s.label === sizeLabel);
    if (!hasSize) {
      productsNotFound.push(`${productId}:${sizeLabel}`);
      continue;
    }

    const unit = product.salePrice || product.basePrice;
    items.push({
      productId,
      name: product.name,
      size: sizeLabel,
      qty,
      unitPrice: product.basePrice,
      unitSalePrice: product.salePrice,
      image: product.cardImage,
      lineTotal: unit * qty,
    });
  }

  const total = items.reduce((sum, it) => sum + it.lineTotal, 0);
  const now = new Date().toISOString();
  const order = {
    id: generateOrderId(),
    status: "new",
    history: [{ status: "new", at: now }],
    items,
    total,
    customer: {
      name: String(customer.name || "").trim(),
      phone: String(customer.phone || "").trim(),
      phone2: customer.phone2 ? String(customer.phone2).trim() : "",
      governorate: String(customer.governorate || "").trim(),
      area: String(customer.area || "").trim(),
      building: String(customer.building || "").trim(),
      address: String(customer.address || "").trim(),
    },
    createdAt: now,
    updatedAt: now,
  };
  return { order, productsNotFound };
}

function validateOrderInput(cart, customer) {
  if (!Array.isArray(cart) || cart.length === 0) return { ok: false, message: "السلة فارغة" };
  const name = String(customer?.name || "").trim();
  const phone = normalizePhone(String(customer?.phone || ""));
  const governorate = String(customer?.governorate || "").trim();
  const area = String(customer?.area || "").trim();
  const building = String(customer?.building || "").trim();

  if (name.split(/\s+/).filter(Boolean).length < 3) return { ok: false, message: "أدخل اسمك الثلاثي" };
  if (!/^01\d{9}$/.test(phone)) return { ok: false, message: "أدخل رقم هاتف مصري صحيح" };
  if (!governorate) return { ok: false, message: "اختر المحافظة" };
  if (!area) return { ok: false, message: "أدخل المنطقة" };
  if (!building) return { ok: false, message: "أدخل رقم/اسم المبنى" };
  return { ok: true };
}

function generateOrderId() {
  const n = Math.floor(1000 + Math.random() * 9000);
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const a = letters[Math.floor(Math.random() * letters.length)];
  const b = letters[Math.floor(Math.random() * letters.length)];
  return `MD-${n}-${a}${b}`;
}

async function readProducts() {
  const products = await readJson(PRODUCTS_FILE, []);
  const { migrated, changed } = migrateProducts(products);
  if (changed) await writeJson(PRODUCTS_FILE, migrated);
  return migrated;
}

async function readOrders() {
  return readJson(ORDERS_FILE, []);
}

async function ensureDirs() {
  await fs.mkdir(PUBLIC_DIR, { recursive: true });
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  // Initialize files if missing
  await touchJson(PRODUCTS_FILE, []);
  await touchJson(ORDERS_FILE, []);
}

async function touchJson(file, initial) {
  try {
    await fs.access(file);
  } catch {
    await writeJson(file, initial);
  }
}

async function readJson(file, fallback) {
  try {
    const txt = await fs.readFile(file, "utf8");
    return JSON.parse(txt);
  } catch {
    return fallback;
  }
}

async function writeJson(file, data) {
  const tmp = `${file}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, file);
}

async function readJsonBody(req, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("Body too large");
    chunks.push(chunk);
  }
  const txt = Buffer.concat(chunks).toString("utf8");
  if (!txt) return null;
  try {
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

function sendText(res, status, text) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(text);
}

function setCookie(res, name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (opts.maxAge != null) parts.push(`Max-Age=${opts.maxAge}`);
  if (opts.httpOnly) parts.push("HttpOnly");
  if (opts.sameSite) parts.push(`SameSite=${opts.sameSite}`);
  if (opts.secure) parts.push("Secure");
  parts.push(`Path=${opts.path || "/"}`);
  res.setHeader("Set-Cookie", parts.join("; "));
}

function getCookie(req, name) {
  const cookie = req.headers.cookie || "";
  const parts = cookie.split(";").map((p) => p.trim());
  for (const p of parts) {
    const idx = p.indexOf("=");
    if (idx < 0) continue;
    const k = p.slice(0, idx);
    if (k !== name) continue;
    return decodeURIComponent(p.slice(idx + 1));
  }
  return "";
}

function safeJoin(root, urlPath) {
  const rootAbs = path.resolve(root);
  const clean = String(urlPath || "").split("?")[0].split("#")[0];
  const rel = decodeURIComponent(clean).replace(/^\/+/, "");
  if (!rel) return rootAbs;
  if (rel.includes("..")) return null;
  return path.join(rootAbs, rel);
}

async function serveFile(res, absPath) {
  try {
    const stat = await fs.stat(absPath);
    if (stat.isDirectory()) return sendText(res, 404, "Not found");
    const ext = path.extname(absPath).toLowerCase();
    const type = mimeFromExt(ext);
    const data = await fs.readFile(absPath);
    res.writeHead(200, {
      "content-type": type,
      "cache-control": "no-store",
    });
    res.end(data);
  } catch {
    sendText(res, 404, "Not found");
  }
}

function mimeFromExt(ext) {
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

function clampInt(v, min, max) {
  const n = Number.isFinite(v) ? Math.floor(v) : Number.parseInt(String(v), 10);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function toMoneyNumber(v) {
  const n = Number.parseFloat(String(v));
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100) / 100;
}

function normalizePhone(input) {
  const s = String(input || "");
  const map = {
    "٠": "0",
    "١": "1",
    "٢": "2",
    "٣": "3",
    "٤": "4",
    "٥": "5",
    "٦": "6",
    "٧": "7",
    "٨": "8",
    "٩": "9",
    "۰": "0",
    "۱": "1",
    "۲": "2",
    "۳": "3",
    "۴": "4",
    "۵": "5",
    "۶": "6",
    "۷": "7",
    "۸": "8",
    "۹": "9",
  };
  let out = "";
  for (const ch of s) out += map[ch] || ch;
  return out.replace(/[^\d]/g, "");
}

function migrateProducts(products) {
  if (!Array.isArray(products)) return { migrated: [], changed: false };
  let changed = false;
  const migrated = products.map((p) => {
    if (!p || typeof p !== "object") return p;
    if (Number.isFinite(p.basePrice) && Array.isArray(p.sizes) && p.sizes.every((s) => typeof s?.label === "string")) {
      return p;
    }

    // Legacy shape: sizes[] had price/salePrice per size.
    if (Array.isArray(p.sizes) && p.sizes.length) {
      const labels = p.sizes
        .map((s) => (typeof s === "string" ? s : s?.label))
        .map((x) => String(x || "").trim())
        .filter(Boolean)
        .map((label) => ({ label }));

      const baseCandidates = p.sizes.map((s) => Number(s?.price)).filter((n) => Number.isFinite(n) && n > 0);
      const saleCandidates = p.sizes
        .map((s) => Number(s?.salePrice))
        .filter((n) => Number.isFinite(n) && n > 0);
      const basePrice = baseCandidates.length ? Math.min(...baseCandidates) : 0;
      const saleMin = saleCandidates.length ? Math.min(...saleCandidates) : null;
      const salePrice = saleMin && saleMin < basePrice ? saleMin : null;

      changed = true;
      return {
        ...p,
        basePrice: basePrice || p.basePrice || 0,
        salePrice,
        sizes: labels.length ? labels : [{ label: "M" }],
      };
    }

    return p;
  });

  return { migrated, changed };
}

function getClientIp(req) {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf) return xf.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

function fileUrlToFsPath(u) {
  return fileURLToPath(u);
}
