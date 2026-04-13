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
  govSel.innerHTML =
    `<option value="">اختر</option>` +
    GOVERNORATES.map((g) => `<option value="${escapeAttr(g)}">${escapeHtml(g)}</option>`).join("");

  renderSummary().catch(() => {});
  form.addEventListener("submit", onSubmit);

  copyBtn?.addEventListener("click", async () => {
    const orderId = okId.textContent.trim();
    if (!orderId) return;
    const copied = await copyText(orderId);
    copyBtn.textContent = copied ? "تم النسخ" : "انسخ يدويًا";
    copyBtn.classList.add("copied");
    setTimeout(() => {
      copyBtn.textContent = "نسخ رقم الطلب";
      copyBtn.classList.remove("copied");
    }, 1800);
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

  for (const item of cart) {
    const product = byId.get(item.productId);
    const unit = product ? product.salePrice || product.basePrice || 0 : 0;
    const line = unit * (item.qty || 1);
    total += line;

    const row = document.createElement("div");
    row.className = "cart-item";
    row.innerHTML = `
      ${product?.cardImage ? `<img alt="" src="${escapeAttr(product.cardImage)}" />` : `<div></div>`}
      <div>
        <h4>${escapeHtml(product?.name || "منتج")}</h4>
        <div class="meta">المقاس: ${escapeHtml(item.size)} • الكمية: ${item.qty || 1}</div>
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

  if (!validate(customer)) return;

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
    submitBtn.textContent = "تأكيد الطلب";
  }
}

function validate(customer) {
  if (customer.name.split(/\s+/).filter(Boolean).length < 3) return markBad("fName");
  if (!/^01[0-9]{9}$/.test(customer.phone)) return markBad("fPhone");
  if (customer.phone2 && !/^01[0-9]{9}$/.test(customer.phone2)) return markBad("fPhone2");
  if (!customer.governorate) return markBad("fGov");
  if (!customer.area) return markBad("fArea");
  if (!customer.building) return markBad("fBuilding");
  return true;
}

function markBad(id, msg) {
  const field = qs(`#${id}`);
  if (!field) return false;
  field.classList.add("bad");
  if (msg) {
    const err = qs(".err", field);
    if (err) err.textContent = msg;
  }
  field.scrollIntoView({ behavior: "smooth", block: "center" });
  return false;
}

function clearErrors() {
  for (const el of document.querySelectorAll(".field.bad")) el.classList.remove("bad");
}

async function playConfirm(orderId) {
  okId.textContent = orderId;
  confirmOverlay.classList.add("show");

  swirl.innerHTML = "";
  const particles = [];
  const count = 36;
  for (let i = 0; i < count; i++) {
    const particle = document.createElement("div");
    particle.className = "particle";
    swirl.appendChild(particle);
    particles.push(particle);
  }

  const start = performance.now();
  const duration = 1400;
  await animateFrame((now) => {
    const t = Math.min(1, (now - start) / duration);
    const ease = t * t * (3 - 2 * t);
    const radius = 140 - ease * 110;
    const spin = ease * 10;
    for (let i = 0; i < particles.length; i++) {
      const angle = (i / particles.length) * Math.PI * 2 + spin;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      const scale = 0.6 + (1 - ease) * 0.6;
      particles[i].style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
      particles[i].style.opacity = String(0.25 + (1 - ease) * 0.75);
    }
    return t >= 1;
  });

  for (const particle of particles) {
    particle.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 420,
      fill: "forwards",
    });
  }
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

  checkPath.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], {
    duration: 520,
    fill: "forwards",
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function copyText(value) {
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
    area.setSelectionRange(0, value.length);
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

