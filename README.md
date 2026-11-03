# Дневник питания — Telegram Mini App

Трекер КБЖУ в Telegram: дневник по приёмам пищи, сканер штрихкодов (Open Food Facts), цели по формуле Миффлина–Сан Жеора, статистика за неделю и рецепты от ИИ под оставшуюся норму.

Приложение: https://nemaj1k.github.io/nutrition-miniapp/

## Структура

- `index.html` — всё приложение (GitHub Pages). Данные пользователей хранятся в CloudStorage Telegram, бэкенд не нужен.
- `worker/worker.js` — сервер для рецептов на Cloudflare Workers AI (бесплатно).

## Подключить к боту

@BotFather → `/mybots` → бот → Bot Settings → Menu Button → ссылка `https://nemaj1k.github.io/nutrition-miniapp/`.

## Запустить рецепты (Cloudflare)

1. dash.cloudflare.com → Workers & Pages → Create → Worker, имя `nutrition-ai` → Deploy.
2. Edit code → вставить `worker/worker.js` → Deploy.
3. Settings → Bindings → Add → **Workers AI**, имя `AI`.
4. Settings → Variables → Secret `BOT_TOKEN` = токен бота (защита от чужих запросов).
5. По желанию: KV namespace с именем привязки `LIMITS` — лимит 20 рецептов в день на человека (`DAILY_LIMIT`).
6. Адрес воркера вставить в `index.html` → `const API_URL = '...'`.
