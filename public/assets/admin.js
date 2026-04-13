import { api, bytesToDataUrl, fmtEGP, qs, qsa, show } from "./app.js";

const root = qs("#root");

let state = {
  view: "login", // login | products | orders | stats
  products: [],
  orders: [],
  stats: null,
};

renderLogin();

function renderLogin() {
  root.innerHTML = `
    <div style="min-height:100vh; display:grid; place-items:center; padding:18px">
      <div class="panel" style="width:min(420px, 92vw); text-align:center">
        <div class="logo" style="margin: 0 auto 6px; font-size:46px">MD</div>
        <div class="mini" style="margin-bottom:12px">لوحة التحكم</div>
        <div class="field" id="fPass" style="text-align:right">
          <label for="pass">كلمة المرور</label>
          <input id="pass" type="password" autocomplete="current-password" />
          <div class="err">الصفحة غير متاحة</div>
        </div>
        <button id="loginBtn" class="btn" type="button">دخول</button>
      </div>
    </div>
  `;

  const pass = qs("#pass");
  const loginBtn = qs("#loginBtn");
  pass.focus();
  pass.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doLogin();
  });
  loginBtn.addEventListener("click", doLogin);

  async function doLogin() {
    clearBad();
    loginBtn.disabled = true;
    loginBtn.textContent = "جاري...";
    try {
      await api("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ password: pass.value }),
      });
      await loadAll();
      state.view = "products";
      renderShell();
      renderProducts();
    } catch (e) {
      markBad("fPass", e.message || "الصفحة غير متاحة");
    } finally {
      loginBtn.disabled = false;
      loginBtn.textContent = "دخول";
    }
  }
}

function renderShell() {
  root.innerHTML = `
    <div class="admin-wrap">
      <aside class="sidebar">
        <div class="brand" style="justify-content:flex-start">
          <div>
            <div class="logo">MD</div>
            <small>CONTROL PANEL</small>
          </div>
        </div>
        <button id="navProducts" class="btn sidebtn" type="button">إدارة المنتجات</button>
        <button id="navOrders" class="btn sidebtn" type="button">إدارة الطلبات</button>
        <button id="navStats" class="btn sidebtn" type="button">الإحصائيات</button>
        <button id="logout" class="btn danger sidebtn" type="button" style="margin-top:18px">تسجيل خروج</button>
        <div class="mini" style="margin-top:12px; line-height:1.6">
          الوصول لهذه الصفحة سري.
        </div>
      </aside>
      <section class="content">
        <div id="view"></div>
      </section>
    </div>
    <div id="backdrop" class="backdrop"></div>
    <section id="modal" class="modal" role="dialog" aria-modal="true">
      <div class="modal-inner">
        <div class="modal-close">
          <div id="modalTitle" style="font-weight:900">—</div>
          <button id="modalX" class="xbtn" type="button">✕</button>
        </div>
        <div id="modalBody"></div>
      </div>
    </section>
  `;

  qs("#navProducts").addEventListener("click", async () => {
    state.view = "products";
    await loadProducts();
    renderProducts();
  });
  qs("#navOrders").addEventListener("click", async () => {
    state.view = "orders";
    await loadOrders();
    renderOrders();
  });
  qs("#navStats").addEventListener("click", async () => {
    state.view = "stats";
    await loadStats();
    renderStats();
  });
  qs("#logout").addEventListener("click", async () => {
    try {
      await api("/api/admin/logout", { method: "POST", body: "{}" });
    } finally {
      state = { view: "login", products: [], orders: [], stats: null };
      renderLogin();
    }
  });

  const backdrop = qs("#backdrop");
  const modal = qs("#modal");
  qs("#modalX").addEventListener("click", () => {
    show(backdrop, false);
    show(modal, false);
  });
  backdrop.addEventListener("click", () => {
    show(backdrop, false);
    show(modal, false);
  });
}

async function loadAll() {
  await Promise.all([loadProducts(), loadOrders(), loadStats()]);
}

async function loadProducts() {
  const data = await api("/api/admin/products", { method: "GET" });
  state.products = data.products || [];
}

async function loadOrders() {
  const data = await api("/api/admin/orders", { method: "GET" });
  state.orders = data.orders || [];
}

async function loadStats() {
  const data = await api("/api/admin/stats", { method: "GET" });
  state.stats = data.stats || null;
}

function renderProducts() {
  const view = qs("#view");
  view.innerHTML = `
    <div class="toolbar">
      <div>
        <div style="font-weight:900">المنتجات</div>
        <div class="mini">${state.products.length} منتج</div>
      </div>
      <div style="display:flex; gap:10px; flex-wrap:wrap">
        <input id="search" placeholder="بحث..." style="width:220px" />
        <select id="filter" style="width:160px">
          <option value="all">الكل</option>
          <option value="published">منشور</option>
          <option value="draft">مسودة</option>
          <option value="hidden">مخفي</option>
          <option value="sale">به تخفيض</option>
        </select>
        <button id="create" class="btn" type="button">+ إنشاء منتج جديد</button>
      </div>
    </div>
    <div id="pGrid" class="admin-grid"></div>
  `;

  const search = qs("#search");
  const filter = qs("#filter");
  const grid = qs("#pGrid");

  qs("#create").addEventListener("click", () => openProductEditor(null));
  search.addEventListener("input", render);
  filter.addEventListener("change", render);
  render();

  function render() {
    const q = search.value.trim().toLowerCase();
    const f = filter.value;
    grid.innerHTML = "";
    const list = state.products.filter((p) => {
      if (q && !String(p.name || "").toLowerCase().includes(q)) return false;
      if (f === "all") return true;
      if (f === "sale") return (p.sizes || []).some((s) => s.salePrice && s.salePrice < s.price);
      return p.visibility === f;
    });

    if (list.length === 0) {
      grid.innerHTML = `<div class="muted-box" style="grid-column:1/-1">لا توجد نتائج.</div>`;
      return;
    }

    for (const p of list) {
      const hasSale = p.salePrice && p.basePrice && p.salePrice < p.basePrice;
      const el = document.createElement("article");
      el.className = "card";
      el.style.cursor = "default";
      el.innerHTML = `
        ${hasSale ? `<div class="chip">تخفيض</div>` : ""}
        <div class="card-media" style="height:220px">
          ${p.cardImage ? `<img alt="" src="${escapeAttr(p.cardImage)}" />` : `<div class="mini">لا توجد صورة</div>`}
        </div>
        <div class="card-body">
          <div class="card-title">${escapeHtml(p.name)}</div>
          <div class="mini">المقاسات: ${(p.sizes || []).length} • السعر: ${fmtEGP(p.salePrice || p.basePrice || 0)} • الحالة: ${escapeHtml(p.visibility || "")}</div>
          <div style="display:flex; gap:10px; margin-top:12px; flex-wrap:wrap">
            <button class="btn" data-act="edit" type="button" style="margin:0; width:auto">تعديل</button>
            <button class="btn danger" data-act="del" type="button" style="margin:0; width:auto">حذف</button>
          </div>
        </div>
      `;
      el.addEventListener("click", (e) => {
        const b = e.target.closest("button");
        if (!b) return;
        const act = b.getAttribute("data-act");
        if (act === "edit") openProductEditor(p);
        if (act === "del") deleteProduct(p);
      });
      grid.appendChild(el);
    }
  }
}

function renderOrders() {
  const view = qs("#view");
  view.innerHTML = `
    <div class="toolbar">
      <div>
        <div style="font-weight:900">الطلبات</div>
        <div class="mini">${state.orders.length} طلب</div>
      </div>
      <div style="display:flex; gap:10px; flex-wrap:wrap">
        <input id="orderSearch" placeholder="ابحث برقم الطلب أو اسم العميل..." style="width:280px" />
        <button id="refresh" class="btn" type="button">تحديث</button>
        <button id="export" class="btn" type="button">تصدير JSON</button>
      </div>
    </div>
    <div id="oGrid" class="admin-grid"></div>
  `;

  qs("#refresh").addEventListener("click", async () => {
    await loadOrders();
    renderOrders();
  });
  qs("#export").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state.orders, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "orders.json";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  const grid = qs("#oGrid");
  const search = qs("#orderSearch");
  search.addEventListener("input", render);
  render();

  function render() {
    const q = search.value.trim().toLowerCase();
    grid.innerHTML = "";
    const list = state.orders.filter((o) => {
      if (!q) return true;
      return (
        String(o.id || "").toLowerCase().includes(q) ||
        String(o.customer?.name || "").toLowerCase().includes(q) ||
        String(o.customer?.phone || "").toLowerCase().includes(q)
      );
    });

    if (list.length === 0) {
      grid.innerHTML = `<div class="muted-box" style="grid-column:1/-1">لا توجد طلبات مطابقة.</div>`;
      return;
    }

    for (const o of list) {
      const el = document.createElement("article");
      el.className = "card";
      el.style.cursor = "default";
      el.innerHTML = `
        <div class="card-body">
          <div class="card-title">#${escapeHtml(o.id)}</div>
          <div class="mini">${escapeHtml(o.customer?.name || "")} • ${escapeHtml(o.customer?.governorate || "")}</div>
          <div class="mini">الحالة: ${escapeHtml(o.status)} • ${escapeHtml(new Date(o.createdAt).toLocaleString("ar-EG"))}</div>
          <div class="price-row" style="margin-top:10px">
            <div class="price sale">${fmtEGP(o.total || 0)}</div>
          </div>
          <button class="btn" data-act="view" type="button" style="margin-top:12px">عرض التفاصيل</button>
        </div>
      `;
      el.addEventListener("click", (e) => {
        const b = e.target.closest("button");
        if (!b) return;
        openOrder(o);
      });
      grid.appendChild(el);
    }
  }
}

function renderStats() {
  const view = qs("#view");
  const s = state.stats;
  view.innerHTML = `
    <div class="toolbar">
      <div>
        <div style="font-weight:900">الإحصائيات</div>
        <div class="mini">ملخص سريع</div>
      </div>
      <button id="refresh" class="btn" type="button">تحديث</button>
    </div>
    <div class="admin-grid">
      <div class="panel"><div class="mini">عدد المنتجات</div><div style="font-weight:900; font-size:28px">${s?.products ?? "—"}</div></div>
      <div class="panel"><div class="mini">عدد الطلبات</div><div style="font-weight:900; font-size:28px">${s?.orders ?? "—"}</div></div>
      <div class="panel"><div class="mini">إجمالي المبيعات</div><div style="font-weight:900; font-size:28px">${fmtEGP(s?.totalSales ?? 0)}</div></div>
    </div>
  `;
  qs("#refresh").addEventListener("click", async () => {
    await loadStats();
    renderStats();
  });
}

function openModal(title, html) {
  const backdrop = qs("#backdrop");
  const modal = qs("#modal");
  qs("#modalTitle").textContent = title;
  qs("#modalBody").innerHTML = html;
  show(backdrop, true);
  show(modal, true);
}

function closeModal() {
  show(qs("#backdrop"), false);
  show(qs("#modal"), false);
}

function openOrder(order) {
  const statusOptions = [
    ["new", "جديد"],
    ["prep", "تم التجهيز"],
    ["shipped", "تم الشحن"],
    ["out", "خرج للتوصيل"],
    ["delivered", "وصلت الشحنة"],
    ["canceled", "ملغي"],
  ];

  openModal(
    `تفاصيل الطلب #${order.id}`,
    `
      <div class="product-layout" style="grid-template-columns:1fr 1fr; gap:14px">
        <div class="panel" style="background: linear-gradient(180deg, rgba(9,21,36,0.9), rgba(6,13,23,0.86))">
          <div style="font-weight:900; margin-bottom:10px">بيانات العميل</div>
          <div class="mini" style="padding:6px 0">الاسم: ${escapeHtml(order.customer?.name || "")}</div>
          <div class="mini" style="padding:6px 0">الهاتف: ${escapeHtml(order.customer?.phone || "")}</div>
          ${order.customer?.phone2 ? `<div class="mini" style="padding:6px 0">احتياطي: ${escapeHtml(order.customer.phone2)}</div>` : ""}
          <div class="mini" style="padding:6px 0">المحافظة: ${escapeHtml(order.customer?.governorate || "")}</div>
          <div class="mini" style="padding:6px 0">المنطقة: ${escapeHtml(order.customer?.area || "")}</div>
          <div class="mini" style="padding:6px 0">المبنى: ${escapeHtml(order.customer?.building || "")}</div>
          ${order.customer?.address ? `<div class="mini" style="padding:6px 0">تفاصيل: ${escapeHtml(order.customer.address)}</div>` : ""}
          <button id="copyAddr" class="btn" type="button" style="margin-top:12px">نسخ العنوان</button>
        </div>
        <div class="panel" style="background: linear-gradient(180deg, rgba(9,21,36,0.9), rgba(6,13,23,0.86))">
          <div style="font-weight:900; margin-bottom:10px">تفاصيل الطلب</div>
          <div class="mini">الإجمالي: <span style="color: var(--gold); font-weight:900">${fmtEGP(order.total || 0)}</span></div>
          <div class="mini">الوقت: ${escapeHtml(new Date(order.createdAt).toLocaleString("ar-EG"))}</div>
          <div style="margin-top:10px">
            ${(order.items || [])
              .map(
                (it) => `
                <div class="mini" style="padding:6px 0; border-bottom:1px solid rgba(255,255,255,0.06)">
                  ${escapeHtml(it.name || it.productId)} • ${escapeHtml(it.size)} • x${it.qty}
                </div>`,
              )
              .join("")}
          </div>
          <div style="margin-top:12px; display:flex; gap:10px; flex-wrap:wrap; align-items:center">
            <select id="nextStatus" style="width:200px">
              ${statusOptions
                .map(([v, label]) => `<option value="${v}" ${order.status === v ? "selected" : ""}>${label}</option>`)
                .join("")}
            </select>
            <button id="updateStatus" class="btn" type="button" style="width:auto; margin:0">تحديث الحالة</button>
            <button id="deleteOrder" class="btn danger" type="button" style="width:auto; margin:0">إلغاء/حذف الطلب</button>
          </div>
        </div>
      </div>
    `,
  );

  qs("#copyAddr").addEventListener("click", async () => {
    const c = order.customer || {};
    const txt = `الاسم: ${c.name}\nالهاتف: ${c.phone}${c.phone2 ? " / " + c.phone2 : ""}\n${c.governorate} - ${c.area} - ${c.building}\n${c.address || ""}`.trim();
    await safeCopy(txt);
    alert("تم النسخ");
  });

  qs("#updateStatus").addEventListener("click", async () => {
    const status = qs("#nextStatus").value;
    try {
      await api(`/api/admin/orders/${encodeURIComponent(order.id)}/status`, {
        method: "PUT",
        body: JSON.stringify({ status }),
      });
      closeModal();
      await loadOrders();
      renderOrders();
    } catch (e) {
      alert(e.message || "حصل خطأ");
    }
  });

  qs("#deleteOrder").addEventListener("click", async () => {
    if (!confirm("هل تريد حذف هذا الطلب نهائيًا؟")) return;
    try {
      await api(`/api/admin/orders/${encodeURIComponent(order.id)}`, {
        method: "DELETE",
      });
      closeModal();
      await loadOrders();
      renderOrders();
    } catch (e) {
      alert(e.message || "حصل خطأ");
    }
  });
}

function openProductEditor(product) {
  const isEdit = !!product;
  const p = product || {
    name: "",
    description: "",
    visibility: "published",
    basePrice: 0,
    salePrice: null,
    sizes: [{ label: "M" }],
    cardImage: null,
    detailImages: [],
  };

  openModal(
    isEdit ? "تعديل منتج" : "إنشاء منتج جديد",
    `
      <div class="panel">
        <div class="field">
          <label>اسم المنتج</label>
          <input id="pName" value="${escapeAttr(p.name)}" />
        </div>
        <div class="field">
          <label>وصف المنتج</label>
          <textarea id="pDesc">${escapeHtml(p.description || "")}</textarea>
        </div>
        <div class="grid2">
          <div class="field" style="margin:0">
            <label>السعر الأساسي (EGP)</label>
            <input id="pBase" inputmode="numeric" value="${escapeAttr(p.basePrice || "")}" placeholder="مثال: 799" />
          </div>
          <div class="field" style="margin:0">
            <label>سعر التخفيض (اختياري)</label>
            <input id="pSale" inputmode="numeric" value="${escapeAttr(p.salePrice || "")}" placeholder="مثال: 699" />
          </div>
        </div>
        <div class="field">
          <label>الحالة</label>
          <select id="pVis">
            <option value="published" ${p.visibility === "published" ? "selected" : ""}>منشور</option>
            <option value="draft" ${p.visibility === "draft" ? "selected" : ""}>مسودة</option>
            <option value="hidden" ${p.visibility === "hidden" ? "selected" : ""}>مخفي</option>
          </select>
        </div>

        <div class="field">
          <label>المقاسات</label>
          <div id="sizesWrap"></div>
          <button id="addSize" class="btn" type="button" style="width:auto">+ إضافة مقاس</button>
        </div>

        <div class="field">
          <label>صورة البطاقة</label>
          <input id="cardImg" type="file" accept="image/*" />
          <div class="mini">اختياري، لكن يفضل 3:4</div>
          <div id="cardPrev" class="muted-box" style="margin-top:10px">${p.cardImage ? `<img alt="" src="${escapeAttr(p.cardImage)}" style="width:160px; border-radius:16px; border:1px solid rgba(255,255,255,0.12)"/>` : "لا توجد صورة"}</div>
        </div>

        <div class="field">
          <label>صور التفاصيل (حتى 4)</label>
          <input id="detailImgs" type="file" accept="image/*" multiple />
          <div id="detailPrev" class="muted-box" style="margin-top:10px; display:flex; gap:10px; flex-wrap:wrap">
            ${(p.detailImages || [])
              .slice(0, 4)
              .map(
                (src) =>
                  `<img alt="" src="${escapeAttr(src)}" style="width:88px; height:88px; object-fit:cover; border-radius:16px; border:1px solid rgba(255,255,255,0.12)"/>`,
              )
              .join("") || "لا توجد صور"}
          </div>
        </div>

        <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:14px">
          <button id="savePub" class="btn" type="button" style="width:auto">${isEdit ? "حفظ" : "حفظ ونشر"}</button>
          <button id="saveDraft" class="btn" type="button" style="width:auto">حفظ كمسودة</button>
          <button id="cancel" class="btn danger" type="button" style="width:auto">إلغاء</button>
        </div>
      </div>
    `,
  );

  const sizesWrap = qs("#sizesWrap");
  let sizes = (p.sizes || []).map((s) => ({ ...s }));
  let cardImageDataUrl = "";
  let detailImageDataUrls = [];

  renderSizes();

  qs("#addSize").addEventListener("click", () => {
    sizes.push({ label: "" });
    renderSizes();
  });

  qs("#cardImg").addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    cardImageDataUrl = await bytesToDataUrl(f);
    qs("#cardPrev").innerHTML = `<img alt="" src="${escapeAttr(cardImageDataUrl)}" style="width:160px; border-radius:16px; border:1px solid rgba(255,255,255,0.12)"/>`;
  });

  qs("#detailImgs").addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []).slice(0, 4);
    detailImageDataUrls = [];
    for (const f of files) detailImageDataUrls.push(await bytesToDataUrl(f));
    qs("#detailPrev").innerHTML = detailImageDataUrls
      .map(
        (src) =>
          `<img alt="" src="${escapeAttr(src)}" style="width:88px; height:88px; object-fit:cover; border-radius:16px; border:1px solid rgba(255,255,255,0.12)"/>`,
      )
      .join("");
  });

  qs("#cancel").addEventListener("click", closeModal);
  qs("#savePub").addEventListener("click", () => save("published"));
  qs("#saveDraft").addEventListener("click", () => save("draft"));

  async function save(visibility) {
    const payload = {
      name: qs("#pName").value.trim(),
      description: qs("#pDesc").value.trim(),
      visibility,
      basePrice: Number(qs("#pBase").value),
      salePrice: qs("#pSale").value.trim(),
      sizes: collectSizes(),
      cardImageDataUrl: cardImageDataUrl || "",
      detailImageDataUrls,
    };
    try {
      if (isEdit) {
        const data = await api(`/api/admin/products/${encodeURIComponent(p.id)}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        replaceProduct(data.product);
      } else {
        const data = await api("/api/admin/products", { method: "POST", body: JSON.stringify(payload) });
        state.products.unshift(data.product);
      }
      closeModal();
      renderProducts();
    } catch (e) {
      alert(e.message || "خطأ في الحفظ");
    }
  }

  function collectSizes() {
    const rows = qsa("[data-size-row]", sizesWrap);
    const out = [];
    for (const r of rows) {
      const label = qs("[data-f=label]", r).value.trim();
      out.push(label);
    }
    return out;
  }

  function renderSizes() {
    sizesWrap.innerHTML = sizes
      .map(
        (s, i) => `
        <div data-size-row class="panel" style="margin-top:10px; padding:12px">
          <div class="field" style="margin:0">
            <label>المقاس</label>
            <input data-f="label" value="${escapeAttr(s.label || "")}" placeholder="مثال: XL" />
          </div>
          <button class="btn danger" data-del="${i}" type="button" style="width:auto; margin-top:10px">حذف المقاس</button>
        </div>
      `,
      )
      .join("");
    sizesWrap.onclick = (e) => {
      const b = e.target.closest("button[data-del]");
      if (!b) return;
      const idx = Number(b.getAttribute("data-del"));
      sizes.splice(idx, 1);
      if (sizes.length === 0) sizes.push({ label: "" });
      renderSizes();
    };
  }
}

async function deleteProduct(p) {
  if (!confirm("حذف المنتج؟")) return;
  try {
    await api(`/api/admin/products/${encodeURIComponent(p.id)}`, { method: "DELETE" });
    state.products = state.products.filter((x) => x.id !== p.id);
    renderProducts();
  } catch (e) {
    alert(e.message || "خطأ");
  }
}

function replaceProduct(next) {
  const idx = state.products.findIndex((p) => p.id === next.id);
  if (idx >= 0) state.products[idx] = next;
}

function markBad(id, msg) {
  const el = qs(`#${id}`);
  if (!el) return;
  el.classList.add("bad");
  const err = qs(".err", el);
  if (err) err.textContent = msg || err.textContent;
}

function clearBad() {
  for (const el of document.querySelectorAll(".field.bad")) el.classList.remove("bad");
}

async function safeCopy(value) {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {}
  try {
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.focus();
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
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
