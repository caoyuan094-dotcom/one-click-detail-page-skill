# Configuration Reference

Use `.env.example` as the only committed environment file.

## Planning Models

```bash
YUNWU_GEMINI_MODEL=gemini-3.5-flash
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.5-flash
```

The app prefers the OpenAI-compatible Yunwu Gemini route when `YUNWU_API_KEY` is available. It can fall back to Google Gemini when `GEMINI_API_KEY` is set.

## Image Models

```bash
YUNWU_API_BASE=https://yunwu.ai/v1
YUNWU_API_KEY=
YUNWU_IMAGE_MODEL=gpt-image-2

OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=
OPENAI_IMAGE_MODEL=gpt-image-2
```

If no image API key is configured, the UI can still use local layout preview mode.

## Local Runtime

```bash
PORT=3042
```

Run:

```bash
./start.sh
```

Then verify:

```bash
curl --noproxy '*' http://127.0.0.1:3042/api/status
```

If the launcher picked another port, use the printed URL.
