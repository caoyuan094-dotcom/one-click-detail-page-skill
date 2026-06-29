# 一键详情页 V1

面向电商运营的傻瓜式淘宝详情页生成工具。

## 流程

1. 上传产品素材
2. 填写平台、屏数、风格和卖点
3. AI 生成每一屏详情页规划
4. 逐屏生成图片，不满意就单屏重做

后台会隐藏执行产品分析报告，前台只展示详情页规划。

## 启动

双击：

```text
一键启动-详情页生成器.command
```

命令行：

```bash
./start.sh
```

打开：

```text
http://127.0.0.1:3042
```

如果 3042 被占用，启动脚本会自动尝试 3043、3044 等后续端口，并在终端里打印实际地址。

## API 配置

没有 API key 时也能试用完整流程，系统会进入演示模式。

如需真实调用模型，复制 `.env.example` 为 `.env.local`，填入：

```bash
GEMINI_API_KEY=你的 Gemini key
GEMINI_MODEL=gemini-1.5-pro

YUNWU_API_BASE=https://yunwu.ai/v1
YUNWU_API_KEY=你的云雾 key
YUNWU_IMAGE_MODEL=gpt-image-2
```

也兼容 OpenAI 风格配置：

```bash
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=你的 OpenAI key
OPENAI_IMAGE_MODEL=gpt-image-2
```

## 接口

- `GET /api/status`：查看模型配置状态
- `POST /api/plan`：调用 Gemini 生成详情页规划，失败时返回演示规划
- `POST /api/generate-screen`：调用 GPT Image2 生成单屏图片，失败时返回演示图

## 说明

真实产品图会上传给分析接口用于规划。当前 V1 生图接口主要使用规划 Prompt 生成单屏图片；后续可以升级为编辑/参考图生图，以更稳定保留产品主体。
