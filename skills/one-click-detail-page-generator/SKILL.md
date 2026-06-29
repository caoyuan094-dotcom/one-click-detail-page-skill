---
name: one-click-detail-page-generator
description: Package, run, customize, or deploy the One-Click Detail Page Generator for ecommerce operators. Use when a user wants an AI product-detail-page generator, Taobao/Tmall/JD/Amazon/Shopify detail-page workflow, local one-click startup, Tencent Cloud EdgeOne or Vercel deployment, or help keeping API keys out of source control.
---

# One-Click Detail Page Generator

Use this skill to deliver a runnable ecommerce detail-page generator from the bundled template in `assets/detail-page-app`.

## Workflow

1. Copy the template app from `assets/detail-page-app` into the user's target directory.
2. Preserve `.env.example`, but never create or commit real `.env`, `.env.local`, platform state folders, logs, or zip exports.
3. For local use, run `./start.sh`; it creates `.env.local` from `.env.example` if missing, picks an available port starting at `3042`, and opens the browser.
4. Verify with `npm run check` and `curl --noproxy '*' http://127.0.0.1:<port>/api/status`.
5. For deployment, configure secrets through the provider environment variable system, not checked-in files.
6. Before sharing, scan for secrets and ignored local state.

## Template Capabilities

- Four-step operator UI: upload product materials, fill product/platform/settings, generate planning, generate/export screens.
- Local demo mode works without API keys.
- Real planning uses Gemini or OpenAI-compatible chat models.
- Real image generation uses GPT Image compatible models or Gemini image preview through an OpenAI-compatible provider.
- Supports exact output canvas resizing for common ecommerce sizes such as `750x1000`, `800x800`, `1500x1500`, and `1125x2436`.
- Includes Tencent Cloud EdgeOne and Vercel deployment adapters.

## Secret Handling

Never upload these files or folders:

```text
.env
.env.local
.edgeone/
.vercel/
.playwright-cli/
*.zip
tef_dist/
```

Use only `.env.example` in public repos. If a user wants hosted deployment, ask them to provide provider access or tell viewers to contact the project owner for deployment service.

## Deployment Notes

For Tencent Cloud EdgeOne:

1. Install and log in to the EdgeOne CLI.
2. Set environment variables from a local env file with `scripts/set-edgeone-env.sh .env.local`, or set them manually in the EdgeOne console.
3. Deploy the sanitized `edgeone/` directory or a temporary staging copy that excludes `.env`.
4. Verify the deployed URL, `/api/status`, and frontend assets after deployment.

For Vercel:

1. Configure production secrets through `vercel env`.
2. Deploy from the app root.
3. Verify `/api/status`.

## Required Environment Variables

Read `references/configuration.md` when configuring providers, deployment, or troubleshooting model status.
