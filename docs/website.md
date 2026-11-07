# Автономная оптимизация Core Web Vitals

## Состав

- `src/website/` — конфиг, Git, production server, Playwright-замеры, acceptance, pipeline
- `src/gui/` — локальный веб-интерфейс (форма запуска и просмотр прогонов)
- `src/agents/cursor/` — Cursor Agent CLI
- `src/runtime/` — бюджет времени и ошибки
- `fixtures/slow-site/` — демо-сайт с намеренно медленной загрузкой

## GUI

```bash
npm run gui
```

Поднимает API (`CWV_GUI_PORT`, по умолчанию `4178`) и Vite-страницу на `http://127.0.0.1:5173/`. Браузер открывается сам; отключить: `CWV_GUI_OPEN=0`. Остановка: `Ctrl+C`.

Сохранённые формы GUI лежат в `configs/*.gui.json` (каталог в Git не входит).

## Методика замеров

1. По умолчанию — production build + production server, которым управляет пайплайн.
2. Режим внешнего URL (`website.baseUrl` / `--base-url`, Docker/OSPanel): origin уже запущен; после checkout выполняется опциональный `buildCommand` (например `npm run build` во `frontend/`) и health-check — без stop/start контейнеров. Поддерживаются `--measure-only`, `--validate` и `--agent`.
3. Playwright + Chromium, холодный context на каждый повтор.
4. Init-script коллектора до navigation.
5. CPU/network throttling через CDP.
6. CLS и остальные CWV считаются библиотекой `web-vitals/attribution`, а не собственным суммированием Performance entries.
7. Confirmation — последовательные batch candidate/reference с `rebuildAndStart` (managed: stop/build/start; external: build + health).

## Validate

`--validate` жёстко проверяет готовность к `--agent`: Git, наличие Cursor Agent CLI,
аутентификацию (`agent status` / `CURSOR_API_KEY`), затем build/health.
Если агент не установлен или не залогинен — validate падает с ошибкой (не
помечает это мягкой заметкой).

## Git safety

- Требуется чистый tree.
- Создаётся ветка `cwv-optimize/<timestamp>`.
- Исходная ветка не меняется.
- Accept → commit на optimization branch.
- Reject → `reset --hard` к last accepted + `clean -fd`.
- Состояние: `runs/website/<run-id>/git-state.json`.
- Блокировка concurrent runs: `~/.cwv-optimizator/locks/`.

## Важно

Лабораторные улучшения ≠ гарантированные field Core Web Vitals Google.
