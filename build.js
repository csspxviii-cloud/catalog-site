'use strict';
/*
  Сборщик сайта. Запускается автоматически при публикации в Cloudflare Pages
  (команда: node build.js). Вам запускать его не нужно.

  Что делает:
  1. Читает data/site.json и data/products.json
  2. Проверяет, что в данных нет ошибок (и понятно пишет, если они есть)
  3. Создаёт готовые страницы сайта в папке dist
*/

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'dist');
const IMAGE_EXT = /\.(jpe?g|png|webp|avif|svg)$/i;
const NBSP = '\u00a0';

/* ---------- чтение данных ---------- */

function readJson(rel) {
  const file = path.join(ROOT, rel);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`\nОШИБКА: файл ${rel} прочитать не удалось.`);
    console.error(`Причина: ${e.message}`);
    console.error('Чаще всего это лишняя или пропущенная запятая, кавычка или скобка.');
    console.error('Проверьте файл на https://jsonlint.com — он покажет, в какой строке ошибка.\n');
    process.exit(1);
  }
}

const site = readJson('data/site.json');
const allProducts = readJson('data/products.json');

/* ---------- проверка данных ---------- */

const errors = [];
const warnings = [];

function validate() {
  if (typeof site.siteName !== 'string' || !site.siteName.trim()) errors.push('data/site.json: не заполнено поле siteName (название сайта).');
  if (typeof site.siteUrl !== 'string' || !/^https?:\/\/[^/\s]+$/.test(site.siteUrl)) {
    errors.push('data/site.json: поле siteUrl должно быть адресом сайта без слэша в конце, например https://moi-katalog.pages.dev');
  }
  if (!/^\d{8,15}$/.test(String(site.whatsapp || ''))) {
    errors.push('data/site.json: поле whatsapp должно содержать только цифры номера с кодом страны (8–15 цифр), без плюса и пробелов. Пример: 77001234567');
  }
  if (!Array.isArray(site.categories) || site.categories.length === 0) errors.push('data/site.json: нужна хотя бы одна категория в поле categories.');

  const catSlugs = new Set();
  (site.categories || []).forEach((c, i) => {
    const where = `data/site.json, категория №${i + 1}`;
    if (!c.slug || !/^[a-z0-9-]+$/.test(c.slug)) errors.push(`${where}: поле slug должно состоять из латинских букв, цифр и дефисов (например: dlya-doma).`);
    if (!c.name) errors.push(`${where}: не заполнено поле name.`);
    if (catSlugs.has(c.slug)) errors.push(`${where}: slug «${c.slug}» повторяется.`);
    catSlugs.add(c.slug);
  });

  if (!Array.isArray(allProducts)) {
    errors.push('data/products.json: файл должен начинаться с [ и заканчиваться ] — это список товаров.');
    return;
  }

  const slugs = new Set();
  const skus = new Set();
  allProducts.forEach((p, i) => {
    const where = `data/products.json, товар №${i + 1}${p && p.name ? ` («${p.name}»)` : ''}`;
    if (!p || typeof p !== 'object') { errors.push(`${where}: это не товар.`); return; }
    if (!p.slug || !/^[a-z0-9-]+$/.test(p.slug)) errors.push(`${where}: поле slug должно состоять из латинских букв, цифр и дефисов (например: naushniki-01). Оно станет частью адреса страницы.`);
    if (slugs.has(p.slug)) errors.push(`${where}: slug «${p.slug}» уже используется другим товаром.`);
    slugs.add(p.slug);
    if (!p.sku) errors.push(`${where}: не заполнен артикул (sku).`);
    if (skus.has(p.sku)) errors.push(`${where}: артикул «${p.sku}» повторяется.`);
    skus.add(p.sku);
    if (!p.name) errors.push(`${where}: не заполнено название (name).`);
    if (!catSlugs.has(p.category)) errors.push(`${where}: категория «${p.category}» не найдена в data/site.json. Доступные: ${[...catSlugs].join(', ')}.`);
    if (typeof p.price !== 'number' || !(p.price > 0)) errors.push(`${where}: цена (price) должна быть числом больше нуля, без кавычек и пробелов. Пример: 12900`);
    if (!Array.isArray(p.images) || p.images.length === 0) {
      errors.push(`${where}: добавьте хотя бы одну фотографию в поле images.`);
    } else {
      p.images.forEach((img) => {
        const name = normalizeImage(img);
        if (!IMAGE_EXT.test(name)) errors.push(`${where}: файл «${img}» — допустимы только jpg, png, webp, avif, svg.`);
        else if (!fs.existsSync(path.join(ROOT, 'images', name))) errors.push(`${where}: файл фотографии «${name}» не найден в папке images.`);
      });
    }
    if (p.variants !== undefined) {
      if (!Array.isArray(p.variants)) errors.push(`${where}: variants должен быть списком.`);
      else p.variants.forEach((v, j) => {
        if (!v.name || !Array.isArray(v.values) || v.values.length === 0) errors.push(`${where}: вариант №${j + 1} должен иметь name и непустой список values.`);
      });
    }
  });

  if (errors.length === 0 && allProducts.filter((p) => !p.hidden).length === 0) warnings.push('В каталоге нет ни одного видимого товара.');
}

function normalizeImage(img) {
  return String(img).replace(/^\/+/, '').replace(/^images\//, '');
}

validate();
if (errors.length) {
  console.error('\nСайт не собран: в данных найдены ошибки.\n');
  errors.forEach((e) => console.error(' • ' + e));
  console.error('\nИсправьте их и сохраните файл снова. Предыдущая версия сайта остаётся опубликованной.\n');
  process.exit(1);
}

/* ---------- вспомогательные функции ---------- */

const products = allProducts.filter((p) => !p.hidden);
const categories = site.categories;
const catBySlug = Object.fromEntries(categories.map((c) => [c.slug, c]));
const demo = site.demoMode !== false;
const base = site.siteUrl;

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е');
const price = (n) => new Intl.NumberFormat('ru-RU').format(n).replace(/\s/g, NBSP) + NBSP + (site.currency || '₸');
const plain = (s) => s.replace(/\u00a0/g, ' ');
const paragraphs = (d) => (Array.isArray(d) ? d : d ? [d] : []).map(String);
const clip = (s, n) => (s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…');
const hash = (file) => crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT, file))).digest('hex').slice(0, 8);

const imgSrc = (img) => '/images/' + normalizeImage(img);
const productUrl = (p) => `/product/${p.slug}/`;
const categoryUrl = (c) => `/category/${c.slug}/`;
const jsonLd = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;

const waBase = `https://wa.me/${site.whatsapp}`;
const waLink = (text) => `${waBase}?text=${encodeURIComponent(text)}`;
const waGeneral = waLink('Здравствуйте! У меня вопрос по каталогу.');

function orderMessage(p, variantLine) {
  const lines = ['Здравствуйте! Хочу заказать товар:', `Название: ${p.name}`, `Артикул: ${p.sku}`];
  if (variantLine) lines.push(`Вариант: ${variantLine}`);
  lines.push(`Цена: ${plain(price(p.price))}`);
  lines.push(`Ссылка: ${base}${productUrl(p)}`);
  return lines.join('\n');
}

const icons = {
  wa: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91A9.87 9.87 0 0 0 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.25-8.23a8.2 8.2 0 0 1 8.23 8.24c0 4.54-3.7 8.23-8.23 8.23Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.12-.17.25-.64.81-.78.97-.14.17-.29.19-.54.06-.25-.12-1.05-.39-2-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.02-.38.11-.5.11-.11.25-.29.37-.43.12-.14.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.42h-.48c-.17 0-.43.06-.66.31-.23.25-.87.85-.87 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.08.14-1.18-.06-.1-.23-.17-.48-.29Z"/></svg>',
  search: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="m21 21-4.3-4.3M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z"/></svg>',
  logo: '<svg class="brand__mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><rect x="3" y="7" width="26" height="20" rx="4" fill="#10243E"/><rect x="3" y="12" width="26" height="4" fill="#FFC21A"/><rect x="13" y="18" width="6" height="3" rx="1.5" fill="#FFC21A"/></svg>'
};

const assetVer = { css: hash('assets/css/style.css'), js: hash('assets/js/app.js') };

/* ---------- общий каркас страницы ---------- */

function layout({ title, description, path: urlPath, body, current, ogType = 'website', ogImage, ld = '', bodyClass = '' }) {
  const canonical = base + urlPath;
  const image = ogImage || base + '/og-image.png';
  const nav = (key, href, label) => `<a href="${href}"${current === key ? ' aria-current="page"' : ''}>${label}</a>`;
  const contacts = site.contacts || {};

  return `<!doctype html>
<html lang="ru" class="no-js">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
${demo ? '<meta name="robots" content="noindex, nofollow">\n' : ''}<meta name="theme-color" content="#10243E">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta property="og:type" content="${ogType}">
<meta property="og:site_name" content="${esc(site.siteName)}">
<meta property="og:locale" content="ru_RU">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(image)}">
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="/assets/css/style.css?v=${assetVer.css}">
<script src="/assets/js/app.js?v=${assetVer.js}" defer></script>
${ld}
</head>
<body class="${bodyClass}">
<a class="skip" href="#main">Перейти к содержимому</a>
${demo ? '<div class="demo-bar" role="note"><div class="wrap">Демонстрационная версия: товары, цены, фото и номер WhatsApp — тестовые примеры.</div></div>' : ''}
<header class="site-header">
  <div class="wrap site-header__in">
    <a class="brand" href="/" aria-label="${esc(site.siteName)} — на главную">${icons.logo}<span>${esc(site.siteName)}</span></a>
    <nav class="nav" aria-label="Основное меню">
      ${nav('catalog', '/catalog/', 'Каталог')}
      <a href="/#categories">Категории</a>
      ${nav('contacts', '/contacts/', 'Контакты')}
    </nav>
    <a class="btn btn--wa btn--sm" href="${esc(waGeneral)}" target="_blank" rel="noopener">${icons.wa}<span>WhatsApp</span></a>
  </div>
</header>
<main id="main" tabindex="-1">
${body}
</main>
<footer class="site-footer">
  <div class="wrap site-footer__in">
    <div class="site-footer__col">
      <p class="site-footer__name">${esc(site.siteName)}</p>
      <p>${esc(site.tagline || '')}</p>
      <p class="site-footer__note">Оплата на сайте не предусмотрена: условия заказа обсуждаются в WhatsApp.</p>
    </div>
    <div class="site-footer__col">
      <p class="site-footer__head">Каталог</p>
      <ul>
        <li><a href="/catalog/">Все товары</a></li>
        ${categories.map((c) => `<li><a href="${categoryUrl(c)}">${esc(c.name)}</a></li>`).join('\n        ')}
      </ul>
    </div>
    <div class="site-footer__col">
      <p class="site-footer__head">Связь</p>
      <ul>
        <li><a href="${esc(waGeneral)}" target="_blank" rel="noopener">WhatsApp ${esc(site.phoneDisplay || '')}</a></li>
        ${contacts.email ? `<li><a href="mailto:${esc(contacts.email)}">${esc(contacts.email)}</a></li>` : ''}
        <li><a href="/contacts/">Контакты и доставка</a></li>
      </ul>
    </div>
  </div>
  <div class="wrap site-footer__base">© ${new Date().getFullYear()} ${esc(site.siteName)}</div>
</footer>
</body>
</html>
`;
}

/* ---------- блоки ---------- */

function card(p, idx) {
  const cat = catBySlug[p.category];
  const search = norm([p.name, p.sku, cat.name, ...paragraphs(p.description), ...(p.variants || []).flatMap((v) => v.values)].join(' '));
  return `<article class="card" data-name="${esc(norm(p.name))}" data-search="${esc(search)}" data-cat="${esc(p.category)}" data-price="${p.price}" data-order="${idx}">
  <a class="card__media" href="${productUrl(p)}" tabindex="-1" aria-hidden="true"><img src="${esc(imgSrc(p.images[0]))}" width="800" height="800" loading="lazy" decoding="async" alt=""></a>
  <div class="card__body">
    <p class="card__cat">${esc(cat.name)}</p>
    <h3 class="card__title"><a href="${productUrl(p)}">${esc(p.name)}</a></h3>
    <p class="card__sku">Артикул ${esc(p.sku)}</p>
    <p class="price-tag">${price(p.price)}</p>
  </div>
</article>`;
}

function crumbs(items) {
  return `<nav class="crumbs" aria-label="Навигация по разделам"><ol>${items
    .map((it, i) => (i === items.length - 1 ? `<li aria-current="page">${esc(it.label)}</li>` : `<li><a href="${it.href}">${esc(it.label)}</a></li>`))
    .join('')}</ol></nav>`;
}

function listing({ title, h1, intro, items, category, urlPath, description, current }) {
  const body = `<div class="wrap page-head">
  ${crumbs(category ? [{ label: 'Главная', href: '/' }, { label: 'Каталог', href: '/catalog/' }, { label: category.name }] : [{ label: 'Главная', href: '/' }, { label: 'Каталог' }])}
  <h1>${esc(h1)}</h1>
  <p class="lead">${esc(intro)}</p>
</div>
<div class="wrap listing">
  <aside class="filters" aria-label="Поиск и фильтры">
    <button class="filters__toggle" type="button" aria-expanded="false" aria-controls="filter-panel">Поиск и фильтры</button>
    <form class="filters__panel" id="filter-panel" role="search" action="/catalog/" method="get"${category ? ` data-cat="${esc(category.slug)}"` : ''}>
      <div class="field">
        <label for="f-q">Поиск по названию или артикулу</label>
        <input id="f-q" name="q" type="search" autocomplete="off" enterkeyhint="search" placeholder="Например: наушники">
      </div>
      ${category ? '' : `<div class="field">
        <label for="f-cat">Категория</label>
        <select id="f-cat" name="cat">
          <option value="">Все категории</option>
          ${categories.map((c) => `<option value="${esc(c.slug)}">${esc(c.name)}</option>`).join('\n          ')}
        </select>
      </div>`}
      <fieldset class="field field--pair">
        <legend>Цена, ${esc(site.currency || '₸')}</legend>
        <div>
          <input id="f-min" name="min" type="number" inputmode="numeric" min="0" step="100" placeholder="от" aria-label="Цена от">
          <input id="f-max" name="max" type="number" inputmode="numeric" min="0" step="100" placeholder="до" aria-label="Цена до">
        </div>
      </fieldset>
      <div class="field">
        <label for="f-sort">Сортировка</label>
        <select id="f-sort" name="sort">
          <option value="">Как в каталоге</option>
          <option value="price-asc">Сначала дешевле</option>
          <option value="price-desc">Сначала дороже</option>
          <option value="name">По названию, А–Я</option>
        </select>
      </div>
      <button class="btn btn--ghost" type="reset" id="f-reset">Сбросить фильтры</button>
    </form>
  </aside>
  <section aria-label="Список товаров">
    <p class="results__count" id="count" role="status" aria-live="polite">Товаров: ${items.length}</p>
    <div class="grid" id="grid">
${items.map((p) => card(p, products.indexOf(p))).join('\n')}
    </div>
    <div class="empty" id="empty" hidden>
      <p><strong>Ничего не найдено.</strong></p>
      <p>Измените запрос или сбросьте фильтры.</p>
    </div>
  </section>
</div>`;
  return layout({ title, description, path: urlPath, body, current });
}

/* ---------- страницы ---------- */

function homePage() {
  const featured = products.filter((p) => p.featured);
  const showcase = (featured.length ? featured : products).slice(0, 4);
  const sample = showcase[0];
  const counts = Object.fromEntries(categories.map((c) => [c.slug, products.filter((p) => p.category === c.slug).length]));

  const ticket = sample
    ? `<aside class="ticket" aria-label="Пример сообщения для заказа">
      <p class="ticket__label">Так выглядит заказ в WhatsApp${demo ? ' (демо-товар)' : ''}</p>
      <div class="ticket__msg">
        <p>Здравствуйте! Хочу заказать товар:</p>
        <p><span>Название:</span> ${esc(sample.name)}</p>
        <p><span>Артикул:</span> ${esc(sample.sku)}</p>
        <p><span>Цена:</span> ${price(sample.price)}</p>
        <p><span>Ссылка:</span> ${esc(base + productUrl(sample))}</p>
      </div>
      <p class="ticket__note">Всё это подставляется автоматически, когда вы нажимаете кнопку в карточке товара.</p>
    </aside>`
    : '';

  const body = `<section class="hero">
  <div class="wrap hero__in">
    <div class="hero__text">
      <h1>${esc(site.siteName)}: ${esc((site.tagline || '').replace(/\.$/, '').replace(/^./, (c) => c.toLowerCase()))}</h1>
      <p class="lead">${esc(site.description || '')}</p>
      <form class="hero__search" action="/catalog/" method="get" role="search">
        <label class="sr-only" for="h-q">Поиск по каталогу</label>
        <input id="h-q" name="q" type="search" placeholder="Найти товар или артикул" autocomplete="off" enterkeyhint="search">
        <button class="btn btn--primary" type="submit">${icons.search}<span>Найти</span></button>
      </form>
      <p class="hero__links"><a class="btn btn--ghost" href="/catalog/">Открыть каталог</a></p>
    </div>
    ${ticket}
  </div>
</section>

<section class="section" id="categories" aria-labelledby="cats-h">
  <div class="wrap">
    <h2 id="cats-h">Категории</h2>
    <ul class="cats">
      ${categories
        .map((c) => `<li><a class="cat" href="${categoryUrl(c)}"><span class="cat__name">${esc(c.name)}</span><span class="cat__desc">${esc(c.description || '')}</span><span class="cat__count">Товаров: ${counts[c.slug]}</span></a></li>`)
        .join('\n      ')}
    </ul>
  </div>
</section>

${showcase.length ? `<section class="section section--tint" aria-labelledby="feat-h">
  <div class="wrap">
    <div class="section__head"><h2 id="feat-h">${featured.length ? 'Избранные товары' : 'Товары'}</h2><a href="/catalog/">Весь каталог</a></div>
    <div class="grid grid--home">
${showcase.map((p) => card(p, products.indexOf(p))).join('\n')}
    </div>
  </div>
</section>` : ''}

<section class="section" aria-labelledby="how-h">
  <div class="wrap">
    <h2 id="how-h">Как заказать</h2>
    <ol class="steps">
      ${(site.howToOrder || []).map((s) => `<li><h3>${esc(s.title)}</h3><p>${esc(s.text)}</p></li>`).join('\n      ')}
    </ol>
  </div>
</section>

<section class="section section--tint" aria-labelledby="del-h">
  <div class="wrap two-col">
    <div>
      <h2 id="del-h">${esc((site.delivery || {}).title || 'Доставка')}</h2>
      <p>${esc((site.delivery || {}).short || '')}</p>
    </div>
    <div class="cta-box">
      <p>Есть вопрос до заказа?</p>
      <a class="btn btn--wa" href="${esc(waGeneral)}" target="_blank" rel="noopener">${icons.wa}<span>Написать в WhatsApp</span></a>
    </div>
  </div>
</section>`;

  const ld = demo ? '' : jsonLd({ '@context': 'https://schema.org', '@type': 'Organization', name: site.siteName, url: base });
  return layout({ title: `${site.siteName} — ${site.tagline || 'каталог товаров'}`, description: site.description || site.tagline || site.siteName, path: '/', body, current: 'home', ld });
}

function productPage(p) {
  const cat = catBySlug[p.category];
  const imgs = p.images.map(imgSrc);
  const desc = paragraphs(p.description);
  const related = products.filter((x) => x.category === p.category && x.slug !== p.slug).slice(0, 4);
  const delivery = p.delivery || (site.delivery || {}).short || '';
  const waHref = waLink(orderMessage(p));

  const gallery = `<div class="gallery" data-gallery>
    <div class="gallery__main"><img id="g-main" src="${esc(imgs[0])}" width="800" height="800" alt="${esc(p.name)}" fetchpriority="high"></div>
    ${imgs.length > 1 ? `<ul class="gallery__thumbs" aria-label="Фотографии товара">
      ${imgs.map((src, i) => `<li><a href="${esc(src)}" data-full="${esc(src)}" data-alt="${esc(p.name)} — фото ${i + 1}"${i === 0 ? ' aria-current="true"' : ''}><img src="${esc(src)}" width="160" height="160" loading="lazy" alt="Фото ${i + 1}"></a></li>`).join('\n      ')}
    </ul>` : ''}
  </div>`;

  const variants = (p.variants || [])
    .map((v, i) => `<fieldset class="variant" data-variant="${esc(v.name)}">
        <legend>${esc(v.name)}</legend>
        <div class="variant__opts">
          ${v.values.map((val, j) => `<label class="chip"><input type="radio" name="v${i}" value="${esc(val)}"><span>${esc(val)}</span></label>`).join('\n          ')}
        </div>
      </fieldset>`)
    .join('\n      ');

  const specs = p.specs && Object.keys(p.specs).length
    ? `<section class="block" aria-labelledby="spec-h"><h2 id="spec-h">Характеристики</h2><dl class="specs">${Object.entries(p.specs).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl></section>`
    : '';

  const body = `<div class="wrap page-head page-head--tight">
  ${crumbs([{ label: 'Главная', href: '/' }, { label: 'Каталог', href: '/catalog/' }, { label: cat.name, href: categoryUrl(cat) }, { label: p.name }])}
</div>
<article class="wrap product">
  ${gallery}
  <div class="product__info">
    <p class="product__cat"><a href="${categoryUrl(cat)}">${esc(cat.name)}</a></p>
    <h1>${esc(p.name)}</h1>
    <p class="product__sku">Артикул <strong>${esc(p.sku)}</strong></p>
    <p class="price-tag price-tag--lg">${price(p.price)}</p>
    <div class="variants" id="variants">
      ${variants}
    </div>
    <p class="form-error" id="variant-error" role="alert" hidden></p>
    <a class="btn btn--wa btn--lg" id="order-btn" href="${esc(waHref)}" target="_blank" rel="noopener"
       data-wa="${esc(site.whatsapp)}" data-name="${esc(p.name)}" data-sku="${esc(p.sku)}" data-price="${esc(plain(price(p.price)))}">${icons.wa}<span>Заказать в WhatsApp</span></a>
    <p class="hint">Откроется чат с готовым сообщением: название, артикул, цена и ссылка на эту страницу. Итоговую стоимость и наличие продавец подтвердит в чате.</p>
    <section class="block" aria-labelledby="deliv-h">
      <h2 id="deliv-h">Доставка</h2>
      <p>${esc(delivery)}</p>
      <p><a href="/contacts/#delivery">Подробнее о доставке</a></p>
    </section>
  </div>
  <div class="product__more">
    ${desc.length ? `<section class="block" aria-labelledby="desc-h"><h2 id="desc-h">Описание</h2>${desc.map((t) => `<p>${esc(t)}</p>`).join('')}</section>` : ''}
    ${specs}
  </div>
</article>
${related.length ? `<section class="section section--tint" aria-labelledby="rel-h"><div class="wrap"><h2 id="rel-h">Ещё в категории «${esc(cat.name)}»</h2><div class="grid grid--home">
${related.map((x) => card(x, products.indexOf(x))).join('\n')}
</div></div></section>` : ''}`;

  const description = clip(`${p.name}. ${desc[0] || ''} Цена: ${plain(price(p.price))}. Заказ через WhatsApp.`, 160);
  const url = base + productUrl(p);
  const ld = demo
    ? ''
    : jsonLd({
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: p.name,
        sku: p.sku,
        image: imgs.map((s) => base + s),
        description: desc.join(' '),
        offers: { '@type': 'Offer', url, priceCurrency: 'KZT', price: p.price }
      });
  return layout({ title: `${p.name} — ${site.siteName}`, description, path: productUrl(p), body, current: 'catalog', ogType: 'website', ogImage: IMAGE_EXT.test(imgs[0]) && !/\.svg$/i.test(imgs[0]) ? base + imgs[0] : undefined, ld });
}

function contactsPage() {
  const c = site.contacts || {};
  const d = site.delivery || {};
  const rows = [
    ['WhatsApp', `<a href="${esc(waGeneral)}" target="_blank" rel="noopener">${esc(site.phoneDisplay || site.whatsapp)}</a>`],
    c.city ? ['Город', esc(c.city)] : null,
    c.address ? ['Адрес', esc(c.address)] : null,
    c.workHours ? ['Время работы', esc(c.workHours)] : null,
    c.email ? ['Эл. почта', `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>`] : null,
    c.instagram ? ['Instagram', `<a href="${esc(c.instagram)}" rel="noopener" target="_blank">${esc(c.instagram.replace(/^https?:\/\/(www\.)?/, ''))}</a>`] : null
  ].filter(Boolean);

  const body = `<div class="wrap page-head">
  ${crumbs([{ label: 'Главная', href: '/' }, { label: 'Контакты' }])}
  <h1>Контакты</h1>
  <p class="lead">Самый быстрый способ связаться — написать в WhatsApp.</p>
</div>
<div class="wrap two-col two-col--top">
  <section aria-labelledby="c-h">
    <h2 id="c-h" class="sr-only">Способы связи</h2>
    <dl class="contact-list">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
    <p><a class="btn btn--wa btn--lg" href="${esc(waGeneral)}" target="_blank" rel="noopener">${icons.wa}<span>Написать в WhatsApp</span></a></p>
  </section>
  <section id="delivery" aria-labelledby="d-h">
    <h2 id="d-h">${esc(d.title || 'Доставка')}</h2>
    <ul class="plain-list">${(d.points || []).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
  </section>
</div>
<section class="section section--tint" aria-labelledby="how-h">
  <div class="wrap">
    <h2 id="how-h">Как оформить заказ</h2>
    <ol class="steps">
      ${(site.howToOrder || []).map((s) => `<li><h3>${esc(s.title)}</h3><p>${esc(s.text)}</p></li>`).join('\n      ')}
    </ol>
  </div>
</section>`;
  return layout({ title: `Контакты и доставка — ${site.siteName}`, description: `Как связаться с магазином «${site.siteName}», условия доставки и оформление заказа через WhatsApp.`, path: '/contacts/', body, current: 'contacts' });
}

function notFoundPage() {
  const body = `<div class="wrap page-head notfound">
  <h1>Страница не найдена</h1>
  <p class="lead">Возможно, адрес изменился или товар убрали из каталога.</p>
  <p><a class="btn btn--primary" href="/catalog/">Перейти в каталог</a> <a class="btn btn--ghost" href="/">На главную</a></p>
</div>`;
  return layout({ title: `Страница не найдена — ${site.siteName}`, description: 'Страница не найдена.', path: '/404.html', body });
}

/* ---------- запись файлов ---------- */

function write(rel, content) {
  const file = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

for (const dir of ['assets', 'images']) {
  if (fs.existsSync(path.join(ROOT, dir))) fs.cpSync(path.join(ROOT, dir), path.join(OUT, dir), { recursive: true });
}
if (fs.existsSync(path.join(ROOT, 'public'))) fs.cpSync(path.join(ROOT, 'public'), OUT, { recursive: true });

let pages = 0;
const urls = ['/', '/catalog/', '/contacts/'];

write('index.html', homePage()); pages++;
write('catalog/index.html', listing({
  title: `Каталог товаров — ${site.siteName}`,
  h1: 'Каталог',
  intro: 'Найдите нужный товар по названию или артикулу, отфильтруйте по цене и категории.',
  items: products,
  urlPath: '/catalog/',
  description: `Каталог товаров из Китая: поиск, фильтры по категории и цене. Заказ через WhatsApp. ${site.siteName}.`,
  current: 'catalog'
})); pages++;

categories.forEach((c) => {
  const items = products.filter((p) => p.category === c.slug);
  write(`category/${c.slug}/index.html`, listing({
    title: `${c.name} — ${site.siteName}`,
    h1: c.name,
    intro: c.description || `Товары категории «${c.name}».`,
    items,
    category: c,
    urlPath: categoryUrl(c),
    description: `${c.name}${c.description ? ': ' + c.description.toLowerCase() : ''}. Каталог ${site.siteName}, заказ через WhatsApp.`,
    current: 'catalog'
  }));
  urls.push(categoryUrl(c)); pages++;
});

products.forEach((p) => { write(`product/${p.slug}/index.html`, productPage(p)); urls.push(productUrl(p)); pages++; });
write('contacts/index.html', contactsPage()); pages++;
write('404.html', notFoundPage()); pages++;

write('robots.txt', demo
  ? 'User-agent: *\nAllow: /\n'
  : `User-agent: *\nAllow: /\n\nSitemap: ${base}/sitemap.xml\n`);

if (!demo) {
  const today = new Date().toISOString().slice(0, 10);
  write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${esc(base + u)}</loc><lastmod>${today}</lastmod></url>`).join('\n')}\n</urlset>\n`);
}

warnings.forEach((w) => console.warn('Внимание: ' + w));
if (site.siteUrl.includes('example.pages.dev') && !demo) console.warn('Внимание: в data/site.json всё ещё стоит адрес-пример (example.pages.dev). Замените его на адрес вашего сайта.');
if (site.whatsapp === '77000000000' && !demo) console.warn('Внимание: в data/site.json всё ещё стоит демо-номер WhatsApp. Замените его на свой.');
console.log(`Готово: товаров — ${products.length}, страниц — ${pages}. Результат в папке dist.${demo ? ' (демо-режим: сайт закрыт от поисковиков)' : ''}`);
