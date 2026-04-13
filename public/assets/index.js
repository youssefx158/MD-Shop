import {
  addToCart,
  api,
  cartCount,
  clampInt,
  fmtEGP,
  getCart,
  qs,
  qsa,
  show,
  updateQty,
} from "./app.js";

const gridEl = qs("#grid");
const emptyEl = qs("#empty");

const backdrop = qs("#backdrop");
const modal = qs("#productModal");
const modalBody = qs("#modalBody");
const modalClose = qs("#modalClose");

const drawer = qs("#drawer");
const cartBtn = qs("#cartBtn");
const cartBadge = qs("#cartBadge");
const cartCountEl = qs("#cartCount");
const cartList = qs("#cartList");
const cartEmpty = qs("#cartEmpty");
const cartTotal = qs("#cartTotal");
const drawerClose = qs("#drawerClose");
const checkoutBtn = qs("#checkoutBtn");
const continueBtn = qs("#continueBtn");

const trackBtn = qs("#trackBtn");
const trackModal = qs("#trackModal");
const trackClose = qs("#trackClose");
const trackGo = qs("#trackGo");
const trackId = qs("#trackId");
const trackErr = qs("#trackErr");
const trackResult = qs("#trackResult");

let products = [];
let activeProduct = null;

boot();

async function boot() {
  syncCartUI();
  bindCart();
  bindProductModal();
  bindTracking();

  try {
    const data = await api("/api/products");
    products = data.products || [];
  } catch {
    products = [];
  }
  renderGrid();
}

function renderGrid() {
  gridEl.innerHTML = "";
  show(emptyEl, products.length === 0);
  for (const p of products) {
    const priceInfo = computePriceInfo(p);
    const el = document.createElement("article");
    el.className = "card";
    el.innerHTML = `
      ${priceInfo.hasDiscount ? `<div class="chip">تخفيض</div>` : ""}
      <div class="card-media">
        ${p.cardImage ? `<img alt="" src="${escapeAttr(p.cardImage)}" />` : `<div class="mini">لا توجد صورة</div>`}
      </div>
      <div class="card-body">
        <div class="card-title">${escapeHtml(p.name)}</div>
        <div class="price-row">
          ${priceInfo.hasDiscount ? `<div class="price was">${fmtEGP(priceInfo.was)}</div>` : ""}
          <div class="price ${priceInfo.hasDiscount ? "sale" : ""}">${fmtEGP(priceInfo.now)}</div>
        </div>
        <button class="btn" type="button">تسوق الآن</button>
      </div>
    `;
    el.addEventListener("click", () => openProduct(p.id));
    gridEl.appendChild(el);
  }
}

function computePriceInfo(product) {
  const was = Number(product.basePrice) || 0;
  const now = Number(product.salePrice) || was;
  return { was, now, hasDiscount: now > 0 && was > 0 && now < was };
}

function openProduct(productId) {
  const p = products.find((x) => x.id === productId);
  if (!p) return;
  activeProduct = p;

  const images = [p.cardImage, ...(p.detailImages || [])].filter(Boolean);
  const img1 = images[0] || "";
  const img2 = images[1] || images[0] || "";
  const priceInfo = computePriceInfo(p);

  modalBody.innerHTML = `
    <div class="product-layout">
      <div class="gallery">
        <div class="gallery-two">
          <div class="shot">${img1 ? `<img id="g1" alt="" src="${escapeAttr(img1)}" />` : `<div class="mini" style="padding:16px">لا توجد صور</div>`}</div>
          <div class="shot">${img2 ? `<img id="g2" alt="" src="${escapeAttr(img2)}" />` : `<div class="mini" style="padding:16px">—</div>`}</div>
        </div>
        ${
          images.length > 2
            ? `<div class="thumbs" id="thumbs">
                ${images
                  .map(
                    (src, i) =>
                      `<img class="${i === 0 ? "active" : ""}" data-src="${escapeAttr(src)}" alt="" src="${escapeAttr(src)}" />`,
                  )
                  .join("")}
              </div>`
            : `<div style="height: 2px"></div>`
        }
      </div>
      <div>
        <div class="kicker">PREMIUM HOODIE</div>
        <div class="h2">${escapeHtml(p.name)}</div>
        <div class="desc">${escapeHtml(p.description || "")}</div>

        <div class="mini" style="margin-top:12px">COLOR</div>
        <div class="dots" aria-label="Color selector (UI only)">
          <div class="dot active" title="Teal"></div>
          <div class="dot" title="Dark"></div>
          <div class="dot" title="Gray"></div>
        </div>

        <div style="margin-top:14px; font-weight:900">المقاس</div>
        <div class="sizes" id="sizes">
          ${(p.sizes || []).map((s) => `<button type="button" class="size-btn" data-size="${escapeAttr(s.label)}">${escapeHtml(s.label)}</button>`).join("")}
        </div>

        <div class="row2">
          <div class="price-row">
            ${priceInfo.hasDiscount ? `<div class="price was" id="pWas">${fmtEGP(priceInfo.was)}</div>` : `<div id="pWas" style="display:none"></div>`}
            <div class="price ${priceInfo.hasDiscount ? "sale" : ""}" id="pNow">${fmtEGP(priceInfo.now)}</div>
          </div>
          <div class="qty" aria-label="Quantity">
            <button type="button" id="qPlus">+</button>
            <span id="qVal">1</span>
            <button type="button" id="qMinus">-</button>
          </div>
        </div>

        <div class="mini" style="margin-top:6px; display:flex; gap:8px; align-items:center">
          <span style="color: var(--teal2); font-weight:900">✓</span>
          <span>متوفر</span>
        </div>

        <div style="display:flex; gap:10px; align-items:stretch; margin-top:14px; flex-wrap:wrap">
          <button id="addBtn" class="btn" type="button" style="margin:0; flex: 1; min-width: 220px" disabled>إضافة للسلة</button>
          <button id="favBtn" class="fav" type="button" aria-label="Favorite">♡</button>
        </div>

        <div class="features">
          <div class="feature"><span>🛡️</span> <b>جودة عالية</b> <span>خامة ممتازة</span></div>
          <div class="feature"><span>🧵</span> <b>تفصيل محكم</b> <span>خياطة قوية</span></div>
          <div class="feature"><span>📦</span> <b>إصدار محدود</b> <span>تصميم حصري</span></div>
        </div>
      </div>
    </div>
  `;

  wireGallery();
  wireProductControls();
  show(backdrop, true);
  show(modal, true);
}

function wireGallery() {
  const thumbs = qs("#thumbs", modalBody);
  const imgA = qs("#g1", modalBody);
  const imgB = qs("#g2", modalBody);
  if (!thumbs || !imgA) return;
  thumbs.addEventListener("click", (e) => {
    const img = e.target.closest("img");
    if (!img) return;
    const src = img.getAttribute("data-src") || "";
    imgA.src = src;
    if (imgB) imgB.src = src;
    qsa("img", thumbs).forEach((x) => x.classList.toggle("active", x === img));
  });
}

function wireProductControls() {
  const sizesEl = qs("#sizes", modalBody);
  const addBtn = qs("#addBtn", modalBody);
  const favBtn = qs("#favBtn", modalBody);
  const qVal = qs("#qVal", modalBody);
  const qPlus = qs("#qPlus", modalBody);
  const qMinus = qs("#qMinus", modalBody);
  const pNow = qs("#pNow", modalBody);
  const pWas = qs("#pWas", modalBody);

  let selected = "";
  let qty = 1;

  const updatePrice = () => {
    if (!activeProduct) return;
    const priceInfo = computePriceInfo(activeProduct);
    if (pWas) pWas.style.display = priceInfo.hasDiscount ? "" : "none";
    if (pWas) pWas.textContent = fmtEGP(priceInfo.was);
    if (pNow) {
      pNow.textContent = fmtEGP(priceInfo.now);
      pNow.classList.toggle("sale", priceInfo.hasDiscount);
    }
  };

  sizesEl?.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    selected = btn.getAttribute("data-size") || "";
    qsa(".size-btn", sizesEl).forEach((b) => b.classList.toggle("active", b === btn));
    if (addBtn) addBtn.disabled = !selected;
    updatePrice();
  });

  qPlus?.addEventListener("click", () => {
    qty = clampInt(qty + 1, 1, 99);
    if (qVal) qVal.textContent = String(qty);
  });
  qMinus?.addEventListener("click", () => {
    qty = clampInt(qty - 1, 1, 99);
    if (qVal) qVal.textContent = String(qty);
  });

  addBtn?.addEventListener("click", () => {
    if (!activeProduct) return;
    if (!selected) {
      addBtn.classList.remove("shake");
      void addBtn.offsetWidth;
      addBtn.classList.add("shake");
      addBtn.textContent = "اختر مقاساً أولاً";
      setTimeout(() => (addBtn.textContent = "إضافة للسلة"), 900);
      return;
    }
    addToCart({ productId: activeProduct.id, size: selected, qty });
    syncCartUI();
    addBtn.textContent = "تمت الإضافة ✓";
    setTimeout(() => (addBtn.textContent = "إضافة للسلة"), 1100);
  });

  favBtn?.addEventListener("click", () => {
    favBtn.textContent = favBtn.textContent === "♡" ? "♥" : "♡";
  });

  updatePrice();
}

function bindProductModal() {
  modalClose.addEventListener("click", closeOverlays);
  backdrop.addEventListener("click", closeOverlays);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeOverlays();
  });
}

function bindCart() {
  cartBtn.addEventListener("click", () => openDrawer(true));
  drawerClose.addEventListener("click", closeDrawer);
  continueBtn.addEventListener("click", closeDrawer);
  checkoutBtn.addEventListener("click", () => {
    window.location.href = "/checkout.html";
  });
}

function openDrawer(on) {
  show(backdrop, !!on);
  show(drawer, !!on);
  renderCart();
}

function closeDrawer() {
  show(drawer, false);
  show(backdrop, false);
}

function closeOverlays() {
  show(modal, false);
  show(trackModal, false);
  closeDrawer();
}

function syncCartUI() {
  const count = cartCount();
  cartCountEl.textContent = String(count);
  if (count > 0) {
    cartBadge.style.display = "";
    cartBadge.textContent = String(count);
  } else {
    cartBadge.style.display = "none";
  }
}

function renderCart() {
  const cart = getCart();
  cartList.innerHTML = "";
  show(cartEmpty, cart.length === 0);

  let total = 0;
  for (const it of cart) {
    const product = products.find((p) => p.id === it.productId);
    const size = product?.sizes?.find((s) => s.label === it.size);
    const unit = size ? (size.salePrice || size.price) : 0;
    const line = unit * (it.qty || 1);
    total += line;

    const row = document.createElement("div");
    row.className = "cart-item";
    row.innerHTML = `
      ${product?.cardImage ? `<img alt="" src="${escapeAttr(product.cardImage)}" />` : `<div></div>`}
      <div>
        <h4>${escapeHtml(product?.name || "منتج")}</h4>
        <div class="meta">المقاس: ${escapeHtml(it.size)}</div>
        <div class="cart-row">
          <div class="qty">
            <button type="button" data-act="plus">+</button>
            <span>${it.qty || 1}</span>
            <button type="button" data-act="minus">-</button>
          </div>
          <div class="price ${size?.salePrice ? "sale" : ""}">${fmtEGP(line)}</div>
          <button class="xbtn" type="button" data-act="del">✕</button>
        </div>
      </div>
    `;
    row.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      const act = btn.getAttribute("data-act");
      const qty = it.qty || 1;
      if (act === "plus") updateQty(it.productId, it.size, qty + 1);
      if (act === "minus") updateQty(it.productId, it.size, qty - 1);
      if (act === "del") updateQty(it.productId, it.size, 0);
      syncCartUI();
      renderCart();
    });
    cartList.appendChild(row);
  }

  cartTotal.textContent = fmtEGP(total);
}

function bindTracking() {
  trackBtn.addEventListener("click", () => {
    show(backdrop, true);
    show(trackModal, true);
    trackId.focus();
  });
  trackClose.addEventListener("click", closeOverlays);
  trackGo.addEventListener("click", doTrack);
  trackId.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doTrack();
  });
}

async function doTrack() {
  trackErr.style.visibility = "hidden";
  trackResult.innerHTML = "";
  const id = trackId.value.trim();
  if (!id) return;
  try {
    const data = await api(`/api/orders/${encodeURIComponent(id)}`, { method: "GET" });
    renderTrack(data.order);
  } catch (e) {
    trackErr.textContent = e.message || "رقم الطلب غير موجود";
    trackErr.style.visibility = "visible";
  }
}

function renderTrack(order) {
  const map = new Map([
    ["new", "تم الاستلام"],
    ["prep", "تم التجهيز"],
    ["shipped", "تم الشحن"],
    ["out", "خرج للتوصيل"],
    ["delivered", "وصل"],
    ["canceled", "ملغي"],
  ]);
  const steps = ["new", "prep", "shipped", "out", "delivered"];
  const current = order.status;
  const idx = steps.indexOf(current);
  const pct = idx < 0 ? 0 : (idx / (steps.length - 1)) * 100;

  trackResult.innerHTML = `
    <div class="mini" style="margin-bottom:10px">الحالة الحالية: <span style="color: var(--teal2); font-weight:900">${escapeHtml(map.get(current) || current)}</span></div>
    ${
      current === "canceled"
        ? `<div class="muted-box">تم إلغاء الطلب.</div>`
        : `
    <div style="position:relative; margin-top:12px; padding:18px 12px">
      <div style="height:6px; background: rgba(255,255,255,0.12); border-radius:999px"></div>
      <div id="bar" style="height:6px; width:0; background: rgba(34,197,94,0.9); border-radius:999px; position:absolute; top:18px; right:12px"></div>
      <div style="display:flex; justify-content:space-between; margin-top:12px; gap:10px; flex-wrap:wrap">
        ${steps
          .map((s, i) => {
            const done = i <= idx;
            return `<div style="text-align:center; min-width:64px">
              <div style="width:14px; height:14px; border-radius:999px; margin:0 auto; background:${done ? "rgba(34,197,94,0.95)" : "rgba(255,255,255,0.18)"}"></div>
              <div class="mini" style="margin-top:6px">${escapeHtml(map.get(s) || s)}</div>
            </div>`;
          })
          .join("")}
      </div>
    </div>
    `
    }
  `;

  const bar = qs("#bar", trackResult);
  if (bar) {
    bar.animate(
      [{ width: "0%" }, { width: `${pct}%` }],
      { duration: 700, easing: "cubic-bezier(.2,.9,.2,1)" },
    );
    bar.style.width = `${pct}%`;
  }
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(s) {
  return escapeHtml(s).replaceAll("'", "&#39;");
}
