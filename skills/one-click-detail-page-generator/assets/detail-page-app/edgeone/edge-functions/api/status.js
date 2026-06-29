function env(context, key) {
  return context?.env?.[key]
    || context?.bindings?.[key]
    || context?.vars?.[key]
    || (typeof process !== "undefined" && process.env ? process.env[key] : "")
    || "";
}

export async function onRequest(context) {
  const yunwuKey = Boolean(env(context, "YUNWU_API_KEY") || env(context, "OPENAI_API_KEY"));
  const googleKey = Boolean(env(context, "GEMINI_API_KEY") || env(context, "GOOGLE_API_KEY") || env(context, "GOOGLE_GENERATIVE_AI_API_KEY"));
  return new Response(JSON.stringify({
    gemini: yunwuKey || googleKey,
    geminiProvider: yunwuKey ? "yunwu" : googleKey ? "google" : "demo",
    geminiModel: env(context, "YUNWU_GEMINI_MODEL") || env(context, "GEMINI_MODEL") || "gemini-3.5-flash",
    image: Boolean(env(context, "YUNWU_API_KEY") || env(context, "OPENAI_API_KEY")),
    imageModel: env(context, "YUNWU_IMAGE_MODEL") || env(context, "OPENAI_IMAGE_MODEL") || "gpt-image-2",
    imageModels: ["gpt-image-2", "gemini-3-pro-image-preview"],
    imageBaseUrl: env(context, "YUNWU_API_BASE") || env(context, "OPENAI_BASE_URL") || "https://api.openai.com/v1",
  }), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
