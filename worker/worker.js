// Cloudflare Worker: генерация рецептов для Mini App «Дневник питания»
// Модель — Cloudflare Workers AI (бесплатный лимит, ключ не нужен).
// Переменные (Settings → Variables): BOT_TOKEN (secret, рекомендуется), DAILY_LIMIT (по умолчанию 20), MODEL (необязательно).
// Привязки (Settings → Bindings): Workers AI с именем AI (обязательно), KV с именем LIMITS (необязательно, для лимита в день).

const SYSTEM = `Ты — шеф-повар и нутрициолог. Придумываешь вкусные и несложные блюда из продуктов, которые легко купить в обычном российском супермаркете.
Отвечай строго одним JSON-объектом на русском языке, без пояснений вокруг.
Формат: {"name": "...", "description": "одно предложение", "time_min": число, "servings": число,
"ingredients": [{"name": "...", "grams": число, "kcal": число, "p": число, "f": число, "c": число}],
"steps": ["шаг 1", "шаг 2", ...], "tips": "короткий совет"}
Правила:
- grams — вес ингредиента в граммах в сыром виде (яйцо ≈ 55 г, зубчик чеснока ≈ 5 г).
- kcal, p, f, c — калории, белки, жиры, углеводы ИМЕННО ДЛЯ ЭТОГО ВЕСА (не на 100 г), по справочным данным.
- Специи и соль можно указывать с весом 1–3 г.
- 4–8 шагов, каждый конкретный: что делать, сколько минут, какой огонь или температура.
- Не используй редкие и дорогие продукты.
- Если пожелания пользователя не про еду, всё равно верни рецепт.`;

export default {
  async fetch(req, env) {
    const cors = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Init-Data',
    };
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });

    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (req.method !== 'POST') return json({ error: 'Только POST' }, 405);

    // 1. Проверка, что запрос пришёл из Telegram (если задан BOT_TOKEN)
    let userId = req.headers.get('CF-Connecting-IP') || 'anon';
    if (env.BOT_TOKEN) {
      const id = await checkInitData(req.headers.get('X-Init-Data') || '', env.BOT_TOKEN);
      if (!id) return json({ error: 'Открой приложение через Telegram' }, 401);
      userId = id;
    }

    // 2. Лимит запросов в день на пользователя (если подключён KV LIMITS)
    if (env.LIMITS) {
      const key = `rl:${userId}:${new Date().toISOString().slice(0, 10)}`;
      const n = +(await env.LIMITS.get(key)) || 0;
      if (n >= (+env.DAILY_LIMIT || 20)) return json({ error: 'Лимит рецептов на сегодня исчерпан, приходи завтра' }, 429);
      await env.LIMITS.put(key, String(n + 1), { expirationTtl: 90000 });
    }

    const body = await req.json().catch(() => ({}));
    const prompt = buildPrompt(body);
    const model = env.MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

    // 3. Генерация (одна повторная попытка, если модель вернула кривой JSON)
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await env.AI.run(model, {
          messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }],
          max_tokens: 1800,
          temperature: 0.8,
        });
        let raw = r && r.response !== undefined ? r.response : r;
        if (typeof raw === 'string') raw = extractJson(raw);
        return json(normalize(raw));
      } catch (e) {
        if (attempt === 1) return json({ error: 'ИИ не смог придумать рецепт' }, 502);
      }
    }
  },
};

function buildPrompt(b) {
  const s = v => String(v || '').replace(/\s+/g, ' ').slice(0, 200);
  let p = `Придумай одно блюдо на ${s(b.meal).toLowerCase() || 'любой приём пищи'}.`;
  const t = b.target;
  if (t && +t.k > 0) {
    p += ` На одну порцию примерно ${Math.round(+t.k)} ккал`;
    if (+t.p || +t.f || +t.c) p += `: белки ~${Math.round(+t.p || 0)} г, жиры ~${Math.round(+t.f || 0)} г, углеводы ~${Math.round(+t.c || 0)} г`;
    p += ' (допуск ±10%).';
  }
  if (b.have) p += ` По возможности используй: ${s(b.have)}. Остальное — простые продукты.`;
  if (b.exclude) p += ` Не используй: ${s(b.exclude)}.`;
  if (b.wish) p += ` Пожелания: ${s(b.wish)}.`;
  if (Array.isArray(b.avoid) && b.avoid.length) p += ` Придумай другое блюдо, не эти: ${b.avoid.slice(0, 5).map(s).join('; ')}.`;
  p += ' Порций: 1, если в пожеланиях не сказано иначе.';
  return p;
}

function extractJson(text) {
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('no json');
  return JSON.parse(text.slice(a, b + 1));
}

function normalize(o) {
  if (!o || typeof o !== 'object') throw new Error('bad');
  const n = v => { const x = parseFloat(v); return isFinite(x) && x >= 0 ? Math.round(x * 10) / 10 : 0; };
  const ingredients = (Array.isArray(o.ingredients) ? o.ingredients : []).slice(0, 25)
    .map(i => ({ name: String(i.name || '').slice(0, 80), grams: n(i.grams), kcal: n(i.kcal), p: n(i.p), f: n(i.f), c: n(i.c) }))
    .filter(i => i.name);
  const steps = (Array.isArray(o.steps) ? o.steps : [])
    .map(x => String(typeof x === 'object' && x ? (x.text || x.step || Object.values(x).join(' ')) : x).trim().slice(0, 400))
    .filter(Boolean).slice(0, 12);
  if (!o.name || !ingredients.length || !steps.length) throw new Error('bad');
  return {
    name: String(o.name).slice(0, 80),
    description: String(o.description || '').slice(0, 200),
    time_min: Math.round(n(o.time_min)) || null,
    servings: Math.min(8, Math.max(1, Math.round(n(o.servings)) || 1)),
    ingredients,
    steps,
    tips: String(o.tips || '').slice(0, 300),
  };
}

// Проверка подписи Telegram WebApp initData
async function checkInitData(initData, token) {
  if (!initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const dcs = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('\n');
  const enc = new TextEncoder();
  const k1 = await crypto.subtle.importKey('raw', enc.encode('WebAppData'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const secret = await crypto.subtle.sign('HMAC', k1, enc.encode(token));
  const k2 = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k2, enc.encode(dcs)));
  const hex = [...sig].map(b => b.toString(16).padStart(2, '0')).join('');
  if (hex !== hash) return null;
  if (Date.now() / 1000 - (+params.get('auth_date') || 0) > 86400) return null;
  try { return String(JSON.parse(params.get('user')).id); } catch (e) { return 'tg'; }
}

export { buildPrompt, normalize, checkInitData, extractJson };
