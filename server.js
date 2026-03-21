require("dotenv").config();
const express = require("express");
const https   = require("https");
const path    = require("path");

const app        = express();
const PORT       = process.env.PORT || 3000;
const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
const MODEL      = "gemini-2.0-flash";

app.use(express.json({ limit: "60mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ── Conversão: formato Anthropic → Gemini ─────────────────────────────────
function toGeminiParts(content) {
  if (typeof content === "string") return [{ text: content }];
  return content.map(item => {
    if (item.type === "text")  return { text: item.text };
    if (item.type === "image") return { inlineData: { mimeType: item.source.media_type, data: item.source.data } };
    return { text: "" };
  }).filter(p => p.text !== "" || p.inlineData);
}

function buildGeminiBody(system, messages, maxTokens) {
  const contents = [];
  for (const msg of messages) {
    const role  = msg.role === "assistant" ? "model" : "user";
    const parts = toGeminiParts(msg.content);
    if (contents.length && contents[contents.length - 1].role === role) {
      contents[contents.length - 1].parts.push(...parts);
    } else {
      contents.push({ role, parts });
    }
  }
  const body = {
    contents,
    generationConfig: { maxOutputTokens: maxTokens || 4000, temperature: 0.7 },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  return body;
}

// ── POST /api/chat → proxy Gemini ────────────────────────────────────────
app.post("/api/chat", (req, res) => {
  if (!GEMINI_KEY) {
    return res.status(500).json({
      error: "GEMINI_API_KEY não configurada — obtenha grátis em https://aistudio.google.com/apikey"
    });
  }

  const { system, messages, max_tokens } = req.body;
  const geminiBody = buildGeminiBody(system, messages, max_tokens);
  const payload    = JSON.stringify(geminiBody);

  res.setHeader("Content-Type",  "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection",    "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");

  const options = {
    hostname: "generativelanguage.googleapis.com",
    path:     `/v1beta/models/${MODEL}:streamGenerateContent?alt=sse&key=${GEMINI_KEY}`,
    method:   "POST",
    headers:  { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
  };

  const apiReq = https.request(options, apiRes => {
    let buf = "";
    apiRes.on("data", chunk => {
      buf += chunk.toString();
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (!raw || raw === "[DONE]") continue;
        try {
          const evt        = JSON.parse(raw);
          const candidates = evt.candidates || [];
          if (candidates[0]) {
            const parts = candidates[0].content?.parts || [];
            for (const part of parts) {
              if (part.text) {
                res.write(`data: ${JSON.stringify({ type: "text", text: part.text })}\n\n`);
              }
            }
          }
        } catch (_) {}
      }
    });
    apiRes.on("end", () => { res.write("data: [DONE]\n\n"); res.end(); });
  });

  apiReq.on("error", err => {
    res.write(`data: ${JSON.stringify({ type: "error", message: err.message })}\n\n`);
    res.end();
  });

  apiReq.write(payload);
  apiReq.end();
});

// SPA fallback
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, () => {
  console.log(`\n✅ FORECLOSURE 5.0 — http://localhost:${PORT}`);
  console.log(`   Modelo: Google Gemini 2.0 Flash (gratuito)`);
  console.log(`   API Key: ${GEMINI_KEY ? "configurada ✓" : "⚠ NÃO configurada"}\n`);
});
