/* İmza Filigranı — tamamen tarayıcıda çalışır, hiçbir dosya gönderilmez. */
(() => {
'use strict';

const { PDFDocument, rgb, pushGraphicsState, popGraphicsState, concatTransformationMatrix } = PDFLib;
pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
const PDFJS_OPT = { isEvalSupported: false, standardFontDataUrl: 'vendor/standard_fonts/', disableFontFace: true };

const $ = (id) => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const MARKER_BAS = '<!-- filigran:imza -->';
const MARKER_SON = '<!-- /filigran:imza -->';
const KENAR = 0.04;   // sayfa kenarından boşluk (kısa kenarın oranı)

/* ------------------------------------------------------------------ dil */
let dil = localStorage.getItem('dil') || ((navigator.language || '').toLowerCase().startsWith('tr') ? 'tr' : 'en');
const t = (k, ...a) => { const v = (METIN[dil] && METIN[dil][k]) ?? METIN.tr[k] ?? k; return typeof v === 'function' ? v(...a) : v; };
function diliUygula() {
  document.documentElement.lang = dil;
  document.querySelectorAll('[data-i18n]').forEach(e => { e.textContent = t(e.dataset.i18n); });
  document.querySelectorAll('[data-i18n-title]').forEach(e => { e.title = t(e.dataset.i18nTitle); });
  document.querySelectorAll('[data-i18n-ph]').forEach(e => { e.placeholder = t(e.dataset.i18nPh); });
  document.querySelectorAll('[data-i18n-aria]').forEach(e => { e.setAttribute('aria-label', t(e.dataset.i18nAria)); });
  document.querySelectorAll('.dil-btn').forEach(b => b.classList.toggle('aktif', b.dataset.dil === dil));
  imzaBilgisi(); listeyiCiz(); karsilamaYenile();
}
document.querySelectorAll('.dil-btn').forEach(b => b.onclick = () => { dil = b.dataset.dil; localStorage.setItem('dil', dil); diliUygula(); });

/* ------------------------------------------------------------------ tema / panel / rehber */
function temaUygula(tm) { document.documentElement.dataset.theme = tm; localStorage.setItem('tema', tm); }
temaUygula(localStorage.getItem('tema') || 'light');
$('tema').onclick = () => temaUygula(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
$('panel-ac').onclick = () => { document.body.classList.toggle('panel-kapali'); setTimeout(onizlemeOlcekle, 320); };
$('yardim-ac').onclick = () => { $('rehber').hidden = false; };
$('rehber-kapat').onclick = () => { $('rehber').hidden = true; localStorage.setItem('rehber-goruldu', '1'); };
document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!$('rehber').hidden) $('rehber-kapat').click(); if (!$('ciz-modal').hidden) $('ciz-modal').hidden = true; } });

let toastZ;
function bildir(m, bilgi) { const e = $('toast'); e.textContent = m; e.className = 'toast' + (bilgi ? ' bilgi' : ''); e.hidden = false; clearTimeout(toastZ); toastZ = setTimeout(() => e.hidden = true, 4200); }

/* ------------------------------------------------------------------ durum */
const durum = {
  sig: null,           // {kind:'vector',paths,box} | {kind:'raster',mask,w,h}
  mod: 'pdf',
  dosyalar: [], secili: 0,
  pos: { x: 0.5, y: 0.5 },
  onizlemeDoc: null, onizlemeSayfa: 1, onizlemeKoyu: false,
  sonuclar: [],
};

function ayar() {
  return {
    opaklik: +$('opak').value / 100,
    genislik: +$('gen').value / 100,
    aciYatay: +$('aci-y').value,   // derece, + = yukarı eğim (saat yönünün tersi)
    aciDikey: +$('aci-d').value,
    renk: $('renk').value,
    otoKoyu: $('oto-koyu').checked,
    atla: sayfaListesi($('atla').value),
    pos: { ...durum.pos },
  };
}
function sayfaListesi(metin) {
  const out = new Set();
  for (let p of (metin || '').split(',')) {
    p = p.trim();
    const m = p.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) { for (let i = +m[1]; i <= +m[2] && i < 100000; i++) out.add(i); }
    else if (/^\d+$/.test(p)) out.add(+p);
  }
  return out;
}

/* ------------------------------------------------------- imza: SVG okuma */
const CIZIM_ETIKETLERI = new Set(['rect','circle','ellipse','line','polyline','polygon','text','image','use','foreignobject','style','script']);
function stilDegeri(el, ad) {
  const st = el.getAttribute && el.getAttribute('style');
  if (st) { const m = st.split(';').map(s => s.trim()).find(s => s.toLowerCase().startsWith(ad + ':')); if (m) return m.slice(ad.length + 1).trim(); }
  const a = el.getAttribute && el.getAttribute(ad);
  return a != null && a !== '' ? a.trim() : null;
}
function kalitilmis(el, ad) {
  for (let e = el; e && e.nodeType === 1; e = e.parentNode) { const v = stilDegeri(e, ad); if (v != null && v !== 'inherit') return v; }
  return null;
}
/** Yalnız <path> içeren SVG → vektör imza; aksi halde null (rasterleştirilecek). */
function svgVektor(metin) {
  const doc = new DOMParser().parseFromString(metin, 'image/svg+xml');
  if (doc.querySelector('parsererror')) throw new Error(t('eSvgRead'));
  const kok = doc.documentElement;
  if (!kok || kok.localName.toLowerCase() !== 'svg') throw new Error(t('eNotSvg'));
  const yollar = []; let raster = false;
  const gez = (el) => {
    for (const c of el.children) {
      const ad = c.localName.toLowerCase();
      if (CIZIM_ETIKETLERI.has(ad) || c.getAttribute('class') || (c.getAttribute('transform') || '').trim()) { raster = true; return; }
      if (ad === 'path') {
        const d = c.getAttribute('d'); if (!d) continue;
        const fill = kalitilmis(c, 'fill'), stroke = kalitilmis(c, 'stroke');
        const sw = parseFloat(kalitilmis(c, 'stroke-width') || '1') || 1;
        yollar.push({ d, fill: fill == null ? true : fill.toLowerCase() !== 'none', stroke: stroke != null && stroke.toLowerCase() !== 'none', sw });
      } else if (ad === 'g') gez(c);
    }
  };
  if ((kok.getAttribute('transform') || '').trim()) raster = true;
  gez(kok);
  if (raster || !yollar.length) return null;
  return { kind: 'vector', paths: yollar, box: yolKutusu(yollar) };
}
function yolKutusu(yollar) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('style', 'position:absolute;left:-9999px;top:0;width:0;height:0;visibility:hidden');
  const hepsi = yollar.map(y => { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', y.d); svg.appendChild(p); return p; });
  document.body.appendChild(svg);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  hepsi.forEach(p => { const b = p.getBBox(); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.width); y1 = Math.max(y1, b.y + b.height); });
  svg.remove();
  if (!isFinite(x0) || x1 <= x0 || y1 <= y0) throw new Error(t('eSigSize'));
  const pay = Math.max(2, ...yollar.map(y => (y.stroke || !y.fill ? y.sw / 2 : 0))) + 2;
  return { x: x0 - pay, y: y0 - pay, w: x1 - x0 + 2 * pay, h: y1 - y0 + 2 * pay };
}

/* ----------------------------------------------- imza: raster (PNG/JPG) */
function rasterIsle(kaynak) {
  const w = kaynak.width, h = kaynak.height;
  const d = kaynak.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data, n = w * h;
  let seffaf = 0, top = 0;
  for (let i = 0; i < n; i++) { if (d[i*4+3] < 200) seffaf++; top += 0.2126*d[i*4] + 0.7152*d[i*4+1] + 0.0722*d[i*4+2]; }
  const alfali = seffaf / n > 0.02, ters = !alfali && top / n < 110;   // koyu zeminde açık mürekkep
  const a = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) {
    if (alfali) { a[i] = d[i*4+3]; continue; }
    const lum = 0.2126*d[i*4] + 0.7152*d[i*4+1] + 0.0722*d[i*4+2];
    a[i] = Math.max(0, Math.min(255, ((ters ? lum : 255 - lum) - 28) * 255 / 190));
  }
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (a[y*w+x] > 12) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) throw new Error(t('eEmpty'));
  const pay = Math.round(Math.max(x1 - x0, y1 - y0) * 0.02) + 2;
  x0 = Math.max(0, x0 - pay); y0 = Math.max(0, y0 - pay); x1 = Math.min(w - 1, x1 + pay); y1 = Math.min(h - 1, y1 + pay);
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const c = document.createElement('canvas'); c.width = cw; c.height = ch;
  const cc = c.getContext('2d'), od = cc.createImageData(cw, ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { const o = (y*cw+x)*4; od.data[o] = od.data[o+1] = od.data[o+2] = 255; od.data[o+3] = a[(y0+y)*w + x0 + x]; }
  cc.putImageData(od, 0, 0);
  return { kind: 'raster', mask: c, w: cw, h: ch };
}
const gorselYukle = (url) => new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => no(new Error(t('eImg'))); im.src = url; });

async function dosyadanImza(dosya) {
  const ad = dosya.name.toLowerCase();
  if (dosya.size > 25 * 1024 * 1024) throw new Error(t('eBig'));
  if (ad.endsWith('.svg') || dosya.type === 'image/svg+xml') {
    const metin = await dosya.text();
    const v = svgVektor(metin); if (v) return v;
    const kok = new DOMParser().parseFromString(metin, 'image/svg+xml').documentElement;
    const vb = (kok.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
    const gw = parseFloat(kok.getAttribute('width')) || vb[2] || 1000, gh = parseFloat(kok.getAttribute('height')) || vb[3] || 500;
    const k = 2400 / Math.max(gw, gh);
    const url = URL.createObjectURL(new Blob([metin], { type: 'image/svg+xml' }));
    try { const im = await gorselYukle(url); const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(gw*k)); c.height = Math.max(1, Math.round(gh*k)); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); return rasterIsle(c); }
    finally { URL.revokeObjectURL(url); }
  }
  const url = URL.createObjectURL(dosya);
  try {
    const im = await gorselYukle(url), k = Math.min(1, 3000 / Math.max(im.naturalWidth, im.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.round(im.naturalWidth*k); c.height = Math.round(im.naturalHeight*k);
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); return rasterIsle(c);
  } finally { URL.revokeObjectURL(url); }
}

/* ---------------------------------------------- imza: çıktı biçimleri */
const imzaBoyut = (sig) => sig.kind === 'vector' ? { w: sig.box.w, h: sig.box.h } : { w: sig.w, h: sig.h };
function renkli(sig, renk) {
  const c = document.createElement('canvas'); c.width = sig.w; c.height = sig.h;
  const x = c.getContext('2d'); x.drawImage(sig.mask, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = renk; x.fillRect(0, 0, c.width, c.height);
  return c;
}
function svgMetni(sig, renk, ek = '') {
  const b = sig.box;
  const yollar = sig.paths.map(y => `<path d="${y.d}" fill="${y.fill ? renk : 'none'}" stroke="${y.stroke || !y.fill ? renk : 'none'}" stroke-width="${y.sw}" stroke-linejoin="round" stroke-linecap="round"/>`).join('');
  return `<svg xmlns="${NS}" viewBox="${b.x} ${b.y} ${b.w} ${b.h}" ${ek}>${yollar}</svg>`;
}
function imzaElemani(sig, renk) {
  const kap = document.createElement('div');
  if (sig.kind === 'vector') kap.innerHTML = svgMetni(sig, renk);
  else { const im = new Image(); im.alt = ''; im.src = renkli(sig, renk).toDataURL('image/png'); kap.appendChild(im); }
  return kap.firstChild;
}

/* ---------------------------------------------------------- yerleşim */
const rad = (d) => d * Math.PI / 180;
function donukKutu(w, h, aci) { const c = Math.abs(Math.cos(rad(aci))), s = Math.abs(Math.sin(rad(aci))); return { w: w*c + h*s, h: w*s + h*c }; }
/** Ölçek: dönmüş kutu genişliği = genislik·W, yüksekliği ≤ %70·H. */
function olcek(sw, sh, aci, W, H, genislik) { const dk = donukKutu(sw, sh, aci); let s = genislik * W / dk.w; if (dk.h * s > 0.7 * H) s = 0.7 * H / dk.h; return s; }
const sinirla = (v, lo, hi) => lo > hi ? (lo + hi) / 2 : Math.min(Math.max(v, lo), hi);
/** Görünen sayfa ölçüsünde (y aşağı) imza merkezi ve ölçeği. pos: 0..1 (0=sol/üst, 1=sağ/alt), kenara taşmaz. */
function yerlesim(gW, gH, sw, sh, aci, genislik, pos) {
  const s = olcek(sw, sh, aci, gW, gH, genislik), dk = donukKutu(sw * s, sh * s, aci), m = KENAR * Math.min(gW, gH);
  return { s, cx: sinirla(pos.x * gW, m + dk.w / 2, gW - m - dk.w / 2), cy: sinirla(pos.y * gH, m + dk.h / 2, gH - m - dk.h / 2) };
}
/** Görünen (döndürülmüş) sayfadaki noktayı PDF kullanıcı koordinatına çevirir. */
function gorseldenPdf(vx, vy, rot, k) {
  switch (rot) {
    case 90:  return [k.x + vy, k.y + vx];
    case 180: return [k.x + k.width - vx, k.y + vy];
    case 270: return [k.x + k.width - vy, k.y + k.height - vx];
    default:  return [k.x + vx, k.y + k.height - vy];
  }
}

/* ---------------------------------------------------------- PDF basma */
async function koyuSayfalar(bayt) {
  const doc = await pdfjsLib.getDocument({ data: bayt.slice(0), ...PDFJS_OPT }).promise;
  const sonuc = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const sayfa = await doc.getPage(i), v0 = sayfa.getViewport({ scale: 1 });
      const vp = sayfa.getViewport({ scale: 70 / Math.max(v0.width, v0.height) });
      const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(vp.width)); c.height = Math.max(1, Math.round(vp.height));
      const x = c.getContext('2d', { willReadFrequently: true }); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
      await sayfa.render({ canvasContext: x, viewport: vp }).promise;
      const d = x.getImageData(0, 0, c.width, c.height).data; let tp = 0;
      for (let p = 0; p < d.length; p += 4) tp += 0.2126*d[p] + 0.7152*d[p+1] + 0.0722*d[p+2];
      sonuc.push(tp / (d.length / 4) < 110); sayfa.cleanup();
    }
  } finally { doc.destroy(); }
  return sonuc;
}
function hex(h) { const n = parseInt(h.slice(1), 16); return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); }

async function pdfDamgala(bayt, a, ilerle) {
  let belge;
  try { belge = await PDFDocument.load(bayt, { updateMetadata: false }); }
  catch (e) { throw new Error(/encrypt/i.test(e.message) ? t('eEnc') : t('ePdf')); }
  const sig = durum.sig, { w: sw, h: sh } = imzaBoyut(sig);
  let koyu = null;
  if (a.otoKoyu) { try { koyu = await koyuSayfalar(bayt); } catch (e) { koyu = null; } }
  const gorsel = {};
  const gorselGetir = async (renk) => {
    if (!gorsel[renk]) { const blob = await new Promise(r => renkli(sig, renk).toBlob(r, 'image/png')); gorsel[renk] = await belge.embedPng(new Uint8Array(await blob.arrayBuffer())); }
    return gorsel[renk];
  };
  const sayfalar = belge.getPages();
  for (let i = 0; i < sayfalar.length; i++) {
    ilerle && ilerle(i + 1, sayfalar.length);
    if (a.atla.has(i + 1)) continue;
    const sayfa = sayfalar[i];
    const rot = ((sayfa.getRotation().angle % 360) + 360) % 360;
    const kutu = sayfa.getCropBox();
    const gW = rot % 180 ? kutu.height : kutu.width, gH = rot % 180 ? kutu.width : kutu.height;   // kullanıcının gördüğü ölçü
    const aci = gH > gW ? a.aciDikey : a.aciYatay;
    const { s, cx, cy } = yerlesim(gW, gH, sw, sh, aci, a.genislik, a.pos);
    const [px, py] = gorseldenPdf(cx, cy, rot, kutu);
    const hexRenk = koyu && koyu[i] ? '#ffffff' : a.renk, renk = hex(hexRenk);
    const th = rad(aci + rot), cos = Math.cos(th), sin = Math.sin(th);
    sayfa.pushOperators(pushGraphicsState(), concatTransformationMatrix(cos, sin, -sin, cos, px, py));
    if (sig.kind === 'vector') {
      const b = sig.box, bx = b.x + b.w / 2, by = b.y + b.h / 2;
      for (const y of sig.paths) {
        const o = { x: -s * bx, y: s * by, scale: s, opacity: a.opaklik, borderOpacity: a.opaklik };
        if (y.fill) o.color = renk;
        if (y.stroke || !y.fill) { o.borderColor = renk; o.borderWidth = y.sw; }
        sayfa.drawSvgPath(y.d, o);
      }
    } else {
      const im = await gorselGetir(hexRenk);
      sayfa.drawImage(im, { x: -sw * s / 2, y: -sh * s / 2, width: sw * s, height: sh * s, opacity: a.opaklik });
    }
    sayfa.pushOperators(popGraphicsState());
    if (i % 8 === 7) await new Promise(r => setTimeout(r));
  }
  return await belge.save();
}

/* ------------------------------------------------------------ HTML basma */
function htmlBlogu(a) {
  const sig = durum.sig, { w, h } = imzaBoyut(sig);
  const parca = (aci, sinif) => {
    const dk = donukKutu(w, h, aci);
    const rw = `min(${(a.genislik * 100).toFixed(2)}vw,1100px,${(70 * dk.w / dk.h).toFixed(2)}vh)`;   // dönmüş kutu genişliği
    const oranH = (dk.h / dk.w).toFixed(4), oranW = (w / dk.w).toFixed(4);
    const sol = `clamp(calc(var(--rw)/2 + 4vmin),${(a.pos.x * 100).toFixed(2)}%,calc(100% - var(--rw)/2 - 4vmin))`;
    const ust = `clamp(calc(var(--rw)*${oranH}/2 + 4vmin),${(a.pos.y * 100).toFixed(2)}%,calc(100% - var(--rw)*${oranH}/2 - 4vmin))`;
    const stil = `--rw:${rw};position:absolute;left:${sol};top:${ust};width:calc(var(--rw)*${oranW});height:auto;transform:translate(-50%,-50%) rotate(${-aci}deg)`;
    if (sig.kind === 'vector') return svgMetni(sig, '#ffffff', `class="${sinif}" role="presentation" focusable="false" style="${stil}"`);
    return `<img class="${sinif}" alt="" src="${renkli(sig, '#ffffff').toDataURL('image/png')}" style="${stil}">`;
  };
  return `${MARKER_BAS}
<style>
.imza-filigran{position:fixed;inset:0;pointer-events:none;user-select:none;-webkit-user-select:none;z-index:2147483647;opacity:${a.opaklik};mix-blend-mode:difference}
.imza-filigran .imza-dikey{display:none}
@media (orientation:portrait){.imza-filigran .imza-yatay{display:none}.imza-filigran .imza-dikey{display:block}}
</style>
<div class="imza-filigran" aria-hidden="true">${parca(a.aciYatay, 'imza-yatay')}${parca(a.aciDikey, 'imza-dikey')}</div>
<script>(function(){var t=function(c){return!c||c==='transparent'||/rgba\\(.*,\\s*0\\)$/.test(c)},h=document.documentElement,b=document.body;if(t(getComputedStyle(h).backgroundColor)&&(!b||t(getComputedStyle(b).backgroundColor)))h.style.backgroundColor='#fff'})()</script>
${MARKER_SON}`;
}
function htmlDamgala(metin, blok) {
  const kac = (s) => s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
  metin = metin.replace(new RegExp(kac(MARKER_BAS) + '[\\s\\S]*?' + kac(MARKER_SON) + '\\s*'), '');
  const son = metin.search(/<\/body\s*>/i);
  return son >= 0 ? metin.slice(0, son) + blok + '\n' + metin.slice(son) : metin + '\n' + blok + '\n';
}

/* ------------------------------------------------------------ ZIP (depolu) */
const CRC = (() => { const tb = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; tb[n] = c >>> 0; } return tb; })();
function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
async function zipYap(dosyalar) {
  const enc = new TextEncoder(), parcalar = [], merkez = [], kullanilan = new Set(); let ofset = 0;
  for (const f of dosyalar) {
    let ad = f.ad, n = 2; while (kullanilan.has(ad)) ad = f.ad.replace(/(\.[^.]*)?$/, ` (${n++})$1`); kullanilan.add(ad);
    const veri = new Uint8Array(await f.blob.arrayBuffer()), adB = enc.encode(ad), crc = crc32(veri);
    const L = new DataView(new ArrayBuffer(30));
    L.setUint32(0, 0x04034b50, true); L.setUint16(4, 20, true); L.setUint16(6, 0x0800, true); L.setUint16(12, 0x21, true);
    L.setUint32(14, crc, true); L.setUint32(18, veri.length, true); L.setUint32(22, veri.length, true); L.setUint16(26, adB.length, true);
    parcalar.push(L.buffer, adB, veri);
    const M = new DataView(new ArrayBuffer(46));
    M.setUint32(0, 0x02014b50, true); M.setUint16(4, 20, true); M.setUint16(6, 20, true); M.setUint16(8, 0x0800, true); M.setUint16(14, 0x21, true);
    M.setUint32(16, crc, true); M.setUint32(20, veri.length, true); M.setUint32(24, veri.length, true); M.setUint16(28, adB.length, true); M.setUint32(42, ofset, true);
    merkez.push(M.buffer, adB); ofset += 30 + adB.length + veri.length;
  }
  let mb = 0; merkez.forEach(p => mb += p.byteLength);
  const E = new DataView(new ArrayBuffer(22));
  E.setUint32(0, 0x06054b50, true); E.setUint16(8, dosyalar.length, true); E.setUint16(10, dosyalar.length, true); E.setUint32(12, mb, true); E.setUint32(16, ofset, true);
  return new Blob([...parcalar, ...merkez, E.buffer], { type: 'application/zip' });
}

/* ================================================================== ARAYÜZ */
const boyutMetni = (b) => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';

function imzaBilgisi() {
  const dama = $('imza-dama'); dama.textContent = '';
  if (!durum.sig) { const s = document.createElement('span'); s.className = 'bos-yazi'; s.textContent = t('noSig'); dama.appendChild(s); $('imza-tur').textContent = ''; return; }
  dama.appendChild(imzaElemani(durum.sig, '#000000'));
  $('imza-tur').textContent = durum.sig.kind === 'vector' ? t('sigVector') : t('sigRaster');
}
function imzaAyarla(sig) { durum.sig = sig; imzaBilgisi(); if ($('hatirla').checked) hatirlaKaydet(); guncelle(); }

function hatirlaKaydet() {
  try {
    const sig = durum.sig; if (!sig) return;
    localStorage.setItem('imza-v1', JSON.stringify(sig.kind === 'vector' ? { kind: 'vector', paths: sig.paths, box: sig.box } : { kind: 'raster', png: sig.mask.toDataURL('image/png') }));
  } catch (e) { /* kota */ }
}
async function hatirlaYukle() {
  try {
    const s = localStorage.getItem('imza-v1'); if (!s) return;
    const o = JSON.parse(s);
    if (o.kind === 'vector') durum.sig = o;
    else { const im = await gorselYukle(o.png); const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; c.getContext('2d').drawImage(im, 0, 0); durum.sig = { kind: 'raster', mask: c, w: c.width, h: c.height }; }
    $('hatirla').checked = true; imzaBilgisi(); guncelle();
  } catch (e) { localStorage.removeItem('imza-v1'); }
}
$('hatirla').addEventListener('change', () => { if ($('hatirla').checked) hatirlaKaydet(); else localStorage.removeItem('imza-v1'); });

/* --- imza yükle --- */
$('imza-yukle').onclick = () => $('imza-dosya').click();
$('imza-dosya').addEventListener('change', async () => { const f = $('imza-dosya').files[0]; $('imza-dosya').value = ''; if (f) await imzaDosyasi(f); });
async function imzaDosyasi(f) { try { imzaAyarla(await dosyadanImza(f)); } catch (e) { bildir(e.message || t('eGeneric')); } }

/* --- imza çiz --- */
(() => {
  const c = $('pad'), x = c.getContext('2d'); let cizgiler = [], aktif = null;
  const nokta = (e) => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * c.width / r.width, (e.clientY - r.top) * c.height / r.height]; };
  const yenile = () => {
    x.clearRect(0, 0, c.width, c.height); x.strokeStyle = '#111'; x.lineWidth = 4.5; x.lineCap = x.lineJoin = 'round';
    for (const l of cizgiler) { x.beginPath(); l.forEach((p, i) => i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1])); if (l.length === 1) x.lineTo(l[0][0] + .01, l[0][1]); x.stroke(); }
    $('pad-kap').classList.toggle('dolu', cizgiler.length > 0);
  };
  c.addEventListener('pointerdown', e => { c.setPointerCapture(e.pointerId); aktif = [nokta(e)]; cizgiler.push(aktif); yenile(); });
  c.addEventListener('pointermove', e => { if (aktif) { aktif.push(nokta(e)); yenile(); } });
  c.addEventListener('pointerup', () => aktif = null); c.addEventListener('pointercancel', () => aktif = null);
  $('imza-ciz').onclick = () => { $('ciz-modal').hidden = false; yenile(); };
  $('pad-iptal').onclick = () => { $('ciz-modal').hidden = true; };
  $('pad-geri').onclick = () => { cizgiler.pop(); yenile(); };
  $('pad-temizle').onclick = () => { cizgiler = []; yenile(); };
  $('pad-kullan').onclick = () => {
    if (!cizgiler.length) { bildir(t('eDrawFirst')); return; }
    const f = (v) => v.toFixed(1);
    const yollar = cizgiler.map(l => {
      let d = `M${f(l[0][0])} ${f(l[0][1])}`;
      if (l.length === 1) d += ' l0.01 0';
      else if (l.length === 2) d += ` L${f(l[1][0])} ${f(l[1][1])}`;
      else { for (let i = 1; i < l.length - 1; i++) d += ` Q${f(l[i][0])} ${f(l[i][1])} ${f((l[i][0] + l[i+1][0]) / 2)} ${f((l[i][1] + l[i+1][1]) / 2)}`; d += ` L${f(l[l.length-1][0])} ${f(l[l.length-1][1])}`; }
      return { d, fill: false, stroke: true, sw: 4.5 };
    });
    try { imzaAyarla({ kind: 'vector', paths: yollar, box: yolKutusu(yollar) }); $('ciz-modal').hidden = true; } catch (e) { bildir(e.message); }
  };
})();

/* --- mod (PDF / HTML) --- */
$('mod-html').addEventListener('change', () => modDegistir($('mod-html').checked ? 'html' : 'pdf'));
function modDegistir(mod) {
  if (durum.mod !== mod) { durum.dosyalar = []; durum.secili = 0; }
  durum.mod = mod; $('mod-html').checked = mod === 'html'; temizleSonuc();
  $('dosya-sec').accept = mod === 'pdf' ? '.pdf,application/pdf' : '.html,.htm,text/html';
  document.querySelectorAll('.sadece-pdf').forEach(e => e.hidden = mod !== 'pdf');
  document.querySelectorAll('.sadece-html').forEach(e => e.hidden = mod !== 'html');
  listeyiCiz(); onizlemeYenile();
}

/* --- dosyalar --- */
$('dosya-ekle').onclick = () => $('dosya-sec').click();
$('dosya-sec').addEventListener('change', () => { belgeEkle([...$('dosya-sec').files]); $('dosya-sec').value = ''; });
function belgeEkle(liste) {
  const pdf = liste.filter(f => /\.pdf$/i.test(f.name)), html = liste.filter(f => /\.html?$/i.test(f.name));
  if (!pdf.length && !html.length) { bildir(durum.mod === 'pdf' ? t('eOnlyPdf') : t('eOnlyHtml')); return; }
  const istenen = pdf.length >= html.length ? 'pdf' : 'html';
  if (istenen !== durum.mod) modDegistir(istenen);
  const once = durum.dosyalar.length;
  durum.dosyalar.push(...(istenen === 'pdf' ? pdf : html));
  if (!once) durum.secili = 0;
  temizleSonuc(); listeyiCiz(); onizlemeYenile();
}
function listeyiCiz() {
  const ul = $('dosyalar'); ul.textContent = '';
  durum.dosyalar.forEach((f, i) => {
    const li = document.createElement('li'); if (i === durum.secili) li.className = 'secili';
    li.innerHTML = '<span class="ad"></span><span class="boy"></span><button type="button">×</button>';
    li.querySelector('.ad').textContent = f.name; li.querySelector('.boy').textContent = boyutMetni(f.size);
    const b = li.querySelector('button'); b.setAttribute('aria-label', t('removeFile')); b.title = t('removeFile');
    b.onclick = (e) => { e.stopPropagation(); durum.dosyalar.splice(i, 1); if (durum.secili >= durum.dosyalar.length) durum.secili = Math.max(0, durum.dosyalar.length - 1); temizleSonuc(); listeyiCiz(); onizlemeYenile(); };
    li.onclick = () => { if (durum.secili !== i) { durum.secili = i; listeyiCiz(); onizlemeYenile(); } };
    ul.appendChild(li);
  });
  guncelle();
}
$('temizle').onclick = () => { durum.dosyalar = []; durum.secili = 0; temizleSonuc(); listeyiCiz(); onizlemeYenile(); };

/* --- sürükle-bırak (tüm pencere, MeshTexture gibi) --- */
(() => {
  const perde = $('birak-perde'); let sayac = 0;
  const dosyaMi = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  const hedefTemizle = () => document.querySelectorAll('.birak-hedef.uzerinde').forEach(b => b.classList.remove('uzerinde'));
  const kapat = () => { sayac = 0; perde.hidden = true; hedefTemizle(); };
  window.addEventListener('dragenter', e => { if (!dosyaMi(e)) return; e.preventDefault(); sayac++; perde.hidden = false; });
  window.addEventListener('dragleave', e => { if (!dosyaMi(e)) return; if (--sayac <= 0) kapat(); });
  window.addEventListener('dragover', e => {
    if (!dosyaMi(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
    const h = e.target.closest && e.target.closest('.birak-hedef');
    document.querySelectorAll('.birak-hedef').forEach(b => b.classList.toggle('uzerinde', b === h));
  });
  window.addEventListener('drop', async e => {
    if (!dosyaMi(e)) return;
    e.preventDefault();
    const hedef = e.target.closest && e.target.closest('.birak-hedef');
    kapat();
    const liste = [...e.dataTransfer.files];
    const gorsel = (f) => /\.(svg|png|jpe?g|webp)$/i.test(f.name), belgeMi = (f) => /\.(pdf|html?)$/i.test(f.name);
    if (hedef && hedef.id === 'imza-yukle') { const f = liste.find(gorsel); if (f) await imzaDosyasi(f); else bildir(t('eImg')); return; }
    if (hedef && hedef.id === 'dosya-ekle') { belgeEkle(liste); return; }
    const img = liste.find(gorsel); if (img) await imzaDosyasi(img);
    const belge = liste.filter(belgeMi); if (belge.length) belgeEkle(belge);
    if (!img && !belge.length) bildir(t('eDropType'));
  });
})();

/* --- önizleme --- */
let onizSayac = 0;
function karsilamaYenile() {
  const k = $('karsilama'), gor = !$('sayfa-kap').hidden;
  k.hidden = gor && !!durum.sig;
  if (k.hidden) return;
  k.querySelector('p').textContent = durum.sig && !durum.dosyalar.length ? t('welcomeNoFile') : (!durum.sig && durum.dosyalar.length ? t('welcomeNoSig') : t('welcomeP'));
  k.style.opacity = gor ? '.92' : '1';
}
async function onizlemeYenile() {
  const bu = ++onizSayac;
  if (durum.onizlemeDoc) { try { durum.onizlemeDoc.destroy(); } catch (e) {} durum.onizlemeDoc = null; }
  $('gez').hidden = true;
  const kap = $('sayfa-kap'), c = $('sayfa-tuval');
  if (!durum.dosyalar.length) { kap.hidden = true; karsilamaYenile(); return; }
  if (durum.mod === 'html') {
    c.width = 1280; c.height = 800; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    $('tarayici-taklit').hidden = false; kap.hidden = false; durum.onizlemeKoyu = false;
    karsilamaYenile(); imzaUstuCiz(); return;
  }
  $('tarayici-taklit').hidden = true;
  try {
    const bayt = new Uint8Array(await durum.dosyalar[durum.secili].arrayBuffer());
    const doc = await pdfjsLib.getDocument({ data: bayt, ...PDFJS_OPT }).promise;
    if (bu !== onizSayac) { doc.destroy(); return; }
    durum.onizlemeDoc = doc; durum.onizlemeSayfa = 1;
    await sayfayiCiz();
  } catch (e) { kap.hidden = true; karsilamaYenile(); bildir(t('ePreview')); }
}
async function sayfayiCiz() {
  const doc = durum.onizlemeDoc; if (!doc) return;
  const bu = onizSayac;
  const sayfa = await doc.getPage(durum.onizlemeSayfa), v0 = sayfa.getViewport({ scale: 1 });
  const vp = sayfa.getViewport({ scale: Math.min(2.2, 1400 / Math.max(v0.width, v0.height)) });
  const c = $('sayfa-tuval'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  await sayfa.render({ canvasContext: x, viewport: vp }).promise;
  if (bu !== onizSayac) return;
  const d = x.getImageData(0, 0, c.width, c.height).data; let tp = 0, n = 0;
  for (let p = 0; p < d.length; p += 64) { tp += 0.2126*d[p] + 0.7152*d[p+1] + 0.0722*d[p+2]; n++; }
  durum.onizlemeKoyu = tp / n < 110;
  $('sayfa-kap').hidden = false; karsilamaYenile();
  $('gez').hidden = doc.numPages < 2; $('sayfa-no').textContent = `${durum.onizlemeSayfa} / ${doc.numPages}`;
  imzaUstuCiz();
}
$('onceki').onclick = () => { if (durum.onizlemeSayfa > 1) { durum.onizlemeSayfa--; sayfayiCiz(); } };
$('sonraki').onclick = () => { if (durum.onizlemeDoc && durum.onizlemeSayfa < durum.onizlemeDoc.numPages) { durum.onizlemeSayfa++; sayfayiCiz(); } };

let sonOnizleme = null;   // sürükleme için son yerleşim
function imzaUstuCiz() {
  const ust = $('ust-imza'), c = $('sayfa-tuval');
  ust.textContent = ''; sonOnizleme = null;
  if (!durum.sig || $('sayfa-kap').hidden) { ust.hidden = true; return; }
  const a = ayar(), cw = c.clientWidth, ch = c.clientHeight;
  if (!cw || !ch) { ust.hidden = true; return; }
  const aci = durum.mod === 'pdf' && ch > cw ? a.aciDikey : a.aciYatay;
  const { w, h } = imzaBoyut(durum.sig);
  const yer = yerlesim(cw, ch, w, h, aci, a.genislik, a.pos);
  const renk = durum.mod === 'html' ? '#000000' : (a.otoKoyu && durum.onizlemeKoyu ? '#ffffff' : a.renk);
  const el = imzaElemani(durum.sig, renk); el.classList.add('gorunur');
  ust.hidden = false;
  ust.classList.toggle('atlanan', durum.mod === 'pdf' && a.atla.has(durum.onizlemeSayfa));
  ust.style.setProperty('--op', Math.max(a.opaklik, 0.04));
  ust.style.width = (w * yer.s) + 'px';
  ust.style.left = (yer.cx - w * yer.s / 2) + 'px'; ust.style.top = (yer.cy - h * yer.s / 2) + 'px';
  ust.style.transform = `rotate(${-aci}deg)`;
  ust.appendChild(el);
  sonOnizleme = { cw, ch, cx: yer.cx, cy: yer.cy };
}
function onizlemeOlcekle() { imzaUstuCiz(); }
window.addEventListener('resize', onizlemeOlcekle);

/* --- konum: hazır + sürükle --- */
function konumIsaretle() {
  document.querySelectorAll('#konum-izgara button').forEach(b => {
    const [x, y] = b.dataset.k.split(',').map(Number);
    const on = Math.abs(x - durum.pos.x) < 1e-6 && Math.abs(y - durum.pos.y) < 1e-6;
    b.classList.toggle('aktif', on); b.setAttribute('aria-pressed', on);
  });
}
document.querySelectorAll('#konum-izgara button').forEach(b => b.addEventListener('click', () => {
  const [x, y] = b.dataset.k.split(',').map(Number);
  durum.pos = { x, y };
  const kose = !(x === 0.5 && y === 0.5);
  if (kose && +$('gen').value > 45) { $('gen').value = 30; ciktiGuncelle(); }      // köşeye büyük imza sığmaz
  konumIsaretle(); imzaUstuCiz(); localStorage.setItem('konum', JSON.stringify(durum.pos));
}));
(() => {
  const ust = $('ust-imza'); let surukle = null;
  ust.addEventListener('pointerdown', e => {
    if (!sonOnizleme) return;
    e.preventDefault(); ust.setPointerCapture(e.pointerId); ust.classList.add('surukleniyor');
    const r = $('sayfa-tuval').getBoundingClientRect();
    surukle = { r, dx: e.clientX - r.left - sonOnizleme.cx, dy: e.clientY - r.top - sonOnizleme.cy };
  });
  ust.addEventListener('pointermove', e => {
    if (!surukle) return;
    const { r, dx, dy } = surukle;
    durum.pos = { x: (e.clientX - r.left - dx) / r.width, y: (e.clientY - r.top - dy) / r.height };
    imzaUstuCiz();
    if (sonOnizleme) durum.pos = { x: sonOnizleme.cx / sonOnizleme.cw, y: sonOnizleme.cy / sonOnizleme.ch };   // sınıra yapıştır
    konumIsaretle();
  });
  const bitir = () => { if (!surukle) return; surukle = null; ust.classList.remove('surukleniyor'); localStorage.setItem('konum', JSON.stringify(durum.pos)); };
  ust.addEventListener('pointerup', bitir); ust.addEventListener('pointercancel', bitir);
  ust.addEventListener('wheel', e => { e.preventDefault(); const g = $('gen'); g.value = Math.min(100, Math.max(10, +g.value + (e.deltaY < 0 ? 2 : -2))); ciktiGuncelle(); imzaUstuCiz(); }, { passive: false });
  ust.addEventListener('keydown', e => {
    const adim = e.shiftKey ? 0.05 : 0.01, m = { ArrowLeft: [-adim, 0], ArrowRight: [adim, 0], ArrowUp: [0, -adim], ArrowDown: [0, adim] }[e.key];
    if (!m) return; e.preventDefault();
    durum.pos = { x: Math.min(1, Math.max(0, durum.pos.x + m[0])), y: Math.min(1, Math.max(0, durum.pos.y + m[1])) };
    imzaUstuCiz(); konumIsaretle(); localStorage.setItem('konum', JSON.stringify(durum.pos));
  });
})();

/* --- ayarlar --- */
function ciktiGuncelle() {
  $('o-opak').textContent = $('opak').value + '%'; $('o-gen').textContent = $('gen').value + '%';
  $('o-aci-y').textContent = $('aci-y').value + '°'; $('o-aci-d').textContent = $('aci-d').value + '°';
}
['opak','gen','aci-y','aci-d','renk','oto-koyu','atla'].forEach(id => $(id).addEventListener('input', () => { ciktiGuncelle(); imzaUstuCiz(); }));
function guncelle() { $('bas').disabled = !(durum.sig && durum.dosyalar.length); karsilamaYenile(); imzaUstuCiz(); }

/* --- imzala --- */
function temizleSonuc() { durum.sonuclar.forEach(s => s.url && URL.revokeObjectURL(s.url)); durum.sonuclar = []; $('sonuclar').textContent = ''; $('zip').hidden = true; $('durum').textContent = ''; }
function indir(blob, ad) { const u = URL.createObjectURL(blob), el = document.createElement('a'); el.href = u; el.download = ad; document.body.appendChild(el); el.click(); el.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000); }
const adEkle = (ad) => ad.replace(/(\.[^.]*)?$/, ` (${t('signedSuffix')})$1`);

$('bas').addEventListener('click', async () => {
  if (!durum.sig || !durum.dosyalar.length) return;
  temizleSonuc();
  const a = ayar(), btn = $('bas'); btn.disabled = true;
  const ul = $('sonuclar'), dosyalar = durum.dosyalar.slice(); let basarili = 0;
  for (let i = 0; i < dosyalar.length; i++) {
    const f = dosyalar[i];
    $('durum').textContent = t('sProgress', i + 1, dosyalar.length, f.name);
    const li = document.createElement('li'); li.innerHTML = '<span class="ad"></span><span></span>'; li.firstChild.textContent = f.name; ul.appendChild(li);
    try {
      let blob;
      if (durum.mod === 'pdf') {
        const cikti = await pdfDamgala(new Uint8Array(await f.arrayBuffer()), a, (s, tp) => { $('durum').textContent = t('sProgress', i + 1, dosyalar.length, f.name) + t('sPage', s, tp); });
        blob = new Blob([cikti], { type: 'application/pdf' });
      } else {
        let metin;
        try { metin = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(await f.arrayBuffer())); } catch (e) { throw new Error(t('eUtf')); }
        blob = new Blob([htmlDamgala(metin, htmlBlogu(a))], { type: 'text/html;charset=utf-8' });
      }
      const ad = adEkle(f.name), url = URL.createObjectURL(blob);
      durum.sonuclar.push({ ad, blob, url }); basarili++;
      li.innerHTML = '<span class="ad"></span><a></a>'; li.firstChild.textContent = ad;
      const link = li.querySelector('a'); link.href = url; link.download = ad; link.textContent = t('download');
    } catch (e) { li.className = 'hata'; li.lastChild.textContent = e.message || t('eGeneric'); }
  }
  $('durum').textContent = basarili ? t('sDone', basarili) : t('sNone');
  $('zip').hidden = basarili < 2;
  if (basarili === 1) indir(durum.sonuclar[0].blob, durum.sonuclar[0].ad);
  btn.disabled = false;
});
$('zip').addEventListener('click', async () => indir(await zipYap(durum.sonuclar), dil === 'tr' ? 'imzali-dosyalar.zip' : 'signed-files.zip'));

/* --- başlangıç --- */
try { const k = JSON.parse(localStorage.getItem('konum') || 'null'); if (k && isFinite(k.x) && isFinite(k.y)) durum.pos = { x: Math.min(1, Math.max(0, k.x)), y: Math.min(1, Math.max(0, k.y)) }; } catch (e) {}
ciktiGuncelle(); konumIsaretle(); diliUygula(); modDegistir('pdf'); hatirlaYukle();
if (!localStorage.getItem('rehber-goruldu')) $('rehber').hidden = false;
window.__imza = { svgVektor, rasterIsle, pdfDamgala, htmlBlogu, htmlDamgala, durum, ayar, zipYap, yerlesim };
})();
