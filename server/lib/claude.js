// AI Client — รองรับหลายค่าย: Claude (Anthropic) · Gemini (Google) · Grok (xAI)
// เลือกค่ายและใส่ API Key ผ่านหน้าตั้งค่า หรือตัวแปรแวดล้อม ANTHROPIC_API_KEY (fallback)
import { badRequest } from './http.js';
import { all, run } from './db.js';

// ══════════════════════════════════════════════════════════════
//  Provider definitions
// ══════════════════════════════════════════════════════════════

// ชื่อรุ่นเริ่มต้น — เลือกแบบ "latest alias" ไว้ก่อนเมื่อค่ายนั้นมีให้
// เพราะชื่อรุ่นแบบระบุเวอร์ชันจะถูกยกเลิกเป็นระยะ แล้วระบบจะพังเงียบ ๆ
// ถ้าต้องการล็อกเวอร์ชัน ให้ตั้งค่าเองในหน้าตั้งค่า AI (มีปุ่มดึงรายชื่อรุ่นที่ใช้ได้จริง)
export const PROVIDERS = {
  claude: { label: 'Claude (Anthropic)', smart: 'claude-sonnet-5', fast: 'claude-haiku-4-5-20251001', keyPrefix: 'sk-ant-', keyUrl: 'https://console.anthropic.com/settings/keys' },
  gemini: { label: 'Gemini (Google)', smart: 'gemini-pro-latest', fast: 'gemini-flash-latest', keyPrefix: 'AI', keyUrl: 'https://aistudio.google.com/apikey' },
  grok:   { label: 'Grok (xAI)',      smart: 'grok-4',            fast: 'grok-4-fast',          keyPrefix: 'xai-', keyUrl: 'https://console.x.ai' },
};

// ══════════════════════════════════════════════════════════════
//  Config cache — อ่านจาก app_settings + fallback จาก env
// ══════════════════════════════════════════════════════════════

let _cache = null;

export async function getConfig() {
  if (_cache) return _cache;
  try {
    const rows = await all("SELECT key, value FROM app_settings WHERE key LIKE 'ai_%'");
    const m = Object.fromEntries(rows.map(r => [r.key, r.value]));
    const provider = m.ai_provider || 'claude';
    const p = PROVIDERS[provider] || PROVIDERS.claude;
    _cache = {
      provider,
      api_key: m.ai_api_key || process.env.ANTHROPIC_API_KEY || '',
      model_smart: m.ai_model_smart || process.env.AI_MODEL_SMART || p.smart,
      model_fast: m.ai_model_fast || process.env.AI_MODEL_FAST || p.fast,
    };
  } catch {
    _cache = {
      provider: 'claude',
      api_key: process.env.ANTHROPIC_API_KEY || '',
      model_smart: process.env.AI_MODEL_SMART || PROVIDERS.claude.smart,
      model_fast: process.env.AI_MODEL_FAST || PROVIDERS.claude.fast,
    };
  }
  return _cache;
}

export function refreshConfig() { _cache = null; }

// Eager-load on import
getConfig().catch(() => {});

export const MODEL = {
  get SMART() { return _cache?.model_smart || process.env.AI_MODEL_SMART || PROVIDERS.claude.smart; },
  get FAST() { return _cache?.model_fast || process.env.AI_MODEL_FAST || PROVIDERS.claude.fast; },
};

export function aiEnabled() {
  if (_cache) return Boolean(_cache.api_key);
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * แปลง error ของผู้ให้บริการเป็นข้อความที่บอกได้ว่าต้องไปแก้ตรงไหน
 * แยก "รุ่นใช้ไม่ได้" ออกจาก "Key ผิด" ให้ชัด — สองอย่างนี้แก้คนละที่
 * และผู้ให้บริการมักคืน 400 เหมือนกันทั้งคู่
 */
function aiErrMessage(status, raw, label, model) {
  const s = String(raw ?? '');
  const modelIssue = /no longer available|not found|does not exist|unsupported|deprecated|invalid model|unknown model/i.test(s)
    || (status === 404 && /model/i.test(s));
  if (modelIssue) {
    return `รุ่น AI "${model}" ใช้งานไม่ได้แล้ว — เปิดหน้า ตั้งค่า → ตั้งค่า AI แล้วกด `
      + `"ดึงรายชื่อรุ่นที่ใช้ได้" เพื่อเลือกรุ่นใหม่ หรือกด "ใช้รุ่นเริ่มต้น"\n(${label} แจ้งว่า: ${s})`;
  }
  if (status === 401 || status === 403) return `${label} API Key ไม่ถูกต้องหรือหมดอายุ — ตรวจสอบในหน้าตั้งค่า AI`;
  if (status === 429) return 'เรียกใช้ AI ถี่เกินไป — กรุณารอสักครู่';
  if (status >= 500) return `${label} ขัดข้องชั่วคราว — กรุณาลองใหม่อีกครั้ง`;
  if (/api[ _-]?key/i.test(s)) return `${label} API Key ไม่ถูกต้อง — ตรวจสอบในหน้าตั้งค่า AI`;
  return `${label}: ${s}`;
}

function requireKey() {
  const key = _cache?.api_key || process.env.ANTHROPIC_API_KEY;
  if (!key) throw badRequest('ยังไม่ได้ตั้งค่า AI — กรุณาใส่ API Key ในหน้าตั้งค่า', 'AI_DISABLED');
  return key;
}

// ══════════════════════════════════════════════════════════════
//  Settings API helpers
// ══════════════════════════════════════════════════════════════

function maskKey(key) {
  if (!key) return '';
  if (key.length <= 8) return '••••';
  return key.slice(0, 6) + '••••' + key.slice(-4);
}

export async function getAISettings() {
  const cfg = await getConfig();
  return {
    provider: cfg.provider,
    has_key: Boolean(cfg.api_key),
    key_hint: maskKey(cfg.api_key),
    model_smart: cfg.model_smart,
    model_fast: cfg.model_fast,
    providers: PROVIDERS,
  };
}

export async function saveAISettings(body) {
  const { provider, api_key, model_smart, model_fast } = body;
  if (provider && !PROVIDERS[provider]) throw badRequest('ค่าย AI ไม่ถูกต้อง');

  const pairs = [];
  if (provider !== undefined) pairs.push(['ai_provider', provider]);
  if (api_key !== undefined) pairs.push(['ai_api_key', api_key]);
  if (model_smart !== undefined) pairs.push(['ai_model_smart', model_smart]);
  if (model_fast !== undefined) pairs.push(['ai_model_fast', model_fast]);

  for (const [key, value] of pairs) {
    await run(
      `INSERT INTO app_settings (key, value) VALUES (?,?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      key, String(value));
  }
  refreshConfig();
  return await getAISettings();
}

/**
 * ดึงรายชื่อรุ่นที่ API Key นี้ใช้ได้จริงจากผู้ให้บริการ
 * ชื่อรุ่นเปลี่ยน/ถูกยกเลิกได้ตลอด การถามจากต้นทางจึงแม่นกว่าการฝังชื่อไว้ในโค้ด
 */
export async function listAIModels(query = {}) {
  const cfg = await getConfig();
  const provider = query.provider || cfg.provider;
  if (!PROVIDERS[provider]) throw badRequest('ค่าย AI ไม่ถูกต้อง');
  let key = query.api_key;
  if (!key || key === '__current__') key = cfg.api_key;
  if (!key) throw badRequest('กรุณาใส่ API Key ก่อน จึงจะดึงรายชื่อรุ่นได้');

  try {
    switch (provider) {
      case 'gemini': return { provider, models: await _modelsGemini(key) };
      case 'grok': return { provider, models: await _modelsGrok(key) };
      default: return { provider, models: await _modelsClaude(key) };
    }
  } catch (err) {
    return { provider, models: [], error: err.message };
  }
}

async function _modelsClaude(key) {
  const res = await fetchTO('https://api.anthropic.com/v1/models?limit=100', {
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
  }, 15_000);
  if (!res.ok) throw apiErr(res, 'Claude');
  const data = await res.json();
  return (data.data ?? []).map((m) => ({ id: m.id, label: m.display_name || m.id }));
}

async function _modelsGemini(key) {
  const res = await fetchTO(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}&pageSize=200`,
    {}, 15_000);
  if (!res.ok) throw apiErr(res, 'Gemini');
  const data = await res.json();
  return (data.models ?? [])
    // เอาเฉพาะรุ่นที่สร้างข้อความได้ ตัดรุ่น embedding/รูปภาพออก
    .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
    .map((m) => ({ id: String(m.name).replace(/^models\//, ''), label: m.displayName || m.name }));
}

async function _modelsGrok(key) {
  const res = await fetchTO('https://api.x.ai/v1/models', {
    headers: { authorization: `Bearer ${key}` },
  }, 15_000);
  if (!res.ok) throw apiErr(res, 'Grok');
  const data = await res.json();
  return (data.data ?? []).map((m) => ({ id: m.id, label: m.id }));
}

export async function testAIConnection(body) {
  const { provider, api_key } = body;
  if (!provider) throw badRequest('กรุณาเลือกค่าย AI');
  if (!PROVIDERS[provider]) throw badRequest('ค่าย AI ไม่ถูกต้อง');
  let key = api_key;
  if (!key || key === '__current__') {
    const cfg = await getConfig();
    key = cfg.api_key;
  }
  if (!key) throw badRequest('กรุณาใส่ API Key');
  const p = PROVIDERS[provider];
  try {
    switch (provider) {
      case 'claude': await _testClaude(key, p.fast); break;
      case 'gemini': await _testGemini(key, p.fast); break;
      case 'grok':   await _testGrok(key, p.fast); break;
    }
    return { ok: true, provider: p.label };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function _testClaude(key, model) {
  const res = await fetchTO('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 10, messages: [{ role: 'user', content: 'Hi' }] }),
  }, 15_000);
  if (!res.ok) throw apiErr(res, 'Claude');
}

async function _testGemini(key, model) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const res = await fetchTO(url, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Hi' }] }], generationConfig: { maxOutputTokens: 10 } }),
  }, 15_000);
  if (!res.ok) throw apiErr(res, 'Gemini');
}

async function _testGrok(key, model) {
  const res = await fetchTO('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, max_tokens: 10, messages: [{ role: 'user', content: 'Hi' }] }),
  }, 15_000);
  if (!res.ok) throw apiErr(res, 'Grok');
}

async function apiErr(res, name) {
  const text = await res.text().catch(() => '');
  if (res.status === 401 || res.status === 403) return new Error('API Key ไม่ถูกต้อง');
  let msg = `${name} ตอบกลับผิดพลาด (${res.status})`;
  try { msg = JSON.parse(text)?.error?.message ?? msg; } catch {}
  return new Error(msg);
}

// ══════════════════════════════════════════════════════════════
//  Public API — ใช้ interface เดิม แต่ dispatch ไปยัง provider ที่เลือก
// ══════════════════════════════════════════════════════════════

export async function callClaude({ messages, system, tools, model, maxTokens = 2048, temperature, _forceToolName } = {}) {
  const cfg = await getConfig();
  requireKey();
  const m = model || cfg.model_smart;
  const args = { messages, system, tools, model: m, maxTokens, temperature, apiKey: cfg.api_key, forceToolName: _forceToolName };

  switch (cfg.provider) {
    case 'gemini': return callGeminiProvider(args);
    case 'grok':   return callGrokProvider(args);
    default:       return callClaudeProvider(args);
  }
}

export async function callClaudeJSON({ messages, system, schema, name = 'result', description = 'ส่งผลลัพธ์', model = MODEL.SMART, maxTokens = 4096 }) {
  const reply = await callClaude({
    messages, system, model, maxTokens,
    tools: [{ name, description, input_schema: schema }],
    _forceToolName: name,
  });
  const use = toolUsesOf(reply).find((t) => t.name === name);
  if (!use) throw badRequest('AI ไม่ได้ส่งผลลัพธ์ตามรูปแบบที่กำหนด — กรุณาลองใหม่', 'AI_NO_RESULT');
  return { data: use.input, usage: reply.usage };
}

export const textOf = (reply) =>
  (reply?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();

export const toolUsesOf = (reply) => (reply?.content ?? []).filter((c) => c.type === 'tool_use');

export function imageBlock(dataUrl) {
  const m = /^data:([^;]+);base64,(.+)$/s.exec(String(dataUrl ?? ''));
  if (!m) throw badRequest('รูปภาพไม่ถูกต้อง — ต้องเป็น data URL แบบ base64');
  const [, media_type, data] = m;
  if (!/^image\/(jpeg|png|gif|webp)$/.test(media_type))
    throw badRequest('รองรับเฉพาะไฟล์ JPG, PNG, GIF, WEBP');
  return { type: 'image', source: { type: 'base64', media_type, data } };
}

export function pdfBlock(dataUrl) {
  const m = /^data:application\/pdf;base64,(.+)$/s.exec(String(dataUrl ?? ''));
  if (!m) throw badRequest('ไฟล์ PDF ไม่ถูกต้อง');
  return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: m[1] } };
}

// ══════════════════════════════════════════════════════════════
//  Provider: Claude (Anthropic)
// ══════════════════════════════════════════════════════════════

async function callClaudeProvider({ messages, system, tools, model, maxTokens, temperature, apiKey, forceToolName }) {
  const body = { model, max_tokens: maxTokens, messages };
  if (system) body.system = system;
  if (tools?.length) body.tools = tools;
  if (forceToolName) body.tool_choice = { type: 'tool', name: forceToolName };
  if (temperature !== undefined) body.temperature = temperature;

  const res = await fetchTO('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let raw = `AI ตอบกลับผิดพลาด (${res.status})`;
    try { raw = JSON.parse(text)?.error?.message ?? raw; } catch {}
    throw badRequest(aiErrMessage(res.status, raw, 'Claude', model), 'AI_ERROR');
  }
  return await res.json();
}

// ══════════════════════════════════════════════════════════════
//  Provider: Gemini (Google)
// ══════════════════════════════════════════════════════════════

async function callGeminiProvider({ messages, system, tools, model, maxTokens, temperature, apiKey, forceToolName }) {
  const { contents, systemInstruction } = toGeminiContents(messages, system);
  const body = { contents, generationConfig: { maxOutputTokens: maxTokens } };
  if (systemInstruction) body.system_instruction = systemInstruction;
  if (tools?.length) body.tools = [{ function_declarations: tools.map(t => ({ name: t.name, description: t.description, parameters: t.input_schema })) }];
  if (forceToolName && tools?.length) body.tool_config = { function_calling_config: { mode: 'ANY' } };
  if (temperature !== undefined) body.generationConfig.temperature = temperature;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetchTO(url, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let raw = `Gemini ตอบกลับผิดพลาด (${res.status})`;
    try { raw = JSON.parse(text)?.error?.message ?? raw; } catch {}
    throw badRequest(aiErrMessage(res.status, raw, 'Gemini', model), 'AI_ERROR');
  }
  return fromGeminiResponse(await res.json());
}

function toGeminiContents(messages, system) {
  const contents = [];
  for (const msg of messages) {
    const role = msg.role === 'assistant' ? 'model' : 'user';
    const raw = typeof msg.content === 'string' ? [{ type: 'text', text: msg.content }]
      : Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: String(msg.content) }];
    const parts = [];
    for (const c of raw) {
      if (c.type === 'text') { parts.push({ text: c.text }); continue; }
      if (c.type === 'image') { parts.push({ inlineData: { mimeType: c.source.media_type, data: c.source.data } }); continue; }
      if (c.type === 'document') { parts.push({ inlineData: { mimeType: c.source.media_type, data: c.source.data } }); continue; }
      if (c.type === 'tool_use') {
        const part = { functionCall: { name: c.name, args: c.input } };
        if (c._geminiSig) part.thoughtSignature = c._geminiSig;
        parts.push(part);
        continue;
      }
      if (c.type === 'tool_result') {
        const name = _findToolName(messages, c.tool_use_id);
        let response;
        try { response = JSON.parse(c.content); } catch { response = { text: c.content }; }
        parts.push({ functionResponse: { name, response } });
        continue;
      }
      parts.push({ text: JSON.stringify(c) });
    }
    if (parts.length) contents.push({ role, parts });
  }
  return { contents, systemInstruction: system ? { parts: [{ text: system }] } : undefined };
}

function fromGeminiResponse(data) {
  const cand = data.candidates?.[0];
  if (!cand?.content) throw badRequest('Gemini ไม่ได้ตอบกลับ — กรุณาลองใหม่', 'AI_NO_RESULT');
  const parts = cand.content.parts || [];
  const content = [];
  let hasToolUse = false;
  let seq = 0;
  for (const p of parts) {
    if (p.text != null) content.push({ type: 'text', text: p.text });
    if (p.functionCall) {
      hasToolUse = true;
      content.push({
        type: 'tool_use', id: `g_${p.functionCall.name}_${seq++}`,
        name: p.functionCall.name, input: p.functionCall.args || {},
        // Gemini 3+ บังคับให้ส่ง thoughtSignature กลับมาพร้อม functionCall เดิม
        // ไม่งั้นจะตีกลับว่า "missing a thought_signature" — เก็บติดไว้กับ tool_use
        _geminiSig: p.thoughtSignature ?? null,
      });
    }
  }
  return {
    content,
    stop_reason: hasToolUse ? 'tool_use' : 'end_turn',
    usage: { input_tokens: data.usageMetadata?.promptTokenCount || 0, output_tokens: data.usageMetadata?.candidatesTokenCount || 0 },
  };
}

// ══════════════════════════════════════════════════════════════
//  Provider: Grok (xAI) — OpenAI-compatible
// ══════════════════════════════════════════════════════════════

async function callGrokProvider({ messages, system, tools, model, maxTokens, temperature, apiKey, forceToolName }) {
  const body = { model, max_tokens: maxTokens, messages: toOpenAIMessages(messages, system) };
  if (tools?.length) body.tools = tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));
  if (forceToolName && tools?.length) body.tool_choice = { type: 'function', function: { name: forceToolName } };
  if (temperature !== undefined) body.temperature = temperature;

  const res = await fetchTO('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let raw = `Grok ตอบกลับผิดพลาด (${res.status})`;
    try { raw = JSON.parse(text)?.error?.message ?? raw; } catch {}
    throw badRequest(aiErrMessage(res.status, raw, 'Grok', model), 'AI_ERROR');
  }
  return fromOpenAIResponse(await res.json());
}

function toOpenAIMessages(messages, system) {
  const out = [];
  if (system) out.push({ role: 'system', content: system });
  for (const msg of messages) {
    const raw = typeof msg.content === 'string' ? [{ type: 'text', text: msg.content }]
      : Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: String(msg.content) }];

    if (msg.role === 'user') {
      const toolResults = raw.filter(c => c.type === 'tool_result');
      if (toolResults.length) {
        for (const tr of toolResults) out.push({ role: 'tool', tool_call_id: tr.tool_use_id, content: typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content) });
        const rest = raw.filter(c => c.type !== 'tool_result');
        if (rest.length) out.push({ role: 'user', content: _toOpenAIContent(rest) });
      } else {
        out.push({ role: 'user', content: _toOpenAIContent(raw) });
      }
    } else if (msg.role === 'assistant') {
      const texts = raw.filter(c => c.type === 'text').map(c => c.text).join('\n');
      const toolCalls = raw.filter(c => c.type === 'tool_use').map(c => ({
        id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input) },
      }));
      const m = { role: 'assistant' };
      if (texts) m.content = texts;
      else m.content = null;
      if (toolCalls.length) m.tool_calls = toolCalls;
      out.push(m);
    }
  }
  return out;
}

function _toOpenAIContent(blocks) {
  if (blocks.every(c => c.type === 'text')) return blocks.map(c => c.text).join('\n');
  return blocks.map(c => {
    if (c.type === 'text') return { type: 'text', text: c.text };
    if (c.type === 'image') return { type: 'image_url', image_url: { url: `data:${c.source.media_type};base64,${c.source.data}` } };
    return { type: 'text', text: JSON.stringify(c) };
  });
}

function fromOpenAIResponse(data) {
  const choice = data.choices?.[0];
  if (!choice?.message) throw badRequest('Grok ไม่ได้ตอบกลับ — กรุณาลองใหม่', 'AI_NO_RESULT');
  const msg = choice.message;
  const content = [];
  if (msg.content) content.push({ type: 'text', text: msg.content });
  let hasToolUse = false;
  if (msg.tool_calls?.length) {
    hasToolUse = true;
    for (const tc of msg.tool_calls) {
      let input = {};
      try { input = JSON.parse(tc.function.arguments || '{}'); } catch {}
      content.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input });
    }
  }
  return {
    content,
    stop_reason: hasToolUse ? 'tool_use' : 'end_turn',
    usage: { input_tokens: data.usage?.prompt_tokens || 0, output_tokens: data.usage?.completion_tokens || 0 },
  };
}

// ══════════════════════════════════════════════════════════════
//  Helpers
// ══════════════════════════════════════════════════════════════

function _findToolName(messages, toolUseId) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const c = messages[i].content;
    if (!Array.isArray(c)) continue;
    const tu = c.find(x => x.type === 'tool_use' && x.id === toolUseId);
    if (tu) return tu.name;
  }
  return 'unknown';
}

async function fetchTO(url, opts, timeoutMs = 90_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw badRequest('AI ใช้เวลานานเกินไป — กรุณาลองใหม่อีกครั้ง', 'AI_TIMEOUT');
    throw badRequest(`เชื่อมต่อ AI ไม่สำเร็จ: ${err.message}`, 'AI_NETWORK');
  }
}
