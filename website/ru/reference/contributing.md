# Участие в разработке

deffector — монорепозиторий на npm workspaces. Всё запускается из корня репозитория.

```sh
git clone https://github.com/mxmvshnvsk/deffector.git
cd deffector
npm install
npm run build
```

## Устройство репозитория

| Путь                  | Что там                                                                                                                                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/protocol`   | типы сообщений, кодирование значений с тегом `$t`, формат трейса и проверка совместимости                                                                                                                                                                     |
| `packages/agent`      | работает в странице: подключается к `setInspector` / `setGraphInspector`, собирает шаги в транзакции, хранит снимки, перемещение во времени, правки, воспроизведение, подмену эффектов, проверки Health; адаптеры для React, Vue, Solid; точка входа для Node |
| `packages/panel`      | интерфейс (React), общий для расширения и отдельного приложения; в `src/i18n/` (`en.ts`, `ru.ts`) — все тексты на английском и русском                                                                                                                        |
| `packages/extension`  | расширение MV3 для Chrome/Edge (`dist/`) и Firefox (`dist-firefox/`): content script ⇄ background ⇄ панель DevTools                                                                                                                                           |
| `packages/standalone` | `npx @deffector/standalone`: отдаёт панель и пересылает сообщения агентов по WebSocket                                                                                                                                                                        |
| `demo/*`              | одна модель effector (`demo/shared`) в React, Vue, Solid, Next.js, Node SSR, глобальном режиме и без плагина; `demo/lab` — большие графы и пограничные случаи                                                                                                 |
| `e2e`                 | тесты Playwright, которые загружают расширение и прогоняют каждое демо                                                                                                                                                                                        |
| `assets/brand`        | логотип, иконки и превью для соцсетей                                                                                                                                                                                                                         |
| `website`             | эта документация (VitePress)                                                                                                                                                                                                                                  |

## Скрипты

| Команда                                 | Что делает                                                                                         |
| --------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `npm run build`                         | агент, демо-модель, расширение (Chrome и Firefox), standalone                                      |
| `npm run watch -w @deffector/extension` | пересобирает расширение при изменениях                                                             |
| `npm test`                              | модульные тесты (vitest), `packages/*/test`                                                        |
| `npx playwright install chromium`       | один раз, перед первым запуском e2e                                                                |
| `npm run e2e`                           | Playwright: запускает демо, загружает расширение и прогоняет каждое демо (сначала `npm run build`) |
| `npm run lint`                          | ESLint (правила Airbnb для TypeScript, React, Vue) и `prettier --check`                            |
| `npm run lint:fix`                      | ESLint с `--fix`, затем `prettier --write`                                                         |
| `npm run format`                        | `prettier --write .`                                                                               |
| `npm run typecheck`                     | `tsc --noEmit` для основного проекта и проекта Solid                                               |
| `npm run dev:react` … `npm run dev:lab` | [демо](/ru/reference/demos)                                                                        |
| `npm run standalone`                    | отдельное приложение на http://localhost:8686                                                      |
| `npm run docs:dev`                      | этот сайт с горячей перезагрузкой                                                                  |
| `npm run docs:build`                    | собирает этот сайт в `website/.vitepress/dist`                                                     |

Два необязательных прогона Playwright не проверяют поведение, а производят материалы:

```sh
PERF=perf.json npx playwright test e2e/perf.spec.ts     # замеры накладных расходов, см. «Производительность»
SHOTS=shots npx playwright test e2e/screens.spec.ts     # скриншоты панели в обеих темах
```

А отдельная конфигурация vitest проверяет агента на сборке effector с
[изменениями для upstream](/ru/reference/upstream):

```sh
EFFECTOR_DIST=/path/to/effector/npm/effector npx vitest run -c vitest.upstream.config.ts
```

## Работа над панелью

Панель — обычный React с небольшим собственным стором (`packages/panel/src/store/`). Все видимые
пользователю строки лежат в `packages/panel/src/i18n/` (а собственные тексты агента — пункты Health,
пометки шагов — в `packages/agent/src/i18n/`); добавляйте оба языка. Расширение и отдельное
приложение монтируют одну и ту же панель, поэтому проверяйте обе: `npm run build`, перезагрузка
расширения и `npm run standalone`.

## Работа над документацией

```sh
npm run docs:dev        # адрес будет в выводе, например http://localhost:5173/deffector/
```

Страницы — Markdown в `website/`: английские в корне, русские в `website/ru/` с теми же именами файлов.
Держите обе версии в согласии. Скриншоты лежат в `website/public/screens/` (пары `dark-*` и `light-*`
переключаются вместе с темой сайта). Сайт публикуется в GitHub Pages workflow `.github/workflows/docs.yml`
(Settings → Pages → Source: GitHub Actions; для своего домена задайте переменную `DOCS_BASE` = `/`).

## Публикация

В npm публикуются `@deffector/agent` и `@deffector/standalone`, остальные пакеты приватные. Агент
собирается tsup в `dist/` (ESM и собранные объявления типов; `@deffector/protocol` встроен внутрь), и у
каждой точки входа есть пустой двойник под условием экспорта `production`. Внутри репозитория демо
берут агент из исходников через условие `@deffector/source`.

```sh
npm run release:check   # что уйдёт в npm (npm pack --dry-run)
npm run check:artifacts # и совпадает ли это с манифестами (после сборки)
```

Чтобы выпустить версию: поднимите `version` в `packages/agent/package.json` и
`packages/standalone/package.json`, закоммитьте, поставьте тег и отправьте его —
`.github/workflows/release.yml` проверит, прогонит тесты и опубликует:

```sh
git tag v0.1.1 && git push origin v0.1.1
```

Workflow использует npm Trusted Publishing, поэтому npm-токен в репозитории не нужен: на npmjs.com у
каждого пакета → Settings → Trusted publishing → GitHub Actions → `mxmvshnvsk` / `deffector` /
`release.yml`. Первую версию пакета публикуют вручную (`npm publish -w @deffector/agent -w @deffector/standalone`),
потому что Trusted publishing настраивается у уже существующего пакета.

### Расширение для браузера

У расширения своя версия (`packages/extension/static/manifest.json`) и свой тег. Поднимите версию в
манифесте, закоммитьте, затем создайте и отправьте тег:

```sh
git tag extension-v0.1.4 && git push origin extension-v0.1.4
```

`.github/workflows/extension-release.yml` собирает расширение, создаёт релиз на GitHub с
`deffector-chrome-<версия>.zip` и отправляет версию в оба магазина: сборку для Firefox вместе с
исходниками — в addons.mozilla.org, zip — в Chrome Web Store. Каждый магазин проверяет версию и
публикует её после одобрения. Нужные секреты репозитория:

- `AMO_JWT_ISSUER`, `AMO_JWT_SECRET` — addons.mozilla.org → Developer Hub → API-ключи;
- `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN` — OAuth-клиент Google с включённым Chrome Web
  Store API (по шагам проводит `npx chrome-webstore-upload-keys`), и `CWS_PUBLISHER_ID` из панели
  разработчика Chrome Web Store. Без них шаг для Chrome пропускается.

AMO принимает каждую версию один раз, поэтому каждому релизу расширения нужна новая версия; версия, уже
загруженная в AMO вручную, пропускается. Чтобы собрать существующий
тег заново, запустите workflow вручную (**Actions** → **extension release** → **Run workflow**) с этим
тегом.
