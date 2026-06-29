import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const port = Number(process.env.PORT || 3042);

loadEnvFile(path.join(__dirname, ".env.local"));
loadEnvFile(path.join(__dirname, ".env"));
loadEnvFile("/Users/caoyuan/Desktop/公众号文章/.env");
loadEnvFile("/Users/caoyuan/Desktop/产品定义ai/.env.local");

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
};
const jsonHeaders = { "content-type": "application/json; charset=utf-8", ...corsHeaders };

function loadEnvFile(file) {
  if (!existsSync(file)) return;
  const text = readFileSync(file, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const idx = line.indexOf("=");
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    value = value.replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function send(res, status, data, headers = jsonHeaders) {
  res.writeHead(status, headers);
  if (Buffer.isBuffer(data) || typeof data === "string") {
    res.end(data);
  } else {
    res.end(JSON.stringify(data));
  }
}

async function readJson(req) {
  let body = "";
  let size = 0;
  const limit = Number(process.env.REQUEST_BODY_LIMIT_BYTES || 18 * 1024 * 1024);
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("上传图片总体积过大，请删除部分图片或压缩后再试。");
    body += chunk;
  }
  return body ? JSON.parse(body) : {};
}

function parseDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:(.+?);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

function imagePartsFromUploads(uploads) {
  return (uploads || [])
    .slice(0, 8)
    .map((file) => parseDataUrl(file.dataUrl))
    .filter(Boolean)
    .map((img) => ({
      inlineData: {
        mimeType: img.mimeType,
        data: img.data,
      },
    }));
}

function openAIImageContentFromUploads(uploads) {
  return (uploads || [])
    .slice(0, 8)
    .filter((file) => file.dataUrl && String(file.dataUrl).startsWith("data:image/"))
    .map((file) => ({
      type: "image_url",
      image_url: {
        url: file.dataUrl,
      },
    }));
}

function dataUrlToBlob(dataUrl, fallbackName = "reference.png") {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return null;
  const bytes = Buffer.from(parsed.data, "base64");
  const ext = parsed.mimeType.includes("jpeg") ? "jpg" : parsed.mimeType.includes("webp") ? "webp" : "png";
  return {
    blob: new Blob([bytes], { type: parsed.mimeType }),
    fileName: fallbackName.replace(/\.[^.]+$/, "") + "." + ext,
  };
}

function buildPlanningPrompt(payload) {
  const settings = payload.settings || {};
  const sellingPoints = payload.sellingPoints?.trim() || "用户没有填写详细卖点，请根据图片和电商详情页常见结构合理补全，但不要编造硬性参数、认证或医疗功效。";
  const referenceLinks = payload.referenceLinks?.trim() || "用户未提供参考链接。";
  const imageNames = (payload.uploads || []).map((file, index) => `${index + 1}. ${file.name || "未命名图片"}`).join("\n");
  const referenceImageNames = (payload.referenceUploads || []).map((file, index) => `${index + 1}. ${file.name || "未命名参考图"}`).join("\n");
  const modelUsageMap = {
    auto: "由 AI 根据产品和平台判断是否加入模特",
    yes: "需要加入模特",
    no: "不要加入模特",
  };
  const modelTypeMap = {
    auto: "按产品自动匹配",
    "adult-baby": "大人 + 婴儿两个模特，适合婴儿车、母婴床围、婴儿用品",
    "adult-child": "大人 + 儿童两个模特",
    adult: "成人模特",
    elderly: "老人模特",
    hand: "手部/局部演示模特",
    none: "无人物",
  };
  return `
你是一名顶级电商运营负责人、品牌营销策略师和视觉 Prompt 设计师。你的规划要同时站在两个角度：
1. 一线电商运营：关注首屏停留、转化、下单顾虑、参数解释、卖点排序、移动端可读性。
2. 顶级品牌营销：参考苹果式营销思维，少讲功能堆砌，多讲用户得到的结果、生活方式、情绪价值、信任感和购买理由。

请为“一键详情页 V1”生成详情页规划。

用户设置：
- 产品名称：${settings.productName || "用户未填写，请优先根据上传图片识别"}
- 生成屏数：${settings.screenCount || 6}
- 语言：${settings.language || "中文"}
- 发布平台：${settings.platform || "淘宝"}
- 图片比例/尺寸：${settings.ratio || "750x1000 单屏"}
- 输出分辨率：${settings.resolution || "1k"}
- 视觉风格：${settings.style || "干净可信赖"}
- 模特策略：${modelUsageMap[settings.modelUsage] || modelUsageMap.auto}
- 模特类型：${modelTypeMap[settings.modelType] || modelTypeMap.auto}

用户卖点/说明：
${sellingPoints}

优秀详情页参考链接：
${referenceLinks}

用户上传图片清单：
${imageNames || "用户未上传图片"}

用户上传参考风格图清单：
${referenceImageNames || "用户未上传参考风格图"}

内部任务：
1. 先读取上传图片，识别图中实际产品是什么、外观结构、颜色材质、细节特征和可见文字；这一步在后台完成，不要输出完整分析报告。
2. 提炼营销卖点，而不是只复述功能。把参数翻译成用户利益，把图片细节翻译成购买理由。
3. 只输出前台需要看的“详情页规划”。
4. 每一屏都要足够详细，便于后续调用生图模型。
5. 不要编造产品认证、参数、医疗功效、绝对化承诺。
6. 规划必须围绕上传图片中的实际产品展开；如果用户填写的产品名称、卖点和图片产品不一致，优先相信图片，并在 hiddenAnalysisSummary 里简短提示“不一致”。
7. 尽量使用用户上传的真实产品图作为主体，AI 负责背景、排版、文案、场景和视觉风格。
8. 每一屏要明确：它解决哪个下单阻力，激发哪个购买动机，主标题要像优秀品牌广告语，不要像说明书。
9. 整套详情页必须像同一个品牌、同一次拍摄、同一个设计系统产出的连续页面；不能每一屏一个风格。
10. 参考链接和参考风格图只用于提炼审美规律，例如色彩、版式、字体层级、场景、卖点标签组织、情绪氛围；不得把参考图中的产品当成用户产品，不得照抄品牌名、Logo、人物肖像、文案和受版权保护画面。
11. 如果产品属于母婴、婴儿车、床围、儿童用品等，通常需要大人 + 婴儿/儿童模特来建立使用场景和信任感；如果用户选择不要模特，则必须遵守不要人物。
12. 模特必须符合产品真实使用逻辑：婴儿车可出现年轻父母和婴儿，轮椅可出现老人/护理者，厨具可出现手部操作，工业产品通常不需要生活模特。
13. 生成每一屏 prompt 时，都必须重复全局视觉系统关键词，保证后续生图跨屏一致。
14. 字体审美必须以电商转化和移动端可读性为先：优先使用现代中文无衬线字体风格、清晰黑体/圆体、品牌旗舰店式大标题；不要使用手写体、毛笔字、艺术花字、复杂描边字、发光字、变形字。
15. 每屏文案必须克制：主标题 8-16 个中文以内，副标题 8-24 个中文以内，卖点标签最多 3 个，每个标签 2-6 个中文。提示词里要明确“只出现这些文案，不添加其他字”。
16. 整套详情页需要固定一个 typographyLock 和 layoutLock：标题位置、标签样式、文字颜色、文字大小关系、留白方式必须跨屏统一，不允许每屏换字体或换排版逻辑。

请严格输出 JSON，不要 Markdown，不要解释。JSON 结构如下：
{
  "mode": "real",
  "summary": "一句话概括这套详情页的销售策略",
  "hiddenAnalysisSummary": "后台分析摘要，最多80字",
  "visualSystem": {
    "scene": "整套详情页统一场景，例如暖色儿童房/高级厨房/科技展台",
    "palette": "统一色彩，例如奶油白、浅木色、暖阳金、低饱和棕",
    "lighting": "统一光线，例如清晨自然侧光、柔和阴影",
    "typography": "统一字体和排版层级，必须是清晰现代中文无衬线字体风格，例如标题用品牌黑体/圆体、正文细黑、卖点小胶囊；禁止手写体和艺术花字",
    "composition": "统一构图规则，例如上方/左侧固定标题区、中下部产品主体、右侧生活场景延展",
    "typographyLock": "跨屏固定字体规则，例如所有主标题同一种现代黑体风格、同一颜色、同一字号层级、同一行距",
    "layoutLock": "跨屏固定版式规则，例如标题始终在上方左侧，卖点胶囊始终在标题下方，产品主体始终占画面中下区域",
    "modelDirection": "人物模特策略，例如年轻妈妈+婴儿贯穿首屏和场景屏，细节屏只用手部或无人物",
    "referenceAesthetic": "从参考链接/参考图提炼出来的审美规律"
  },
  "screens": [
    {
      "id": 1,
      "title": "首屏主视觉",
      "salesGoal": "这一屏的销售目的",
      "mainTitle": "主标题",
      "subtitle": "副标题",
      "copy": ["短文案1", "短文案2", "短文案3"],
      "layout": "画面布局，说明产品、文字、标签、背景的位置",
      "materials": ["建议使用的素材"],
      "visualDirection": "视觉风格和背景建议",
      "mustAvoid": ["不要出现的内容"],
      "prompt": "用于生图模型的中文详细提示词",
      "negativePrompt": "负向提示词"
    }
  ]
}
`.trim();
}

function parseJsonText(text) {
  const raw = String(text || "").trim().replace(/^```json\s*|\s*```$/g, "");
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
    throw new Error("模型返回内容不是有效 JSON");
  }
}

async function callYunwuGeminiPlan(payload) {
  const apiKey = process.env.YUNWU_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("缺少 YUNWU_API_KEY / OPENAI_API_KEY");
  const baseUrl = (process.env.YUNWU_API_BASE || process.env.OPENAI_BASE_URL || "https://yunwu.ai/v1").replace(/\/$/, "");
  const model = process.env.YUNWU_GEMINI_MODEL || process.env.GEMINI_MODEL || "gemini-3.5-flash";
  const userContent = [
    { type: "text", text: buildPlanningPrompt(payload) },
    ...openAIImageContentFromUploads(payload.uploads),
    ...openAIImageContentFromUploads(payload.referenceUploads),
  ];
  const response = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: "你只输出严格 JSON，不输出 Markdown，不解释。",
        },
        {
          role: "user",
          content: userContent,
        },
      ],
      temperature: 0.55,
      response_format: { type: "json_object" },
    }),
  }, Number(process.env.ANALYSIS_TIMEOUT_MS || 120000));
  if (!response.ok) throw new Error(`云雾 Gemini 调用失败：${response.status} ${await response.text()}`);
  const result = await response.json();
  const text = result.choices?.[0]?.message?.content;
  if (!text) throw new Error("云雾 Gemini 没有返回规划内容");
  return normalizePlan(parseJsonText(text), payload, `yunwu:${model}`);
}

async function callGeminiPlan(payload) {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!key) throw new Error("缺少 GEMINI_API_KEY / GOOGLE_API_KEY");
  const model = process.env.GEMINI_MODEL || "gemini-1.5-pro";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const parts = [
    { text: buildPlanningPrompt(payload) },
    ...imagePartsFromUploads(payload.uploads),
    ...imagePartsFromUploads(payload.referenceUploads),
  ];
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: { temperature: 0.55, responseMimeType: "application/json" },
    }),
  });
  if (!response.ok) throw new Error(`Gemini 调用失败：${response.status} ${await response.text()}`);
  const result = await response.json();
  const text = result.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
  if (!text) throw new Error("Gemini 没有返回规划内容");
  const parsed = parseJsonText(text);
  return normalizePlan(parsed, payload, "gemini");
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function normalizePlan(plan, payload, provider) {
  const count = Number(payload.settings?.screenCount || plan.screens?.length || 6);
  const screens = Array.isArray(plan.screens) ? plan.screens.slice(0, count) : [];
  const visualSystem = normalizeVisualSystem(plan.visualSystem, payload);
  return {
    mode: provider,
    summary: plan.summary || "围绕产品真实图片、核心卖点和平台详情页结构生成一套可上传的电商详情页。",
    hiddenAnalysisSummary: plan.hiddenAnalysisSummary || "已完成后台产品识别、素材分类、卖点提炼和详情页结构规划。",
    visualSystem,
    screens: screens.map((screen, index) => ({
      id: index + 1,
      title: screen.title || `第 ${index + 1} 屏`,
      salesGoal: screen.salesGoal || "承接用户浏览决策，突出核心购买理由。",
      mainTitle: screen.mainTitle || screen.title || "核心卖点展示",
      subtitle: screen.subtitle || "",
      copy: Array.isArray(screen.copy) ? screen.copy : [],
      layout: screen.layout || "产品图为主体，左侧或上方配置标题、卖点标签和辅助说明。",
      materials: Array.isArray(screen.materials) ? screen.materials : [],
      visualDirection: screen.visualDirection || `${visualSystem.scene}，${visualSystem.palette}，${visualSystem.lighting}`,
      mustAvoid: Array.isArray(screen.mustAvoid) ? screen.mustAvoid : ["产品结构变形", "文字乱码", "虚假认证", "夸大功效", "白边", "海报外框"],
      prompt: withGlobalVisualPrompt(screen.prompt || `${screen.title || "电商详情页"}，使用上传产品图作为主体，${screen.layout || ""}`, visualSystem, payload.settings || {}),
      negativePrompt: screen.negativePrompt || "产品变形，文字乱码，低清晰度，夸大承诺，虚假认证，白边，外框，白色画布边距，海报卡片边框",
      imageUrl: "",
      imageMode: "pending",
    })),
  };
}

function normalizeVisualSystem(system, payload) {
  const settings = payload.settings || {};
  const modelDirection = buildModelDirection(settings);
  return {
    scene: system?.scene || inferScene(settings),
    palette: system?.palette || inferPalette(settings),
    lighting: system?.lighting || "柔和自然光，低对比阴影，整套页面保持同一种光线方向",
    typography: system?.typography || "中文大标题清晰醒目，正文克制，卖点标签统一为小胶囊或短句，不要文字乱码",
    composition: system?.composition || "每屏保持同一套边距、产品主体比例、标题层级和卖点标签位置",
    modelDirection: system?.modelDirection || modelDirection,
    referenceAesthetic: system?.referenceAesthetic || "参考平台高转化详情页的清晰层级、真实场景、强主卖点和移动端可读性，但不照抄具体品牌。",
  };
}

function inferScene(settings) {
  const style = String(settings.style || "");
  const productName = String(settings.productName || "");
  if (/母婴|婴儿|儿童|童车|床围|宝宝|baby/i.test(style + productName)) return "温暖奶油色儿童房或亲子卧室场景";
  if (/科技|数码|智能|工业/i.test(style + productName)) return "克制科技展台或深色产品展示场景";
  if (/工厂|生产|材质|工艺/i.test(style + productName)) return "干净工厂、材质实验室或工艺展示场景";
  return "统一的真实生活方式场景，背景干净，产品是绝对主体";
}

function inferPalette(settings) {
  const style = String(settings.style || "");
  if (/温暖|母婴|家居|老人/i.test(style)) return "奶油白、浅木色、暖米色、低饱和棕色";
  if (/科技|深色/i.test(style)) return "深石墨、冷白光、克制蓝色点缀";
  if (/促销|爆款/i.test(style)) return "高对比白底、品牌主色点缀、重点价格/卖点色统一";
  return "低饱和中性色、清晰黑色文字、少量品牌强调色";
}

function buildModelDirection(settings) {
  const usage = settings.modelUsage || "auto";
  const type = settings.modelType || "auto";
  if (usage === "no" || type === "none") return "全套页面不出现人物模特，只展示产品、细节和场景。";
  if (type === "adult-baby") return "首屏和场景屏可出现年轻妈妈/爸爸与婴儿两个模特，动作自然、安全、真实；细节屏减少人物，只用产品或手部演示。";
  if (type === "adult-child") return "首屏和场景屏可出现成人与儿童两个模特，动作自然，突出陪伴和使用关系。";
  if (type === "elderly") return "可出现老人或护理者模特，突出安全、轻松、可信赖，不制造病态恐惧。";
  if (type === "hand") return "只使用手部或局部操作演示，不出现完整人物肖像。";
  if (type === "adult") return "可出现成人模特，动作自然，突出真实使用场景。";
  return "AI 根据产品判断是否需要人物；母婴/婴儿车优先使用大人 + 婴儿，工业/参数页减少人物。";
}

function parseRatioDimensions(ratio) {
  const match = String(ratio || "").match(/(\d{3,5})\s*[x×]\s*(\d{3,5})/i);
  if (!match) return { width: 750, height: 1000 };
  return { width: Number(match[1]), height: Number(match[2]) };
}

function outputSizeFromSettings(settings = {}) {
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

function outputSizeText(settings = {}) {
  const size = outputSizeFromSettings(settings);
  return `${size.width}x${size.height}`;
}

function withGlobalVisualPrompt(prompt, visualSystem, settings) {
  const finalSize = outputSizeText(settings);
  return `
整套详情页统一视觉系统：${visualSystem.scene}；统一色彩：${visualSystem.palette}；统一光线：${visualSystem.lighting}；统一字体排版：${visualSystem.typography}；字体锁定：${visualSystem.typographyLock || visualSystem.typography}；统一构图：${visualSystem.composition}；版式锁定：${visualSystem.layoutLock || visualSystem.composition}；人物策略：${visualSystem.modelDirection}。
单屏任务：${prompt}
必须保持与同套详情页其他屏一致，像同一个品牌、同一次拍摄、同一套设计系统。中文字体必须清晰可读，主标题优先，卖点短标签克制，禁止乱码、假字、水印和额外文案。画面必须满版出血，背景铺满到四个边缘，不要白边、不要外框、不要把详情页画成白色卡片或海报截图。发布平台：${settings.platform || "淘宝"}，尺寸：${settings.ratio || "750x1000 单屏"}，输出分辨率：${settings.resolution || "1k"}，最终交付画布：${finalSize} 像素。
`.trim();
}

function demoPlan(payload) {
  const settings = payload.settings || {};
  const count = Number(settings.screenCount || 6);
  const style = settings.style || "干净可信赖";
  const platform = settings.platform || "淘宝";
  const language = settings.language || "中文";
  const productName = settings.productName || "该产品";
  const productLine = payload.sellingPoints?.trim() || "用户未填写卖点，系统将根据图片自动提炼产品优势。";
  const visualSystem = normalizeVisualSystem(null, payload);
  const base = [
    ["首屏主视觉", "3 秒内让用户知道产品是什么、适合谁、为什么值得继续看。", "一眼看懂，核心卖点先打动", "使用产品正面图作为主体，文字区域保留足够留白。"],
    ["用户痛点", "把用户正在遇到的问题讲清楚，让需求变得具体。", "解决真实使用中的不方便", "使用生活场景图或浅色场景背景，配 3 个痛点标签。"],
    ["核心卖点", "集中展示 3 到 4 个最能影响购买决策的优势。", "核心优势，一屏讲清", "使用细节图组合，采用卖点卡片和标注线。"],
    ["产品细节", "用细节证明品质，降低用户对做工和材质的担心。", "细节看得见，品质更放心", "局部放大细节，突出材质、结构、工艺和使用便利性。"],
    ["参数规格", "把尺寸、规格、适用范围讲清楚，减少售前咨询。", "关键参数，购买前看清楚", "表格化信息，避免拥挤，移动端字体足够大。"],
    ["场景展示", "让用户想象产品在真实生活中的使用方式。", "多场景适用，日常更省心", "产品主体叠加真实使用氛围，背景干净不抢主体。"],
    ["对比说明", "通过前后对比或竞品痛点对比强化选择理由。", "为什么选这一款", "左右对比布局，避免贬低具体品牌。"],
    ["售后保障", "用服务承诺和购买保障收尾，降低下单顾虑。", "买得清楚，用得安心", "使用可信赖的深浅色块和图标式信息组织。"],
    ["材质工艺", "把看不见的品质变成看得见的购买理由。", "好用，来自每一个细节", "材质纹理、结构节点和工艺细节分区展示，保持同一套色调。"],
    ["安全信任", "降低用户对安全性、稳定性、耐用性的担心。", "安全感，是最重要的配置", "用真实使用场景、结构说明和注意事项表达信任，不编造认证。"],
    ["使用步骤", "让用户快速理解怎么用、怎么安装、怎么收纳。", "上手简单，日常少费心", "三到四步流程图，搭配产品局部或手部演示。"],
    ["尺寸适配", "帮助用户判断是否适合自己的空间、人群或使用场景。", "买之前，看清是否适合", "尺寸示意和适用场景并列，信息清晰不拥挤。"],
    ["人群场景", "明确目标人群，让用户产生代入感。", "为真正需要它的人设计", "同一场景内展示目标人群使用状态，人物策略与全局一致。"],
    ["品牌实力", "建立品牌、工厂或服务可信度，支撑客单价。", "不止好看，更有长期保障", "品牌理念、服务承诺、工艺背书分区展示，不夸大。"],
    ["购买总结", "在详情页末尾强化下单理由，减少犹豫。", "现在选择，日常更安心", "总结核心卖点、适用人群和购买保障，形成最后转化。"],
  ];
  const screens = base.slice(0, count).map((item, index) => {
    const singlePrompt = `生成${platform}电商详情页第${index + 1}屏：${item[0]}。${item[1]} 主标题：${item[2]}。使用用户上传的真实产品图作为主体，画面${style}，移动端阅读清晰，构图要求：${item[3]}。不要改变产品结构，不要生成虚假认证，不要出现乱码文字。`;
    return {
      id: index + 1,
      title: item[0],
      salesGoal: item[1],
      mainTitle: `${productName}｜${item[2]}`,
      subtitle: productLine.length > 48 ? productLine.slice(0, 48) + "..." : productLine,
      copy: ["突出真实产品图", "移动端清晰易读", "不夸大参数与功效"],
      layout: item[3],
      materials: ["优先使用用户上传的产品图", "可搭配细节图或参考风格图"],
      visualDirection: `${visualSystem.scene}，${visualSystem.palette}，适配${platform}详情页，语言为${language}。`,
      mustAvoid: ["产品主体变形", "文字乱码", "虚假认证", "夸大功效", "过度复杂背景"],
      prompt: withGlobalVisualPrompt(singlePrompt, visualSystem, settings),
      negativePrompt: "产品结构错误，产品变形，文字乱码，低清晰度，虚假认证，夸大功效，杂乱背景，跨屏风格不一致",
      imageUrl: "",
      imageMode: "pending",
    };
  });
  return {
    mode: "demo",
    summary: `已按${platform}详情页逻辑规划 ${screens.length} 屏，核心卖点来源：${productLine}`,
    hiddenAnalysisSummary: "演示模式：未调用 Gemini，但已按 V1 规则模拟后台分析和详情页规划。",
    visualSystem,
    screens,
  };
}

function ratioToSize(ratio, resolution = "1k") {
  const { width, height } = parseRatioDimensions(ratio);
  const aspect = width / height;
  const square = Math.abs(aspect - 1) < 0.12;
  const landscape = aspect > 1.12;
  if (resolution === "4k") return square ? "2048x2048" : landscape ? "3072x2048" : "2048x3072";
  if (resolution === "2k") return square ? "1536x1536" : landscape ? "2048x1536" : "1536x2048";
  return square ? "1024x1024" : landscape ? "1536x1024" : "1024x1536";
}

async function callImageModel(payload) {
  const apiKey = process.env.YUNWU_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("缺少 YUNWU_API_KEY / OPENAI_API_KEY");
  const baseUrl = (process.env.YUNWU_API_BASE || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const screen = payload.screen || {};
  const settings = payload.settings || {};
  const visualSystem = normalizeVisualSystem(payload.visualSystem, payload);
  const finalSize = outputSizeText(settings);
  const requestedModel = settings.imageModel || process.env.YUNWU_IMAGE_MODEL || process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";
  const allowedModels = new Set(["gpt-image-2", "gemini-3-pro-image-preview"]);
  const primaryModel = allowedModels.has(requestedModel) ? requestedModel : "gpt-image-2";
  const prompt = `
你是一名电商详情页视觉设计师。请生成一张单屏电商详情页图片。

全局视觉系统：
- 统一场景：${visualSystem.scene}
- 统一色彩：${visualSystem.palette}
- 统一光线：${visualSystem.lighting}
- 统一字体排版：${visualSystem.typography}
- 字体锁定：${visualSystem.typographyLock || visualSystem.typography}
- 统一构图规则：${visualSystem.composition}
- 版式锁定：${visualSystem.layoutLock || visualSystem.composition}
- 人物模特策略：${visualSystem.modelDirection}
- 参考审美规律：${visualSystem.referenceAesthetic}
- 用户选择的最终输出尺寸：${finalSize} 像素，比例必须严格贴合这个画布。
- 图片输入说明：产品图是必须保留的真实产品主体；参考风格图只用于学习构图、色彩、字体层级、场景氛围和卖点表达，不得把参考图里的产品替换成主体产品。

屏幕主题：${screen.title}
销售目的：${screen.salesGoal}
主标题：${screen.mainTitle}
副标题：${screen.subtitle || ""}
短文案：${(screen.copy || []).join(" / ")}
布局：${screen.layout}
视觉方向：${screen.visualDirection}
文字与排版硬性要求：
1. 本屏需要由模型直接完成完整详情页视觉，不依赖后期本地叠字。
2. 画面里只允许出现以下文案：主标题“${screen.mainTitle || ""}”；副标题“${screen.subtitle || ""}”；卖点标签“${(screen.copy || []).slice(0, 3).join(" / ")}”。不要自己添加额外中文、英文、水印、价格、二维码、品牌名、参数表或认证标识。
3. 主标题必须清晰可读，使用现代中文无衬线字体风格，类似高端电商品牌黑体/圆体；禁止手写体、书法体、花字、变形字、艺术字、描边字、发光字。
4. 文案数量要少：主标题 1 行为主，最多 2 行；副标题最多 1 行；卖点最多 3 个短标签；不要堆满参数。
5. 字体层级必须统一：主标题最大，副标题次之，卖点标签最小；所有文字与产品不能互相遮挡，文字区域必须有足够留白和高对比背景。
6. 多屏详情页必须像同一个品牌、同一次拍摄、同一套版式系统：同一色调、同一光线、同一字体风格、同一留白方式、同一标签样式、同一标题位置逻辑。
7. 如果模型不擅长生成完美小字，请优先保证主标题清晰，弱化或省略小字，不要生成乱码。
8. 画面必须满版出血，背景、地面或场景必须延伸到图片四个边缘；禁止白边、白色外框、海报卡片边、截图边框、安全留白边。

产品与画面要求：参考图片中的产品就是必须展示的真实产品主体。生成时必须保持产品外观、结构、颜色、材质和关键细节一致，不能换成其他产品，不能凭空改造产品。AI 负责产品、背景、场景氛围、人物模特、卖点视觉化和最终排版成图。画面适合移动端电商详情页；不要出现乱码文字、水印、假 logo、虚假认证；不要夸大功效；不要白边或外框。必须和整套详情页其他屏保持同一品牌视觉、同一色调、同一光线、同一模特策略。
负向要求：${screen.negativePrompt || ""}
`.trim();

  const imageTimeoutMs = Math.max(Number(process.env.YUNWU_IMAGE_TIMEOUT_MS || process.env.IMAGE_TIMEOUT_MS || 180000), 180000);
  const uploadImages = [
    ...(payload.uploads || []).map((file) => ({ ...file, role: "product" })),
    ...(payload.referenceUploads || []).map((file) => ({ ...file, role: "reference" })),
  ]
    .filter((file) => file.dataUrl && String(file.dataUrl).startsWith("data:image/"))
    .slice(0, 6);

  return await callSingleImageModel({ apiKey, baseUrl, model: primaryModel, prompt, settings, uploadImages });
}

async function callSingleImageModel({ apiKey, baseUrl, model, prompt, settings, uploadImages }) {
  if (model === "gemini-3-pro-image-preview") {
    return await callGeminiImageModel({ apiKey, baseUrl, model, prompt, uploadImages });
  }
  let response;
  let endpoint = "images/generations";
  const imageTimeoutMs = Math.max(Number(process.env.YUNWU_IMAGE_TIMEOUT_MS || process.env.IMAGE_TIMEOUT_MS || 180000), 180000);
  const supportsImageInput = model === "gemini-3-pro-image-preview";
  if (uploadImages.length && supportsImageInput) {
    endpoint = "images/edits";
    const form = new FormData();
    form.set("model", model);
    form.set("prompt", prompt);
    form.set("size", ratioToSize(settings.ratio, settings.resolution));
    form.set("quality", "medium");
    form.set("n", "1");
    form.set("response_format", "b64_json");
    uploadImages.slice(0, 3).forEach((file, index) => {
      const converted = dataUrlToBlob(file.dataUrl, file.name || `reference-${index + 1}.png`);
      if (!converted) return;
      form.append(index === 0 ? "image" : "image[]", converted.blob, converted.fileName);
    });
    response = await fetchWithTimeout(`${baseUrl}/images/edits`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
    }, imageTimeoutMs);
  } else {
    response = await fetchWithTimeout(`${baseUrl}/images/generations`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        prompt: uploadImages.length && !supportsImageInput
          ? `${prompt}\n\n注意：当前选择的 ${model} 走文生图接口，不直接读取上传图片。请严格根据上述产品描述和规划生成；如需更强图片参考，请在界面手动切换到 gemini-3-pro-image-preview。`
          : prompt,
        size: ratioToSize(settings.ratio, settings.resolution),
        quality: "medium",
        n: 1,
        response_format: "b64_json",
      }),
    }, imageTimeoutMs);
  }
  if (!response.ok) throw new Error(`生图 API 调用失败：${response.status} ${await response.text()}`);
  const data = await response.json();
  const item = data.data?.[0];
  if (item?.b64_json) return { imageUrl: `data:image/png;base64,${item.b64_json}`, model: `${model}:${endpoint}` };
  if (item?.url) return { imageUrl: item.url, model: `${model}:${endpoint}` };
  throw new Error("生图 API 没有返回图片");
}

async function callGeminiImageModel({ apiKey, baseUrl, model, prompt, uploadImages }) {
  const imageTimeoutMs = Math.max(Number(process.env.YUNWU_IMAGE_TIMEOUT_MS || process.env.IMAGE_TIMEOUT_MS || 180000), 180000);
  const parts = [{ text: prompt }];
  for (const file of uploadImages.slice(0, 3)) {
    const parsed = parseDataUrl(file.dataUrl);
    if (!parsed) continue;
    parts.push({
      inlineData: {
        mimeType: parsed.mimeType,
        data: parsed.data,
      },
    });
  }
  const geminiBase = baseUrl.replace(/\/v1$/, "").replace(/\/$/, "");
  const response = await fetchWithTimeout(`${geminiBase}/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: { temperature: 0.7 },
    }),
  }, imageTimeoutMs);
  if (!response.ok) throw new Error(`Gemini 生图调用失败：${response.status} ${await response.text()}`);
  const data = await response.json();
  const part = data.candidates?.[0]?.content?.parts?.find((item) => item.inlineData?.data);
  if (part?.inlineData?.data) {
    const mime = part.inlineData.mimeType || "image/png";
    return { imageUrl: `data:${mime};base64,${part.inlineData.data}`, model: `${model}:generateContent` };
  }
  const text = data.candidates?.[0]?.content?.parts?.map((item) => item.text || "").join("").trim();
  throw new Error(text || "Gemini 生图没有返回图片");
}

function escapeXml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function demoImage(payload) {
  const screen = payload.screen || {};
  const settings = payload.settings || {};
  const title = escapeXml(screen.mainTitle || screen.title || "详情页单屏");
  const subtitle = escapeXml(screen.subtitle || screen.salesGoal || "");
  const style = escapeXml(settings.style || "干净可信赖");
  const copy = (screen.copy || []).slice(0, 3);
  const bullets = copy.map((line, index) => `<text x="72" y="${675 + index * 58}" font-size="28" fill="#1f2937">• ${escapeXml(line)}</text>`).join("");
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200" viewBox="0 0 900 1200">
  <rect width="900" height="1200" fill="#f7f4ef"/>
  <rect x="42" y="42" width="816" height="1116" rx="26" fill="#ffffff" stroke="#d8d2c7"/>
  <text x="72" y="128" font-family="Arial, sans-serif" font-size="28" fill="#6b7280">AI 详情页单屏 · 演示生成</text>
  <text x="72" y="210" font-family="Arial, sans-serif" font-size="58" font-weight="700" fill="#111827">${title}</text>
  <foreignObject x="72" y="245" width="740" height="110">
    <div xmlns="http://www.w3.org/1999/xhtml" style="font-family:Arial,'PingFang SC',sans-serif;font-size:28px;line-height:1.45;color:#374151;">${subtitle}</div>
  </foreignObject>
  <rect x="92" y="405" width="716" height="210" rx="22" fill="#e8eef6" stroke="#cbd5e1"/>
  <circle cx="274" cy="510" r="74" fill="#c6d4e7"/>
  <rect x="380" y="455" width="270" height="112" rx="20" fill="#ffffff" stroke="#94a3b8"/>
  <text x="410" y="522" font-family="Arial, sans-serif" font-size="30" font-weight="700" fill="#334155">产品图占位</text>
  ${bullets}
  <rect x="72" y="925" width="756" height="120" rx="18" fill="#111827"/>
  <text x="112" y="990" font-family="Arial, sans-serif" font-size="32" font-weight="700" fill="#ffffff">${style}</text>
  <text x="112" y="1035" font-family="Arial, sans-serif" font-size="22" fill="#d1d5db">真实 API 配置后将调用 GPT Image2 生成正式图片</text>
  <text x="72" y="1116" font-family="Arial, sans-serif" font-size="20" fill="#9ca3af">${escapeXml(screen.title || "")}</text>
</svg>`.trim();
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

export async function createPlan(payload) {
  const errors = [];
  try {
    return await callYunwuGeminiPlan(payload);
  } catch (error) {
    errors.push(error.message);
  }
  try {
    return await callGeminiPlan(payload);
  } catch (error) {
    errors.push(error.message);
    const plan = demoPlan(payload);
    plan.warning = errors.join("；");
    return plan;
  }
}

export async function generateScreenImage(payload) {
  try {
    const result = await callImageModel(payload);
    return { mode: result.model, imageUrl: result.imageUrl };
  } catch (error) {
    return { mode: "error", imageUrl: "", error: error.message };
  }
}

export function getRuntimeStatus() {
  const yunwuKey = Boolean(process.env.YUNWU_API_KEY || process.env.OPENAI_API_KEY);
  const googleKey = Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY);
  return {
    gemini: yunwuKey || googleKey,
    geminiProvider: yunwuKey ? "yunwu" : googleKey ? "google" : "demo",
    geminiModel: process.env.YUNWU_GEMINI_MODEL || process.env.GEMINI_MODEL || "gemini-3.5-flash",
    image: Boolean(process.env.YUNWU_API_KEY || process.env.OPENAI_API_KEY),
    imageModel: process.env.YUNWU_IMAGE_MODEL || process.env.OPENAI_IMAGE_MODEL || "gpt-image-2",
    imageModels: ["gpt-image-2", "gemini-3-pro-image-preview"],
    imageBaseUrl: process.env.YUNWU_API_BASE || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
  };
}

async function handlePlan(req, res) {
  const payload = await readJson(req);
  return send(res, 200, await createPlan(payload));
}

async function handleGenerate(req, res) {
  const payload = await readJson(req);
  return send(res, 200, await generateScreenImage(payload));
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requested = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const filePath = path.normalize(path.join(publicDir, requested));
  if (!filePath.startsWith(publicDir)) return send(res, 403, "Forbidden", { "content-type": "text/plain" });
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("not file");
    const ext = path.extname(filePath);
    const types = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".jpg": "image/jpeg",
    };
    send(res, 200, await readFile(filePath), { "content-type": types[ext] || "application/octet-stream" });
  } catch {
    send(res, 404, "Not found", { "content-type": "text/plain; charset=utf-8" });
  }
}

export async function appHandler(req, res) {
  try {
    if (req.method === "OPTIONS") return send(res, 204, "", corsHeaders);
    if (req.method === "POST" && req.url === "/api/plan") return await handlePlan(req, res);
    if (req.method === "POST" && req.url === "/api/generate-screen") return await handleGenerate(req, res);
    if (req.method === "GET" && req.url === "/api/status") {
      return send(res, 200, getRuntimeStatus());
    }
    return await serveStatic(req, res);
  } catch (error) {
    send(res, 500, { error: error.message });
  }
}

export default appHandler;

const isEntrypoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  const server = createServer(appHandler);
  server.listen(port, "127.0.0.1", () => {
    console.log(`一键详情页 V1 running at http://127.0.0.1:${port}`);
  });
}
