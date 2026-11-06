# CWV Optimizator

Автономный пайплайн лабораторной оптимизации Core Web Vitals для существующих локальных сайтов. Агент (Cursor CLI) предлагает одно изменение за итерацию; пайплайн сам собирает production-сборку, измеряет LCP / INP / CLS / FCP в Chromium и принимает или откатывает правки через Git.

Лабораторные улучшения не являются гарантией field Core Web Vitals Google.

## Быстрый старт

```bash
npm install
npx playwright install chromium
# нужен Cursor Agent CLI: https://cursor.com/docs/cli/installation
```

Скопируйте `website.config.example.ts` или используйте встроенный конфиг для fixture:

```bash
# только замеры
npm run pipeline -- --project "$(pwd)/fixtures/slow-site" --config ./website.config.ts --measure-only

# замеры уже запущенного сайта (OSPanel, Docker и т.п.)
npm run pipeline -- --project "$(pwd)/fixtures/slow-site" --config ./website.config.ts --measure-only --base-url http://127.0.0.1:4177

# проверка окружения (Git, Cursor Agent login/CLI, build/health)
npm run pipeline -- --project "$(pwd)/fixtures/slow-site" --config ./website.config.ts --validate

# автономная оптимизация
npm run pipeline -- --project "$(pwd)/fixtures/slow-site" --config ./website.config.ts --agent cursor

# symbl.cc (Docker уже запущен на :8000; лучше из WSL)
npm run pipeline -- --project /home/maxinflame/Projects/symbl.cc --config ./website.symbl.config.ts --validate
npm run pipeline -- --project /home/maxinflame/Projects/symbl.cc --config ./website.symbl.config.ts --agent cursor
```

На Windows укажите абсолютный путь к сайту, например `C:/Projects/.../fixtures/slow-site`. Для symbl предпочтителен WSL-путь к репозиторию.

## Требования к сайту

- абсолютный путь к Git-репозиторию;
- для автономной оптимизации — **чистый** working tree;
- managed-режим: `buildCommand` + `startCommand` + `port`;
- external-режим (`website.baseUrl` / `--base-url`, Docker/OSPanel): сайт уже слушает URL; после checkout пайплайн вызывает `buildCommand` (у symbl — `npm run build` в `frontend/`) и health-check, контейнеры не перезапускает;
- HTTP health-check;
- без обязательной авторизации/CAPTCHA на измеряемых страницах.

Пайплайн работает **напрямую** в каталоге сайта (без clone, worktree и копий). Отчёты пишутся в `runs/website/`.

## Документация

- [docs/website.md](docs/website.md) — архитектура, Git safety, методика замеров
- [docs/metrics.md](docs/metrics.md) — метрики CWV
- [website.config.example.ts](website.config.example.ts) — пример конфигурации
- [website.symbl.config.ts](website.symbl.config.ts) — Docker-проект symbl.cc
- Fixture с намеренно медленной загрузкой: `fixtures/slow-site`

## Тесты

```bash
npm test
npm run check
```
