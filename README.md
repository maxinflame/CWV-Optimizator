# CWV Optimizator

Автономный пайплайн лабораторной оптимизации Core Web Vitals для существующих локальных сайтов. Агент (Cursor CLI) предлагает одно изменение за итерацию; пайплайн сам собирает production-сборку, измеряет LCP / INP / CLS / FCP в Chromium и принимает или откатывает правки через Git.

Лабораторные улучшения не являются гарантией field Core Web Vitals Google.

## Быстрый старт

```bash
npm install
npx playwright install chromium
# нужен Cursor Agent CLI: https://cursor.com/docs/cli/installation
```

Готовые конфиги лежат в `configs/` и в Git не входят. Образец остаётся в корне: оттуда его можно передать в пайплайн напрямую, импорт `./src/website/config.js` резолвится из корня репозитория.

```bash
mkdir -p configs
cp website.config.example.ts configs/website.config.ts
```

В копии замените импорт на `../src/website/config.js`.

Образец уже указывает на `fixtures/slow-site`, поэтому для демо его можно передать напрямую:

```bash
# только замеры
npm run pipeline -- --project "$(pwd)/fixtures/slow-site" --config ./website.config.example.ts --measure-only

# замеры уже запущенного сайта (OSPanel, Docker и т.п.)
npm run pipeline -- --project "$(pwd)/fixtures/slow-site" --config ./website.config.example.ts --measure-only --base-url http://127.0.0.1:4177

# проверка окружения (Git, Cursor Agent login/CLI, build/health)
npm run pipeline -- --project "$(pwd)/fixtures/slow-site" --config ./website.config.example.ts --validate

# автономная оптимизация
npm run pipeline -- --project "$(pwd)/fixtures/slow-site" --config ./website.config.example.ts --agent cursor
```

Для своего сайта правьте `configs/website.config.ts` или `configs/website.<имя>.config.ts`. На Windows укажите абсолютный путь к репозиторию, например `C:/Projects/.../fixtures/slow-site`.

## GUI

Локальный веб-интерфейс для формы запуска и просмотра прогонов:

```bash
npm run gui
```

Откроется страница `http://127.0.0.1:5173/` (Vite). API слушает `http://127.0.0.1:4178/`.

| Переменная | Назначение |
| --- | --- |
| `CWV_GUI_PORT` | Порт API (по умолчанию `4178`) |
| `CWV_GUI_OPEN=0` | Не открывать браузер автоматически |

Остановка: `Ctrl+C` в том же терминале.

## Требования к сайту

- абсолютный путь к Git-репозиторию;
- для автономной оптимизации — **чистый** working tree;
- managed-режим: `buildCommand` + `startCommand` + `port`;
- external-режим (`website.baseUrl` / `--base-url`, Docker/OSPanel): сайт уже слушает URL; после checkout пайплайн вызывает `buildCommand` (у symbl — `npm run build` в `frontend/`) и health-check, контейнеры не перезапускает;
- HTTP health-check;
- без обязательной авторизации/CAPTCHA на измеряемых страницах.

Пайплайн работает **напрямую** в каталоге сайта (без clone, worktree и копий). Отчёты пишутся в `runs/website/`.

## Документация

- [docs/website.md](docs/website.md) — архитектура, GUI, Git safety, методика замеров
- [docs/metrics.md](docs/metrics.md) — метрики CWV
- [website.config.example.ts](website.config.example.ts) — образец конфигурации
- Fixture с намеренно медленной загрузкой: `fixtures/slow-site`

## Тесты

```bash
npm test
npm run check
```
