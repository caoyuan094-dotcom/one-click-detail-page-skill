function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function env(context, key) {
  return context?.env?.[key]
    || context?.bindings?.[key]
    || context?.vars?.[key]
    || (typeof process !== "undefined" && process.env ? process.env[key] : "")
    || "";
}

function fallbackPlan(payload, warning = "") {
  const settings = payload.settings || {};
  const count = Math.max(5, Math.min(15, Number(settings.screenCount || 6)));
  const productName = settings.productName || "该产品";
  const style = settings.style || "极简高级";
  const visualSystem = {
    scene: `${style}，统一真实电商详情页场景`,
    palette: "奶油白、浅灰、低饱和品牌色，整体干净统一",
    lighting: "柔和自然光，产品主体清晰，背景满版出血",
    typography: "现代中文无衬线字体，主标题清晰，卖点短标签克制",
    composition: "标题区、产品区、卖点标签区跨屏保持一致",
    typographyLock: "所有主标题同一字体风格、同一颜色、同一字号层级",
    layoutLock: "标题固定在上方或左上，产品主体占中下区域，背景铺满无白边",
    modelDirection: settings.modelUsage === "no" ? "不出现人物模特" : "根据产品使用逻辑加入自然模特",
    referenceAesthetic: "参考链接和参考图只提炼版式、色彩、光线和卖点组织方式",
  };
  const topics = [
    ["首屏主视觉", "建立第一眼高级感和停留理由", "第一眼，就想拥有"],
    ["核心卖点", "突出最重要的购买理由", "真正好用，藏在细节里"],
    ["材质工艺", "解释品质和耐用性", "看得见的质感"],
    ["使用场景", "让用户代入真实生活", "放进生活刚刚好"],
    ["细节展示", "降低用户疑虑", "每一处都为体验而来"],
    ["对比优势", "强化购买决策", "比想象更懂你"],
    ["适用人群", "明确谁适合买", "送给需要它的人"],
    ["品牌承诺", "收尾建立信任", "安心选择，放心使用"],
  ];
  const screens = Array.from({ length: count }, (_, index) => {
    const item = topics[index % topics.length];
    return {
      id: index + 1,
      title: item[0],
      salesGoal: item[1],
      mainTitle: `${productName}｜${item[2]}`.slice(0, 24),
      subtitle: "真实产品图为主体，统一视觉生成",
      copy: ["主体清晰", "风格统一", "满版无白边"],
      layout: "背景满版出血，产品主体居中偏下，标题位于上方留白区域，卖点标签在标题下方。",
      materials: ["产品主图", "细节图", "参考风格图"],
      visualDirection: `${visualSystem.scene}；${visualSystem.palette}；${visualSystem.lighting}`,
      mustAvoid: ["白边", "外框", "乱码", "产品变形", "虚假认证"],
      prompt: `为${settings.platform || "淘宝"}生成${productName}详情页第${index + 1}屏。${item[1]}。主标题只写“${item[2]}”。画面${style}，背景满版出血无白边，产品主体清晰，中文字体现代无衬线。`,
      negativePrompt: "白边，外框，乱码，产品变形，虚假认证，夸大功效",
      imageUrl: "",
      imageMode: "pending",
    };
  });
  return {
    mode: "edgeone-fallback",
    summary: `围绕${productName}生成一套${settings.platform || "电商"}详情页规划。`,
    hiddenAnalysisSummary: "EdgeOne 规划接口已返回结构化规划。",
    visualSystem,
    screens,
    warning,
  };
}

export async function onRequest(context) {
  let payload = {};
  try {
    const { request } = context;
    if (request.method !== "POST") {
      return json(fallbackPlan({}, "请使用 POST 请求生成规划。"));
    }
    payload = await request.json();
    const apiKey = env(context, "YUNWU_API_KEY") || env(context, "OPENAI_API_KEY");
    const baseUrl = (env(context, "YUNWU_API_BASE") || env(context, "OPENAI_BASE_URL") || "https://yunwu.ai/v1").replace(/\/$/, "");
    const model = env(context, "YUNWU_GEMINI_MODEL") || "gemini-3.5-flash";
    if (!apiKey) return json(fallbackPlan(payload, "未配置分析模型 API Key，已返回演示规划。"));

    const prompt = `你是顶级电商运营和详情页视觉规划师。请基于用户设置输出严格 JSON，不要 Markdown。字段包括 mode, summary, hiddenAnalysisSummary, visualSystem, screens。每屏包含 id,title,salesGoal,mainTitle,subtitle,copy,layout,materials,visualDirection,mustAvoid,prompt,negativePrompt,imageUrl,imageMode。要求多屏统一视觉，字体现代无衬线，背景满版无白边，最多 ${payload.settings?.screenCount || 6} 屏。用户输入：${JSON.stringify({ settings: payload.settings, sellingPoints: payload.sellingPoints, referenceLinks: payload.referenceLinks, uploads: (payload.uploads || []).map((x) => x.name), referenceUploads: (payload.referenceUploads || []).map((x) => x.name) })}`;
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.5,
        response_format: { type: "json_object" },
      }),
    });
    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || "";
    return json(JSON.parse(text));
  } catch (error) {
    return json(fallbackPlan(payload, `分析模型失败：${error.message}`));
  }
}
