const state = {
  uploads: [],
  referenceUploads: [],
  plan: null,
  selectedId: null,
  currentStep: 1,
};

const $ = (id) => document.getElementById(id);
const API_BASE = (window.DETAIL_PAGE_API_BASE || "").replace(/\/$/, "");

function apiUrl(path) {
  return API_BASE ? `${API_BASE}${path}` : path;
}

const platformSizePresets = {
  淘宝: "750x1000 单屏",
  天猫: "750x1000 单屏",
  京东: "800x800 主图方图",
  拼多多: "750x1000 单屏",
  抖店: "1125x2436 抖店长图",
  亚马逊: "1500x1500 亚马逊高清方图",
  Shopify: "1000x1000 亚马逊主图",
};

const els = {
  imageInput: $("imageInput"),
  referenceImageInput: $("referenceImageInput"),
  thumbGrid: $("thumbGrid"),
  referenceThumbGrid: $("referenceThumbGrid"),
  productName: $("productName"),
  screenCount: $("screenCount"),
  language: $("language"),
  platform: $("platform"),
  ratio: $("ratio"),
  resolution: $("resolution"),
  imageModel: $("imageModel"),
  modelUsage: $("modelUsage"),
  modelType: $("modelType"),
  style: $("style"),
  sellingPoints: $("sellingPoints"),
  referenceLinks: $("referenceLinks"),
  planBtn: $("planBtn"),
  planSummary: $("planSummary"),
  screenList: $("screenList"),
  generationScreenList: $("generationScreenList"),
  selectedScreen: $("selectedScreen"),
  previewImage: $("previewImage"),
  previewEmpty: $("previewEmpty"),
  generateOneBtn: $("generateOneBtn"),
  generateAllBtn: $("generateAllBtn"),
  downloadBtn: $("downloadBtn"),
  longImageBtn: $("longImageBtn"),
  exportPlanBtn: $("exportPlanBtn"),
  toGenerateBtn: $("toGenerateBtn"),
  outputHint: $("outputHint"),
  inputHint: $("inputHint"),
  geminiStatus: $("geminiStatus"),
  imageStatus: $("imageStatus"),
};

function setStep(step) {
  state.currentStep = step;
  document.querySelectorAll(".wizard-step").forEach((node) => {
    node.classList.toggle("is-active", Number(node.dataset.step) === step);
  });
  document.querySelectorAll(".step-nav").forEach((node) => {
    node.classList.toggle("is-active", Number(node.dataset.stepTarget) === step);
  });
  if (step === 4) {
    renderGenerationList();
    renderSelected();
  }
}

async function fetchJsonWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const contentType = response.headers.get("content-type") || "";
    const data = contentType.includes("application/json")
      ? await response.json()
      : { error: `云端接口返回非 JSON 响应：${response.status}。如果正在生图，通常是 EdgeOne 函数超时。` };
    if (!response.ok) throw new Error(data.error || `请求失败：${response.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function getSettings() {
  return {
    screenCount: Number(els.screenCount.value),
    productName: els.productName.value.trim(),
    language: els.language.value,
    platform: els.platform.value,
    ratio: els.ratio.value,
    resolution: els.resolution.value,
    imageModel: els.imageModel.value,
    modelUsage: els.modelUsage.value,
    modelType: els.modelType.value,
    style: els.style.value.trim(),
  };
}

function parseRatioDimensions(ratio) {
  const match = String(ratio || "").match(/(\d{3,5})\s*[x×]\s*(\d{3,5})/i);
  if (!match) return { width: 750, height: 1000 };
  return { width: Number(match[1]), height: Number(match[2]) };
}

function outputDimensions(settings = getSettings()) {
  const base = parseRatioDimensions(settings.ratio);
  const resolution = settings.resolution || "1k";
  const targetLongSide = resolution === "4k" ? 4096 : resolution === "2k" ? 2048 : 0;
  if (!targetLongSide) return base;
  const longSide = Math.max(base.width, base.height);
  if (resolution === "2k" && longSide >= targetLongSide) return base;
  const scale = targetLongSide / longSide;
  return {
    width: Math.max(1, Math.round(base.width * scale)),
    height: Math.max(1, Math.round(base.height * scale)),
  };
}

function outputAspect(settings = getSettings()) {
  const { width, height } = outputDimensions(settings);
  return `${width} / ${height}`;
}

function updatePreviewAspect() {
  const dimensions = outputDimensions();
  document.documentElement.style.setProperty("--preview-aspect", outputAspect());
  if (els.outputHint && state.currentStep === 4) {
    els.outputHint.textContent = `当前输出尺寸：${dimensions.width} x ${dimensions.height}。真实产品图会作为参考输入；模型不支持时会降级为本地预览。`;
  }
}

function drawImageCover(ctx, img, targetWidth, targetHeight) {
  const sourceRatio = img.naturalWidth / img.naturalHeight;
  const targetRatio = targetWidth / targetHeight;
  let sx = 0;
  let sy = 0;
  let sw = img.naturalWidth;
  let sh = img.naturalHeight;
  if (sourceRatio > targetRatio) {
    sw = Math.round(img.naturalHeight * targetRatio);
    sx = Math.round((img.naturalWidth - sw) / 2);
  } else if (sourceRatio < targetRatio) {
    sh = Math.round(img.naturalWidth / targetRatio);
    sy = Math.round((img.naturalHeight - sh) / 2);
  }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetWidth, targetHeight);
}

async function fitImageToOutputSize(src, settings = getSettings()) {
  const { width, height } = outputDimensions(settings);
  const img = await loadImage(src);
  if (img.naturalWidth === width && img.naturalHeight === height) return src;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  drawImageCover(ctx, img, width, height);
  return canvas.toDataURL("image/png");
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function compressImageFile(file, maxSide = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        const width = Math.max(1, Math.round(img.naturalWidth * scale));
        const height = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve({
          dataUrl: canvas.toDataURL("image/jpeg", quality),
          width,
          height,
          originalSize: file.size,
        });
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function handleFiles(files) {
  const selected = [...files].slice(0, 12);
  const mapped = await Promise.all(
    selected.map(async (file) => {
      const compressed = await compressImageFile(file, 1800, 0.84);
      return {
        name: file.name,
        type: "image/jpeg",
        size: Math.round((compressed.dataUrl.length * 3) / 4),
        originalSize: file.size,
        width: compressed.width,
        height: compressed.height,
        dataUrl: compressed.dataUrl,
      };
    }),
  );
  state.uploads = mapped;
  renderThumbs();
  els.inputHint.textContent = `已读取并压缩 ${state.uploads.length} 张产品图。生成规划会更快，不容易卡住。`;
}

async function handleReferenceFiles(files) {
  const selected = [...files].slice(0, 12);
  const mapped = await Promise.all(
    selected.map(async (file) => {
      const compressed = await compressImageFile(file, 1400, 0.8);
      return {
        name: file.name,
        type: "image/jpeg",
        size: Math.round((compressed.dataUrl.length * 3) / 4),
        originalSize: file.size,
        width: compressed.width,
        height: compressed.height,
        role: "reference",
        dataUrl: compressed.dataUrl,
      };
    }),
  );
  state.referenceUploads = mapped;
  renderReferenceThumbs();
}

function renderThumbs() {
  els.thumbGrid.innerHTML = state.uploads
    .map(
      (file, index) => `
        <div class="thumb">
          <img src="${file.dataUrl}" alt="${escapeHtml(file.name)}" />
          <span>${escapeHtml(file.name)}</span>
          <button type="button" class="thumb-remove" data-kind="product" data-index="${index}" aria-label="删除图片">×</button>
        </div>
      `,
    )
    .join("");
  bindThumbRemoveButtons();
}

function renderReferenceThumbs() {
  els.referenceThumbGrid.innerHTML = state.referenceUploads
    .map(
      (file, index) => `
        <div class="thumb">
          <img src="${file.dataUrl}" alt="${escapeHtml(file.name)}" />
          <span>${escapeHtml(file.name)}</span>
          <button type="button" class="thumb-remove" data-kind="reference" data-index="${index}" aria-label="删除图片">×</button>
        </div>
      `,
    )
    .join("");
  bindThumbRemoveButtons();
}

function bindThumbRemoveButtons() {
  document.querySelectorAll(".thumb-remove").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const index = Number(button.dataset.index);
      if (button.dataset.kind === "reference") {
        state.referenceUploads.splice(index, 1);
        renderReferenceThumbs();
      } else {
        state.uploads.splice(index, 1);
        renderThumbs();
        els.inputHint.textContent = state.uploads.length
          ? `已读取 ${state.uploads.length} 张产品图。`
          : "至少上传一张产品图。下一步会填写产品名称和生成设置。";
      }
    });
  });
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function asTextList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  if (typeof value === "string") return value.split(/[\/\n；;、,，]+/).map((item) => item.trim()).filter(Boolean);
  if (value && typeof value === "object") return Object.values(value).map((item) => String(item || "").trim()).filter(Boolean);
  return [];
}

function localDemoImage(screen) {
  const settings = getSettings();
  const { width, height } = outputDimensions(settings);
  const scale = width / 900;
  const viewHeight = Math.round(height / scale);
  const productImage = state.uploads[0]?.dataUrl || "";
  const title = escapeHtml(screen.mainTitle || screen.title || "详情页单屏");
  const subtitle = escapeHtml(screen.subtitle || screen.salesGoal || "");
  const productName = escapeHtml(settings.productName || "产品名称");
  const style = escapeHtml(settings.style || "生活方式场景");
  const lines = asTextList(screen.copy).slice(0, 3);
  const bullets = lines
    .map((line, index) => `<text x="74" y="${770 + index * 46}" font-size="24" fill="#3b2f26">• ${escapeHtml(line)}</text>`)
    .join("");
  const floorY = Math.round(viewHeight * 0.7);
  const productY = Math.round(viewHeight * 0.36);
  const productHeight = Math.max(220, Math.round(viewHeight * 0.22));
  const bulletsY = Math.min(viewHeight - 360, productY + productHeight + 70);
  const footerY = viewHeight - 270;
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 900 ${viewHeight}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#d9b892"/>
      <stop offset="46%" stop-color="#f1dec5"/>
      <stop offset="100%" stop-color="#fff5e6"/>
    </linearGradient>
    <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#e6c79f"/>
      <stop offset="100%" stop-color="#ba8550"/>
    </linearGradient>
  </defs>
  <rect width="900" height="${viewHeight}" fill="url(#bg)"/>
  <polygon points="0,0 900,0 900,255 0,360" fill="rgba(255,255,255,0.20)"/>
  <rect x="0" y="${floorY}" width="900" height="${viewHeight - floorY}" fill="url(#floor)"/>
  <rect x="626" y="178" width="18" height="${Math.max(500, viewHeight - 510)}" fill="#c8a47d" opacity="0.42"/>
  <rect x="666" y="158" width="18" height="${Math.max(520, viewHeight - 490)}" fill="#b9906d" opacity="0.34"/>
  <rect x="710" y="138" width="22" height="${Math.max(540, viewHeight - 470)}" fill="#d7b48a" opacity="0.32"/>
  <rect x="760" y="120" width="90" height="${Math.max(470, viewHeight - 560)}" rx="12" fill="#fff8ee" opacity="0.54"/>
  <text x="72" y="104" font-family="Arial, sans-serif" font-size="26" font-weight="800" fill="#2f251c">${productName}</text>
  <foreignObject x="70" y="136" width="760" height="120">
    <div xmlns="http://www.w3.org/1999/xhtml" style="font-family:Arial,'PingFang SC',sans-serif;font-size:43px;font-weight:300;line-height:1.16;color:#2f251c;text-align:center;">${title}</div>
  </foreignObject>
  <foreignObject x="76" y="260" width="748" height="150">
    <div xmlns="http://www.w3.org/1999/xhtml" style="font-family:'Kaiti SC','STKaiti','PingFang SC',cursive;font-size:72px;line-height:1;color:#f3a91e;text-align:center;font-weight:700;">${subtitle || "生活不止一面"}</div>
  </foreignObject>
  <rect x="88" y="${productY}" width="724" height="${productHeight}" rx="20" fill="#efe1cc" stroke="#d3b891"/>
  ${
    productImage
      ? `<image x="116" y="${productY + 28}" width="668" height="${Math.max(120, productHeight - 56)}" preserveAspectRatio="xMidYMid meet" href="${productImage}"/>`
      : `<text x="310" y="${productY + Math.round(productHeight / 2)}" font-family="Arial, sans-serif" font-size="30" font-weight="700" fill="#6f5944">上传产品图后展示主体</text>`
  }
  ${bullets.replaceAll('y="770', `y="${bulletsY}`).replaceAll('y="816', `y="${bulletsY + 46}`).replaceAll('y="862', `y="${bulletsY + 92}`)}
  <rect x="72" y="${footerY}" width="756" height="108" rx="14" fill="rgba(255,255,255,0.62)"/>
  <text x="104" y="${footerY + 60}" font-family="Arial, sans-serif" font-size="28" font-weight="800" fill="#2f251c">${style}</text>
  <text x="104" y="${footerY + 98}" font-family="Arial, sans-serif" font-size="20" fill="#6b5846">稳定合成预览：保留上传产品图作为主体</text>
</svg>`.trim();
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}

function setBusy(button, busy, text) {
  if (!button.dataset.label) button.dataset.label = button.textContent;
  button.disabled = busy;
  button.textContent = busy ? text : button.dataset.label;
}

async function generatePlan() {
  setBusy(els.planBtn, true, "正在规划...");
  els.inputHint.textContent = `正在分析 ${state.uploads.length} 张产品图和 ${state.referenceUploads.length} 张参考图。大图已压缩，通常 10-60 秒返回。`;
  try {
    const plan = await fetchJsonWithTimeout(apiUrl("/api/plan"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        uploads: state.uploads,
        referenceUploads: state.referenceUploads,
        settings: getSettings(),
        sellingPoints: els.sellingPoints.value,
        referenceLinks: els.referenceLinks.value,
      }),
    }, 180000);
    state.plan = plan;
    state.selectedId = plan.screens?.[0]?.id || null;
    renderPlan();
    els.generateAllBtn.disabled = false;
    els.exportPlanBtn.disabled = false;
    els.longImageBtn.disabled = true;
    els.toGenerateBtn.disabled = false;
    els.inputHint.textContent = plan.warning
      ? `已进入演示规划：${plan.warning}`
      : "规划完成，可以确认后逐屏生成。";
    setStep(3);
  } catch (error) {
    els.inputHint.textContent = `规划失败：${error.name === "AbortError" ? "分析超时，请减少图片数量或参考图后重试。" : error.message}`;
  } finally {
    setBusy(els.planBtn, false);
  }
}

function renderPlan() {
  if (!state.plan) return;
  els.planSummary.classList.remove("empty");
  const system = state.plan.visualSystem;
  els.planSummary.innerHTML = `
    <strong>${escapeHtml(state.plan.summary || "已生成详情页规划。")}</strong>
    ${
      system
        ? `<span>统一视觉：${escapeHtml(system.scene || "")} / ${escapeHtml(system.palette || "")} / ${escapeHtml(system.lighting || "")}</span>`
        : ""
    }
  `;
  els.screenList.innerHTML = state.plan.screens.map(screenCard).join("");
  for (const card of els.screenList.querySelectorAll(".screen-card")) {
    card.addEventListener("click", () => {
      state.selectedId = Number(card.dataset.id);
      renderPlan();
    });
  }
  bindScreenQuickActions();
  renderSelected();
  renderGenerationList();
}

function bindScreenQuickActions() {
  document.querySelectorAll(".generate-screen-btn").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const screen = state.plan?.screens?.find((item) => item.id === Number(button.dataset.id));
      if (!screen) return;
      state.selectedId = screen.id;
      await generateScreen(screen);
    });
  });
  document.querySelectorAll(".download-screen-btn").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const screen = state.plan?.screens?.find((item) => item.id === Number(button.dataset.id));
      if (!screen?.imageUrl) return;
      downloadScreen(screen);
    });
  });
}

function renderGenerationList() {
  if (!els.generationScreenList) return;
  if (!state.plan?.screens?.length) {
    els.generationScreenList.innerHTML = "";
    return;
  }
  els.generationScreenList.innerHTML = state.plan.screens
    .map((screen) => {
      const active = screen.id === state.selectedId ? " is-active" : "";
      const mode = screen.imageMode === "done" ? "已生成" : screen.imageMode === "loading" ? "生成中" : screen.imageMode === "failed" ? "失败" : "待生成";
      return `
        <button class="generation-screen-item${active}" data-id="${screen.id}">
          <span>${String(screen.id).padStart(2, "0")}</span>
          <strong>${escapeHtml(screen.title)}</strong>
          <small>${mode}</small>
        </button>
      `;
    })
    .join("");
  for (const item of els.generationScreenList.querySelectorAll(".generation-screen-item")) {
    item.addEventListener("click", () => {
      state.selectedId = Number(item.dataset.id);
      renderGenerationList();
      renderSelected();
    });
  }
}

function screenCard(screen) {
  const active = screen.id === state.selectedId ? " active" : "";
  const mode = screen.imageMode === "done" ? "已生成" : screen.imageMode === "loading" ? "生成中" : screen.imageMode === "failed" ? "失败" : "待生成";
  return `
    <article class="screen-card${active}" data-id="${screen.id}">
      <div class="screen-card-top">
        <h3>${screen.id}. ${escapeHtml(screen.title)}</h3>
        <span class="badge">${mode}</span>
      </div>
      <div class="title-line">${escapeHtml(screen.mainTitle)}</div>
      <p>${escapeHtml(screen.salesGoal)}</p>
      <div class="screen-card-actions">
        <button type="button" class="mini-btn generate-screen-btn" data-id="${screen.id}">${screen.imageUrl ? "重做" : "生成"}</button>
        <button type="button" class="mini-btn download-screen-btn" data-id="${screen.id}" ${screen.imageUrl ? "" : "disabled"}>下载</button>
      </div>
    </article>
  `;
}

function selectedScreen() {
  return state.plan?.screens?.find((screen) => screen.id === state.selectedId);
}

function renderSelected() {
  updatePreviewAspect();
  const screen = selectedScreen();
  if (!screen) {
    els.selectedScreen.className = "selected-box empty";
    els.selectedScreen.textContent = "选择一屏查看 Prompt 和生成预览。";
    els.generateOneBtn.disabled = true;
    els.downloadBtn.disabled = true;
    els.previewImage.style.display = "none";
    els.previewEmpty.style.display = "block";
    return;
  }

  els.selectedScreen.className = "selected-box";
  els.selectedScreen.innerHTML = `
    <h3>${screen.id}. ${escapeHtml(screen.title)}</h3>
    <dl>
      <dt>销售目的</dt>
      <dd>${escapeHtml(screen.salesGoal)}</dd>
      <dt>主标题</dt>
      <dd>${escapeHtml(screen.mainTitle)}</dd>
      <dt>布局</dt>
      <dd>${escapeHtml(screen.layout)}</dd>
      <dt>统一视觉</dt>
      <dd>${escapeHtml(state.plan.visualSystem?.referenceAesthetic || state.plan.visualSystem?.scene || "已生成统一视觉系统")}</dd>
      <dt>Prompt</dt>
      <dd><details><summary>查看完整生成提示词</summary><pre>${escapeHtml(screen.prompt)}</pre></details></dd>
    </dl>
  `;

  els.generateOneBtn.disabled = false;
  if (screen.imageUrl) {
    els.previewImage.src = screen.imageUrl;
    els.previewImage.style.display = "block";
    els.previewEmpty.style.display = "none";
    els.downloadBtn.disabled = false;
  } else {
    els.previewImage.style.display = "none";
    els.previewEmpty.style.display = "block";
    els.downloadBtn.disabled = true;
  }
  updateLongImageButton();
}

async function generateScreen(screen) {
  screen.imageMode = "loading";
  renderPlan();
  const settings = getSettings();
  const dimensions = outputDimensions(settings);
  const selectedImageModel = settings.imageModel;
  if (selectedImageModel === "layout-compose") {
    screen.imageUrl = localDemoImage(screen);
    screen.imageMode = "done";
    screen.imageProvider = "layout-compose";
    els.outputHint.textContent = `第 ${screen.id} 屏已生成 ${dimensions.width} x ${dimensions.height} 稳定合成预览，产品主体来自上传图片。`;
    renderPlan();
    return;
  }
  els.outputHint.textContent = `正在用 ${selectedImageModel} 生成第 ${screen.id} 屏：${screen.title}，目标尺寸 ${dimensions.width} x ${dimensions.height}`;
  try {
    const result = await fetchJsonWithTimeout(apiUrl("/api/generate-screen"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        screen,
        visualSystem: state.plan?.visualSystem || null,
        settings,
        uploads: state.uploads,
        referenceUploads: state.referenceUploads,
      }),
    }, 120000);
    if (result.error || !result.imageUrl) {
      screen.imageMode = "failed";
      screen.imageProvider = result.mode || "error";
      els.outputHint.textContent = `第 ${screen.id} 屏生成失败：${result.error || "没有返回图片"}。请重试当前屏，或减少参考图后再生成。`;
      return;
    }
    screen.imageUrl = await fitImageToOutputSize(result.imageUrl, settings);
    screen.imageMode = "done";
    screen.imageProvider = result.mode;
    els.outputHint.textContent = `第 ${screen.id} 屏已调用 ${result.mode} 生成，并适配为 ${dimensions.width} x ${dimensions.height}。`;
  } catch (error) {
    screen.imageUrl = "";
    screen.imageMode = "failed";
    screen.imageProvider = "error";
    els.outputHint.textContent = `第 ${screen.id} 屏生成失败：${error.message}`;
  } finally {
    renderPlan();
  }
}

async function generateCurrent() {
  const screen = selectedScreen();
  if (!screen) return;
  setBusy(els.generateOneBtn, true, "生成中...");
  try {
    await generateScreen(screen);
  } finally {
    setBusy(els.generateOneBtn, false);
  }
}

async function generateAll() {
  if (!state.plan?.screens?.length) return;
  setBusy(els.generateAllBtn, true, "逐屏生成中...");
  try {
    for (const screen of state.plan.screens) {
      state.selectedId = screen.id;
      await generateScreen(screen);
    }
  } finally {
    setBusy(els.generateAllBtn, false);
  }
}

function downloadCurrent() {
  const screen = selectedScreen();
  if (!screen?.imageUrl) return;
  downloadScreen(screen);
}

function downloadScreen(screen) {
  const a = document.createElement("a");
  a.href = screen.imageUrl;
  const { width, height } = outputDimensions();
  a.download = `detail-screen-${screen.id}-${width}x${height}.png`;
  a.click();
}

function updateLongImageButton() {
  if (!els.longImageBtn) return;
  const generated = state.plan?.screens?.filter((screen) => screen.imageUrl) || [];
  els.longImageBtn.disabled = generated.length < 2;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function downloadLongImage() {
  const screens = state.plan?.screens?.filter((screen) => screen.imageUrl) || [];
  if (screens.length < 2) return;
  setBusy(els.longImageBtn, true, "合成中...");
  try {
    const images = await Promise.all(screens.map((screen) => loadImage(screen.imageUrl)));
    const targetWidth = outputDimensions().width;
    const heights = images.map((img) => Math.round((img.naturalHeight / img.naturalWidth) * targetWidth));
    const totalHeight = heights.reduce((sum, height) => sum + height, 0);
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = totalHeight;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    let y = 0;
    images.forEach((img, index) => {
      ctx.drawImage(img, 0, y, targetWidth, heights[index]);
      y += heights[index];
    });
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = "detail-page-long-image.png";
    a.click();
  } finally {
    setBusy(els.longImageBtn, false);
  }
}

function exportPlan() {
  if (!state.plan) return;
  const blob = new Blob([JSON.stringify(state.plan, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "one-click-detail-page-plan.json";
  a.click();
  URL.revokeObjectURL(a.href);
}

async function checkStatus() {
  try {
    const status = await fetch(apiUrl("/api/status")).then((res) => res.json());
    els.geminiStatus.textContent = status.gemini
      ? `${status.geminiProvider === "yunwu" ? "云雾" : "Google"} ${status.geminiModel} 已配置`
      : "Gemini 演示模式";
    els.geminiStatus.className = `status-dot ${status.gemini ? "ready" : "demo"}`;
    els.imageStatus.textContent = status.image ? `默认 GPT Image2 图生图，可切 Gemini` : "未配置生图 API，可用本地预览";
    els.imageStatus.className = `status-dot ${status.image ? "ready" : "demo"}`;
  } catch {
    els.geminiStatus.textContent = "模型状态未知";
    els.imageStatus.textContent = "模型状态未知";
  }
}

els.imageInput.addEventListener("change", (event) => handleFiles(event.target.files));
els.referenceImageInput.addEventListener("change", (event) => handleReferenceFiles(event.target.files));
els.planBtn.addEventListener("click", generatePlan);
els.generateOneBtn.addEventListener("click", generateCurrent);
els.generateAllBtn.addEventListener("click", generateAll);
els.downloadBtn.addEventListener("click", downloadCurrent);
els.longImageBtn.addEventListener("click", downloadLongImage);
els.exportPlanBtn.addEventListener("click", exportPlan);
els.platform.addEventListener("change", () => {
  const preset = platformSizePresets[els.platform.value];
  if (preset) els.ratio.value = preset;
  updatePreviewAspect();
});
els.ratio.addEventListener("change", updatePreviewAspect);
els.resolution.addEventListener("change", updatePreviewAspect);

document.querySelectorAll(".next-btn").forEach((button) => {
  button.addEventListener("click", () => setStep(Number(button.dataset.nextStep)));
});

document.querySelectorAll(".prev-btn").forEach((button) => {
  button.addEventListener("click", () => setStep(Number(button.dataset.prevStep)));
});

document.querySelectorAll(".step-nav").forEach((button) => {
  button.addEventListener("click", () => {
    const target = Number(button.dataset.stepTarget);
    if (target >= 3 && !state.plan) return;
    setStep(target);
  });
});

updatePreviewAspect();
checkStatus();

function buildVisualSystemPrompt(system, settings) {
  if (!system) return "";
  return [
    `整套详情页必须统一：${system.scene || "同一套场景"}`,
    `色彩：${system.palette || settings.style || "统一色调"}`,
    `光线：${system.lighting || "统一自然光线"}`,
    `字体/排版：${system.typography || "统一标题层级和留白"}`,
    `构图：${system.composition || "产品主体比例和文字位置保持一致"}`,
    `人物策略：${system.modelDirection || modelDirectionText(settings)}`,
  ].filter(Boolean).join("；");
}

function modelDirectionText(settings) {
  const usageMap = {
    auto: "由 AI 根据产品判断是否加入人物",
    yes: "需要加入人物模特",
    no: "不要加入人物模特",
  };
  const typeMap = {
    auto: "按产品自动匹配模特类型",
    "adult-baby": "大人和婴儿两个模特，适合婴儿车、母婴床围、婴儿用品",
    "adult-child": "大人和儿童两个模特",
    adult: "成人模特",
    elderly: "老人模特",
    hand: "手部或局部演示模特",
    none: "无人物",
  };
  return `${usageMap[settings.modelUsage] || usageMap.auto}，${typeMap[settings.modelType] || typeMap.auto}`;
}
