import { api, fmtEGP, getCart, qs, setCart } from "./app.js";
import { GOVERNORATES } from "./governorates.js";

const summaryEmpty = qs("#summaryEmpty");
const summaryList = qs("#summaryList");
const summaryTotal = qs("#summaryTotal");

const form = qs("#form");
const submitBtn = qs("#submitBtn");

const govSel = qs("#gov");

const confirmOverlay = qs("#confirm");
const swirl = qs("#swirl");
const okCard = qs("#okCard");
const okId = qs("#okId");
const checkPath = qs("#checkPath");
const copyBtn = qs("#copyBtn");

boot();

function boot() {
  govSel.innerHTML = `<option value="">اختر</option>` + GOVERNORATES.map((g) => `<option value="${escapeAttr(g)}">${escapeHtml(g)}</option>`).join("");

  renderSummary().catch(() => {});
  form.addEventListener("submit", onSubmit);

  copyBtn.addEventListener("click", () => {
    const orderId = okId.textContent.trim();
    if (!orderId) return;
    navigator.clipboard.writeText(orderId).then(() => {
      copyBtn.textContent = "✓ تم النسخ!";
      copyBtn.classList.add("copied");
      setTimeout(() => {
        copyBtn.textContent = "📋 نسخ رقم الطلب";
        copyBtn.classList.remove("copied");
      }, 2000);
    }).catch(() => {
      copyBtn.textContent = "✓ تم النسخ!";
      copyBtn.classList.add("copied");
      setTimeout(() => {
        copyBtn.textContent = "📋 نسخ رقم الطلب";
        copyBtn.classList.remove("copied");
      }, 2000);
    });
  });
}

async function renderSummary() {
  const cart = getCart();
  summaryList.innerHTML = "";
  summaryEmpty.style.display = cart.length ? "none" : "";

  let total = 0;
  let products = [];
  try {
    const data = await api("/api/products", { method: "GET" });
    products = data.products || [];
  } catch {
    products = [];
  }
  const byId = new Map(products.map((p) => [p.id, p]));

  for (const it of cart) {
    const p = byId.get(it.productId);
    const unit = p ? (p.salePrice || p.basePrice || 0) : 0;
    const line = unit * (it.qty || 1);
    total += line;

    const row = document.createElement("div");
    row.className = "cart-item";
    row.innerHTML = `
      ${p?.cardImage ? `<img alt="" src="${escapeAttr(p.cardImage)}" />` : `<div></div>`}
      <div>
        <h4>${escapeHtml(p?.name || "منتج")}</h4>
        <div class="meta">المقاس: ${escapeHtml(it.size)} • الكمية: ${it.qty || 1}</div>
      </div>
    `;
    summaryList.appendChild(row);
  }

  summaryTotal.textContent = fmtEGP(total);
}

async function onSubmit(e) {
  e.preventDefault();
  clearErrors();

  const cart = getCart();
  if (!cart.length) {
    markBad("fName", "السلة فارغة");
    return;
  }

  const customer = {
    name: qs("#name").value.trim(),
    phone: normalizePhone(qs("#phone").value),
    phone2: normalizePhone(qs("#phone2").value),
    governorate: govSel.value.trim(),
    area: qs("#area").value.trim(),
    building: qs("#building").value.trim(),
    address: qs("#address").value.trim(),
  };

  const ok = validate(customer);
  if (!ok) return;

  submitBtn.disabled = true;
  submitBtn.textContent = "جاري التأكيد...";
  try {
    const data = await api("/api/orders", {
      method: "POST",
      body: JSON.stringify({ cart, customer }),
    });
    setCart([]);
    await playConfirm(String(data.orderId || ""));
  } catch (err) {
    alert(err.message || "حصل خطأ");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "✓ تأكيد الطلب";
  }
}

function validate(c) {
  if (c.name.split(/\s+/).filter(Boolean).length < 3) return markBad("fName");
  if (!/^01[0-9]{9}$/.test(c.phone)) return markBad("fPhone");
  if (c.phone2 && !/^01[0-9]{9}$/.test(c.phone2)) return markBad("fPhone2");
  if (!c.governorate) return markBad("fGov");
  if (!c.area) return markBad("fArea");
  if (!c.building) return markBad("fBuilding");
  return true;
}

function markBad(id, msg) {
  const el = qs(`#${id}`);
  if (!el) return false;
  el.classList.add("bad");
  if (msg) {
    const err = qs(".err", el);
    if (err) err.textContent = msg;
  }
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  return false;
}

function clearErrors() {
  for (const el of document.querySelectorAll(".field.bad")) el.classList.remove("bad");
}

async function playConfirm(orderId) {
  okId.textContent = orderId;
  confirmOverlay.classList.add("show");

  // Stage 1: swirl particles
  swirl.innerHTML = "";
  const particles = [];
  const count = 36;
  for (let i = 0; i < count; i++) {
    const p = document.createElement("div");
    p.className = "particle";
    swirl.appendChild(p);
    particles.push(p);
  }

  const start = performance.now();
  const dur = 1400;
  await animateFrame((now) => {
    const t = Math.min(1, (now - start) / dur);
    const ease = t * t * (3 - 2 * t);
    const r = 140 - ease * 110;
    const spin = ease * 10;
    for (let i = 0; i < particles.length; i++) {
      const a = (i / particles.length) * Math.PI * 2 + spin;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      const s = 0.6 + (1 - ease) * 0.6;
      particles[i].style.transform = `translate(${x}px, ${y}px) scale(${s})`;
      particles[i].style.opacity = String(0.25 + (1 - ease) * 0.75);
    }
    return t >= 1;
  });

  // Stage 2: fade particles out, show card
  for (const p of particles) p.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 420, fill: "forwards" });
  await wait(240);

  okCard.animate(
    [
      { opacity: 0, transform: "translateY(12px)" },
      { opacity: 1, transform: "translateY(0px)" },
    ],
    { duration: 420, easing: "cubic-bezier(.2,.9,.2,1)", fill: "forwards" },
  );
  okCard.style.opacity = "1";
  okCard.style.transform = "translateY(0)";

  // Stroke check
  checkPath.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 520, fill: "forwards" });
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function animateFrame(fn) {
  return new Promise((resolve) => {
    function tick(now) {
      const done = fn(now);
      if (done) resolve();
      else requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
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
