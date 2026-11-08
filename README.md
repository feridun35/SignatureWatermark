# Signature Watermark · İmza Filigranı

Kaynak: https://github.com/feridun35/SignatureWatermark

Kendi imzanı PDF ve HTML dosyalarına vektör filigran olarak basan, **tamamen tarayıcıda çalışan** statik site. Hiçbir dosya sunucuya gitmez.

## Dosyalar
- `index.html`, `style.css`, `app.js`, `i18n.js` (TR/EN metinler) — site. Sunucu kodu yok.
- Tasarım meshtexture.com düzeninde: solda bölümlü panel, sağda önizleme; açık/koyu tema, TR/EN, GitHub bağlantısı, açılışta iş akışı rehberi. Dosyalar pencerenin herhangi bir yerine sürüklenip bırakılabilir (resim → imza, PDF/HTML → belge; 'İmza Yükle' ya da 'Dosya Ekle' düğmesinin üstüne bırakmak türü zorlar).
- `vendor/` — pdf-lib 1.17.1 (MIT, PDF yazma) ve pdf.js 3.11.174 (Apache-2.0, önizleme ve koyu sayfa algılama), yazı tipi dosyaları dahil. Dışarıdan hiçbir şey yüklenmez.
- `_kur/` — vendor dosyalarının geldiği yerel npm klasörü; repoya girmez (`.gitignore`).

## Çalıştırma
Çift tıklayıp `index.html`'i açmak çoğu tarayıcıda çalışır. Garantisi için küçük bir sunucu:

```bash
python -m http.server 8765
```

Sonra `http://127.0.0.1:8765` adresini aç.

## Yayınlama (ücretsiz, statik)
Klasör GitHub Pages, Netlify ya da Cloudflare Pages'e olduğu gibi yüklenir. Derleme adımı yok. Kod GitHub'da; site henüz bir adreste yayında değil.

## Davranış
- İmza: SVG (yalnız `<path>`) ise vektör olarak PDF'e çizilir. Karmaşık SVG ve PNG/JPG/WEBP yüksek çözünürlüklü şeffaf resme çevrilir (beyaz arka plan otomatik temizlenir). "Elle çiz" ile çizilen imza vektördür.
- Konum: 9 hazır konum (3×3) ya da önizlemede sürükle; tekerlekle boyut, ok tuşlarıyla ince ayar. Konum 0–1 oranı olarak tutulur ve her sayfada imza kenardan %4 boşlukla sayfa içinde kalacak şekilde sınırlanır. Köşe seçilince boyut %45'ten büyükse %30'a iner.
- PDF: seçilen konuma, sayfa yönüne göre eğimle. Döndürülmüş (/Rotate) sayfalar desteklenir. Koyu sayfalarda (ortalama parlaklık < 110) beyaz imza.
- HTML: `</body>` öncesine işaretli blok; konum CSS `clamp()` ile ekran içinde tutulur; yeniden imzalayınca eskisi değişir.
- Güvenlik: CSP `connect-src` yalnız kendi kaynağı ve blob; pdf.js `isEvalSupported:false` (3.11'deki bilinen font tabanlı kod çalıştırma açığına karşı).

## Bilinen sınırlar
- Filigran silinebilir (PDF düzenleyici, HTML'de öğeyi incele). Caydırıcıdır.
- Şifreli PDF desteklenmez. Çok büyük PDF'ler (yüzlerce MB) tarayıcı belleğine bağlı.
- HTML'de `difference` karışımı orta gri zeminde zayıf görünür.
- Tek dosyalık HTML için ideal; ayrı CSS/JS dosyaları olan sitede yalnız .html imzalanır.
- Arayüz Türkçe ve İngilizce; tarayıcı dili Türkçe değilse İngilizce açılır.
