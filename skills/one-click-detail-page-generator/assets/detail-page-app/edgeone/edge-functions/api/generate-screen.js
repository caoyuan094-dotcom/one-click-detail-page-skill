function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function cleanErrorMessage(error) {
  const raw = error?.message || String(error || "未知错误");
  if (raw.includes("<!doctype") || raw.includes("<html") || raw.includes("504")) {
    return "生图服务返回 504 超时。EdgeOne 当前不适合直接等待图片生成，请减少图片数量/切 1K，或把生图接口迁移到 Vercel/服务器长任务后端。";
  }
  return raw.slice(0, 500);
}

function asTextList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  if (typeof value === "string") return value.split(/[\/\n；;、,，]+/).map((item) => item.trim()).filter(Boolean);
  if (value && typeof value === "object") return Object.values(value).map((item) => String(item || "").trim()).filter(Boolean);
  return [];
}

function env(context, key) {
  return context?.env?.[key]
    || context?.bindings?.[key]
    || context?.vars?.[key]
    || (typeof process !== "undefined" && process.env ? process.env[key] : "")
    || "";
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

function ratioToSize(ratio, resolution = "1k") {
  const { width, height } = parseRatioDimensions(ratio);
  const aspect = width / height;
  const square = Math.abs(aspect - 1) < 0.12;
  const landscape = aspect > 1.12;
  if (resolution === "4k") return square ? "2048x2048" : landscape ? "3072x2048" : "2048x3072";
  if (resolution === "2k") return square ? "1536x1536" : landscape ? "2048x1536" : "1536x2048";
  return square ? "1024x1024" : landscape ? "1536x1024" : "1024x1536";
}

function parseDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:(.+?);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

async function callGeminiImage({ apiKey, baseUrl, model, prompt, uploads }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  const geminiBase = baseUrl.replace(/\/v1$/, "").replace(/\/$/, "");
  const parts = [{ text: prompt }];
  for (const file of uploads.slice(0, 3)) {
    const parsed = parseDataUrl(file.dataUrl);
    if (parsed) parts.push({ inlineData: { mimeType: parsed.mimeType, data: parsed.data } });
  }
  let response;
  try {
    response = await fetch(`${geminiBase}/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { temperature: 0.7 } }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  const data = await response.json();
  const part = data.candidates?.[0]?.content?.parts?.find((item) => item.inlineData?.data);
  if (!part) throw new Error("Gemini 没有返回图片");
  return `data:${part.inlineData.mimeType || "image/png"};base64,${part.inlineData.data}`;
}

async function callOpenAIImage({ apiKey, baseUrl, model, prompt, settings }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  let response;
  try {
    response = await fetch(`${baseUrl}/images/generations`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        size: ratioToSize(settings.ratio, settings.resolution),
        quality: "medium",
        n: 1,
        response_format: "url",
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  const data = await response.json();
  const item = data.data?.[0];
  if (item?.b64_json) return `data:image/png;base64,${item.b64_json}`;
  if (item?.url) return item.url;
  throw new Error("生图接口没有返回图片");
}

export async function onRequest(context) {
  try {
    const { request } = context;
    if (request.method !== "POST") {
      return json({ mode: "error", imageUrl: "", error: "请使用 POST 请求生成图片。" });
    }
    const payload = await request.json();
    const settings = payload.settings || {};
    const screen = payload.screen || {};
    const visualSystem = payload.visualSystem || {};
    const finalSize = outputSizeText(settings);
    const model = settings.imageModel || env(context, "YUNWU_IMAGE_MODEL") || "gpt-image-2";
    const apiKey = env(context, "YUNWU_API_KEY") || env(context, "OPENAI_API_KEY");
    const baseUrl = (env(context, "YUNWU_API_BASE") || env(context, "OPENAI_BASE_URL") || "https://yunwu.ai/v1").replace(/\/$/, "");
    if (!apiKey) return json({ mode: "error", imageUrl: "", error: "未配置生图 API Key" });

    const uploads = [...(payload.uploads || []), ...(payload.referenceUploads || [])].filter((file) => String(file.dataUrl || "").startsWith("data:image/"));
    const copy = asTextList(screen.copy).slice(0, 3);
    const prompt = `生成电商详情页单屏。全局视觉：${visualSystem.scene || ""}；${visualSystem.palette || ""}；${visualSystem.lighting || ""}；字体：${visualSystem.typography || "现代中文无衬线"}；版式：${visualSystem.layoutLock || visualSystem.composition || "统一留白和产品构图"}。最终输出尺寸：${finalSize} 像素，比例必须严格贴合这个画布。屏幕主题：${screen.title || ""}。主标题只写：${screen.mainTitle || ""}。副标题只写：${screen.subtitle || ""}。卖点标签只写：${copy.join(" / ")}。布局：${screen.layout || ""}。必须围绕上传产品图，背景满版出血到四边，不要白边、外框、乱码、虚假认证。`;
    const imageUrl = model === "gemini-3-pro-image-preview"
      ? await callGeminiImage({ apiKey, baseUrl, model, prompt, uploads })
      : await callOpenAIImage({ apiKey, baseUrl, model, prompt, settings });
    return json({ mode: model, imageUrl });
  } catch (error) {
    const message = error.name === "AbortError"
      ? "EdgeOne 云端函数等待生图超时。请切换到本地版式预览，或改用支持长任务的后端/Vercel/服务器部署生图接口。"
      : `EdgeOne 生图接口执行失败：${cleanErrorMessage(error)}`;
    return json({ mode: "error", imageUrl: "", error: message });
  }
}
