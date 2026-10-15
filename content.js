/* FastMoss / 郑和数据 二维码常驻 —— 保持 TikTok 扫码二维码一直展开 */
(() => {
  if (window.__fmQrKeepLoaded) return;
  window.__fmQrKeepLoaded = true;

  const DEFAULT = { enabled: true, forceShow: true, float: true, autoOpen: true };
  let settings = { ...DEFAULT };
  let floatEl = null;
  let floatImgSrc = null;
  let observer = null;
  let scanTimer = null;
  let pendingScan = null;
  let lastScanAt = 0;

  const FLOAT_ID = 'fm-qr-keep-float';

  /* ---------- 工具 ---------- */
  const isZhenghePage = () => /zhenghedata\.com/i.test(location.hostname);

  const getQrSrc = (img) => {
    if (!img) return '';
    if (img.tagName === 'CANVAS') {
      try { return img.toDataURL('image/png'); } catch (e) { return ''; }
    }
    return img.currentSrc || img.src || '';
  };

  /* 二维码图片近似方形，用宽高比过滤误判 */
  const isQrLike = (img) => {
    if (img.tagName === 'CANVAS') return true;
    const w = img.naturalWidth || img.width || 0;
    const h = img.naturalHeight || img.height || 0;
    if (!w || !h) return true;
    const ratio = Math.max(w, h) / Math.max(1, Math.min(w, h));
    return ratio < 1.6;
  };

  /* 弹窗文本特征：FastMoss「打开TikTok」/ 郑和数据「扫码查看」等 */
  const QR_TEXT_RE = /打开\s*TikTok|TikTok\s*扫码|扫描二维码|扫码查看|扫码.*商品|查看商品信息|手机.*扫/;

  /* ---------- 定位二维码弹窗 ----------
     规则：找直接文本里含二维码关键词的最小元素，
     再向上回溯到第一个包含二维码图片的容器，即弹窗本体。 */
  const findQrPopup = () => {
    const all = document.querySelectorAll('body *');
    for (const n of all) {
      if (n.id === FLOAT_ID || (n.closest && n.closest('#' + FLOAT_ID))) continue;
      if (n.childElementCount > 80) continue;
      const directText = Array.from(n.childNodes)
        .filter((c) => c.nodeType === Node.TEXT_NODE)
        .map((c) => c.textContent)
        .join(' ');
      if (!QR_TEXT_RE.test(directText)) continue;
      let cur = n;
      for (let i = 0; i < 10 && cur && cur !== document.body; i++) {
        const img = cur.querySelector('img[src], canvas');
        if (img && isQrLike(img)) return { node: cur, img };
        cur = cur.parentElement;
      }
    }
    return null;
  };

  /* 兜底：文本匹配不到时，按「固定/绝对定位容器里的方形大二维码图」识别弹窗。
     仅用于郑和数据，且必须以页面上存在小二维码图标（详情页特征）为前提，
     避免把登录弹窗里的微信/其他二维码误判成 TikTok 码。 */
  const findQrPopupByImage = () => {
    if (!isZhenghePage()) return null;
    if (!findZhengheQrIcon()) return null; /* 详情页特征：必须有 26px 小二维码图标 */
    const imgs = document.querySelectorAll('img[src], canvas');
    for (const img of imgs) {
      if (img.closest && img.closest('#' + FLOAT_ID)) continue;
      if (img.closest && img.closest('.ant-modal, .ant-modal-wrap, [role="dialog"]')) continue; /* 排除登录弹窗等 */
      const src = getQrSrc(img);
      if (img.tagName !== 'CANVAS' && !/data:image|qrcode|qr_/i.test(src)) continue;
      const r = img.getBoundingClientRect();
      if (!(r.width >= 90 && r.width <= 900 && r.height >= 90)) continue;
      if (!isQrLike(img)) continue;
      let cur = img.parentElement;
      let container = img;
      for (let i = 0; i < 5 && cur && cur !== document.body; i++) {
        const cs = getComputedStyle(cur);
        if (/fixed|absolute/.test(cs.position)) { container = cur; break; }
        cur = cur.parentElement;
      }
      return { node: container, img };
    }
    return null;
  };

  /* ---------- 强制保持展开 ---------- */
  const applyForceShow = (node) => {
    if (!node) return;
    node.classList.add('fm-qr-force-show');
    node.setAttribute('data-fm-qr-force', '1');
    const cs = getComputedStyle(node);
    if (cs.display === 'none' || cs.display === 'contents') {
      node.style.setProperty('display', 'flex', 'important');
    }
    /* 若父链上存在被隐藏的容器，一并解除（限深度，避免影响整页） */
    let p = node.parentElement;
    let depth = 0;
    while (p && p !== document.body && depth < 6) {
      const pcs = getComputedStyle(p);
      if (pcs.display === 'none') {
        p.classList.add('fm-qr-force-show');
        p.style.setProperty('display', 'block', 'important');
      }
      depth++;
      p = p.parentElement;
    }
  };

  /* ---------- 悬浮置顶窗口 ---------- */
  const cloneQr = (img) => {
    if (img.tagName === 'CANVAS') {
      try {
        const im = new Image();
        im.src = img.toDataURL('image/png');
        im.style.width = '100%';
        return im;
      } catch (e) {
        return null;
      }
    }
    const c = img.cloneNode(true);
    c.removeAttribute('class');
    c.removeAttribute('style');
    c.style.width = '100%';
    c.style.height = 'auto';
    c.style.display = 'block';
    return c;
  };

  const makeDraggable = (el) => {
    const head = el.querySelector('.fm-qr-keep-head');
    let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
    head.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      dragging = true;
      sx = e.clientX;
      sy = e.clientY;
      const r = el.getBoundingClientRect();
      ox = r.left;
      oy = r.top;
      el.classList.add('fm-qr-keep-dragging');
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      let nx = ox + (e.clientX - sx);
      let ny = oy + (e.clientY - sy);
      nx = Math.max(0, Math.min(window.innerWidth - el.offsetWidth, nx));
      ny = Math.max(0, Math.min(window.innerHeight - el.offsetHeight, ny));
      el.style.left = nx + 'px';
      el.style.top = ny + 'px';
      el.style.right = 'auto';
      el.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', () => {
      dragging = false;
      el.classList.remove('fm-qr-keep-dragging');
    });
  };

  const ensureFloat = (img) => {
    if (floatEl) {
      const src = getQrSrc(img);
      if (src && src !== floatImgSrc) {
        floatImgSrc = src;
        const holder = floatEl.querySelector('.fm-qr-keep-body');
        holder.innerHTML = '';
        const clone = cloneQr(img);
        if (clone) holder.appendChild(clone);
      }
      return;
    }
    floatEl = document.createElement('div');
    floatEl.id = FLOAT_ID;
    floatEl.innerHTML =
      '<div class="fm-qr-keep-head">' +
      '<span class="fm-qr-keep-title">TikTok 扫码</span>' +
      '<button type="button" class="fm-qr-keep-close" title="关闭悬浮二维码">✕</button>' +
      '</div>' +
      '<div class="fm-qr-keep-body"></div>' +
      '<div class="fm-qr-keep-tip">手机 TikTok 扫一扫，查看商品</div>';
    document.body.appendChild(floatEl);
    const holder = floatEl.querySelector('.fm-qr-keep-body');
    const clone = cloneQr(img);
    if (clone) holder.appendChild(clone);
    floatImgSrc = getQrSrc(img);
    floatEl.querySelector('.fm-qr-keep-close').addEventListener('click', () => {
      floatEl.remove();
      floatEl = null;
      floatImgSrc = null;
    });
    makeDraggable(floatEl);
  };

  /* ---------- 自动弹出（无需鼠标操作） ---------- */

  /* FastMoss 商品页的二维码触发器：标题行右侧一个没有 title/aria 文字、
     仅用 SVG 二维码图标表示的 Icon Button。
     特征：svg 内恰好 1 个 path，且该 path 含 >=6 个 M 子路径（二维码网格）。 */
  const findQrTrigger = () => {
    const btns = document.querySelectorAll('button[aria-label="Icon Button"]');
    for (const b of btns) {
      if (!b.isConnected) continue;
      const st = getComputedStyle(b);
      if (st.display === 'none' || st.visibility === 'hidden') continue; /* 只处理可见按钮 */
      const svg = b.querySelector('svg');
      if (!svg) continue;
      /* 小尺寸方形图标（二维码网格类），排除翻译等大图标 */
      const vb = (svg.getAttribute('viewBox') || '').split(/\s+/);
      if (vb.length === 4) {
        const w = parseFloat(vb[2]), h = parseFloat(vb[3]);
        if (!(w > 0 && h > 0 && Math.max(w, h) <= 40)) continue;
      }
      const paths = svg.querySelectorAll('path');
      if (paths.length !== 1) continue;
      const d = paths[0].getAttribute('d') || '';
      if ((d.match(/M/g) || []).length >= 5) return b;
    }
    return null;
  };

  /* 郑和数据商品详情页的二维码触发器：标题行旁的 26px 小二维码图标。
     结构：div.code > div.ant-image > img.ant-image-img（src 为 data:image 二维码）。
     页面通过全局 mousemove 事件 + 坐标热区判断来决定是否显示大二维码弹窗。 */
  const findZhengheQrIcon = () => {
    if (!isZhenghePage()) return null;
    const cands = [];
    document.querySelectorAll('div.code img, .code img').forEach((i) => cands.push(i));
    /* 兜底：页面任意小尺寸方形 data:image 图 */
    if (!cands.length) {
      document.querySelectorAll('img[src^="data:image"], img[src*="data:image"]').forEach((i) => {
        const r = i.getBoundingClientRect();
        if (r.width > 0 && r.width <= 80 && r.height <= 80) cands.push(i);
      });
    }
    for (const img of cands) {
      if (!img.isConnected) continue;
      const cs = getComputedStyle(img);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      return img;
    }
    return null;
  };

  const AUTO_OPEN_SELECTORS = [
    '[title*="二维码"]',
    '[title*="扫码"]',
    '[aria-label*="二维码"]',
    '[aria-label*="扫码"]',
    '[aria-label*="QR" i]',
    '[data-testid*="qr" i]',
    'img[alt*="二维码"]',
    'img[alt*="扫码"]',
    'img[alt*="QR" i]'
  ];

  const findAutoOpenTarget = () => {
    const cands = [];
    for (const s of AUTO_OPEN_SELECTORS) {
      try { cands.push(...document.querySelectorAll(s)); } catch (e) { /* 忽略非法选择器 */ }
    }
    const uniq = [...new Set(cands)].filter((c) => c.isConnected);
    if (!uniq.length) return null;
    const visible = uniq.filter((c) => c.getClientRects().length > 0);
    const pool = visible.length ? visible : uniq;
    /* 优先取叶子级小元素（按钮/图标），避免误点大容器 */
    return pool.find((c) => c.childElementCount <= 2) || pool[0] || null;
  };

  let autoOpenAttempts = 0;
  let autoOpenTarget = null;
  let lastTriggerAt = 0;
  const MAX_AUTO_ATTEMPTS = 5;
  const RE_TRIGGER_COOLDOWN = 1500; /* 弹窗被页面移除后，冷却后允许重新触发同一目标 */

  const triggerOpen = (el) => {
    const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    const hasLayout = rect && rect.width > 0;
    const cx = hasLayout ? Math.round(rect.left + rect.width / 2) : Math.round(window.innerWidth / 2);
    const cy = hasLayout ? Math.round(rect.top + rect.height / 2) : Math.round(window.innerHeight / 2);
    const mk = (type, x, y) => {
      try {
        return new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: x,
          clientY: y
        });
      } catch (e) { return null; }
    };
    /* 郑和数据：全局 mousemove + 坐标热区 → 派发从元素左缘到中心的移动轨迹 */
    if (hasLayout) {
      for (let i = 0; i <= 6; i++) {
        const x = Math.round(rect.left + (rect.width * i) / 6);
        const ev = mk('mousemove', x, cy);
        if (ev) el.dispatchEvent(ev);
      }
    }
    /* hover 型 tooltip：按顺序派发鼠标移入事件（FastMoss 的 AntD Popover 由这些事件触发） */
    ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'pointermove', 'mousemove'].forEach((type) => {
      const ev = mk(type, cx, cy);
      if (ev) el.dispatchEvent(ev);
    });
    /* 弹窗型：点击 */
    try { el.click(); } catch (e) { /* 忽略 */ }
  };

  const tryAutoOpen = () => {
    if (!settings.autoOpen) return;
    /* 二维码已经在页面上（无论隐藏或显示，scan 会直接强制展开），重置尝试状态 */
    if (findQrPopup() || findQrPopupByImage()) { autoOpenAttempts = 0; autoOpenTarget = null; return; }
    if (autoOpenAttempts >= MAX_AUTO_ATTEMPTS) return;
    /* 优先级：FastMoss QR 图标按钮 → 郑和数据小二维码图标 → 通用 title/aria 文字 */
    const target = findQrTrigger() || findZhengheQrIcon() || findAutoOpenTarget();
    /* 同一目标触发后有冷却，防止反复触发造成弹窗闪烁；
       弹窗被页面移除（如郑和数据离开热区会删 DOM）时，冷却结束后可重新触发 */
    if (!target) return;
    if (target === autoOpenTarget && Date.now() - lastTriggerAt < RE_TRIGGER_COOLDOWN) return;
    autoOpenTarget = target;
    lastTriggerAt = Date.now();
    autoOpenAttempts++;
    triggerOpen(target);
  };

  /* ---------- 主扫描逻辑 ---------- */
  const scan = () => {
    if (!settings.enabled) return;
    const now = Date.now();
    if (now - lastScanAt < 300) return;
    lastScanAt = now;
    let found = findQrPopup() || findQrPopupByImage();
    let zhengheFallback = false;
    if (!found && isZhenghePage()) {
      /* 郑和数据：不依赖页面弹窗触发（其 Popover 触发不稳定），
         直接使用标题旁 26px 小二维码图标作为二维码源，放大显示到悬浮窗。 */
      const icon = findZhengheQrIcon();
      if (icon) { found = { node: icon, img: icon }; zhengheFallback = true; }
    }
    if (found) {
      if (settings.forceShow) applyForceShow(found.node);
      if (settings.float) ensureFloat(found.img);
      if (zhengheFallback && settings.autoOpen) {
        /* 仍尝试触发页面大弹窗；若触发成功，下一轮 scan 会用大图更新悬浮窗 */
        tryAutoOpen();
      }
    } else if (settings.autoOpen) {
      /* 页面上还没有二维码 → 自动触发打开（免鼠标） */
      tryAutoOpen();
    }
  };

  const scheduleScan = () => {
    if (pendingScan) return;
    pendingScan = setTimeout(() => {
      pendingScan = null;
      scan();
    }, 300);
  };

  const startWatcher = () => {
    if (observer) return;
    observer = new MutationObserver(scheduleScan);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden']
    });
    scan();
    if (!scanTimer) scanTimer = setInterval(scan, 1200);
  };

  const cleanup = () => {
    if (observer) { observer.disconnect(); observer = null; }
    if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
    if (pendingScan) { clearTimeout(pendingScan); pendingScan = null; }
    document.querySelectorAll('[data-fm-qr-force]').forEach((n) => {
      n.classList.remove('fm-qr-force-show');
      n.removeAttribute('data-fm-qr-force');
      n.style.removeProperty('display');
    });
    if (floatEl) {
      floatEl.remove();
      floatEl = null;
      floatImgSrc = null;
    }
  };

  const apply = () => {
    if (!settings.enabled) {
      cleanup();
      return;
    }
    if (!settings.float && floatEl) {
      floatEl.remove();
      floatEl = null;
      floatImgSrc = null;
    }
    startWatcher();
    scan();
  };

  /* ---------- 设置读写 ---------- */
  chrome.storage.local.get('fmQrKeep', (res) => {
    settings = Object.assign({}, DEFAULT, (res && res.fmQrKeep) || {});
    apply();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.fmQrKeep) {
      settings = Object.assign({}, DEFAULT, changes.fmQrKeep.newValue || {});
      apply();
    }
  });
})();
