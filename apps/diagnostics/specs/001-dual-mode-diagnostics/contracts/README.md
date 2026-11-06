> Amended implementation: [approved changes](../approved-changes.md). Resources are same-origin static URLs, not embedded bytes. Report policy is `same-origin-static-assets`; static resource observations are counted separately. The optional `testSuite` section contains safe metrics for 16 canonical cases × three engines. Synthetic client frames retain a shared frozenFrameId.

# Контракты

## virtual-api.openapi.json

OpenAPI 3.1 описывает **виртуальный обмен в памяти** первой вкладки. Это не deployable backend и не адрес для Swagger Try it out. Server `virtual.invalid` намеренно не является тестовым API. `x-display-base` хранит адрес, который показывается пользователю, но не вызывается.

- GET config возвращает allowed/enabled/available/settings. При недоступности config камера не запускается автоматически, ручной ввод остаётся.
- POST sessions/{sessionId}: UUIDv4 клиента, без body, 200 (не 201), settings snapshot.
- POST frames: browser-created FormData, frameId и JPEG image/vin.jpg; browser boundary не задаётся вручную. В симуляции локально сериализуется multipart, но не отправляется.
- Candidate не раскрывает VIN через API response; vin заполнен только при Recognized. reasonCode диагностический, не ключ бизнес-ветвления.
- DELETE: no body, empty 200, идемпотентный и fire-and-forget; не заменяет local stop и не меняет уже terminal результат.
- FrameInProgress/FrameTooEarly → пауза и свежий кадр; остальные 400 → stop. Отказ в распознавании не моделируется как auth 401/403.

Idempotency: sessionId задаёт одну виртуальную сессию и исходные settings; повтор того же frameId возвращает тот же сохранённый ответ и не продвигает сценарий. Между ответами допускается один frame in flight. maxBytes проверяется по bytes Blob, не по base64 длине.

## mock-scenarios.json

Перечень выбираемых сценариев/availability profiles и ожидаемых исходов. HTTP-коды — виртуальные. Expected rejection означает успешную проверку обработки. Настоящих HTTP requests нет.

## engine lifecycle

Единому host нужны операции подготовки выбранного движка, старта live или обработки frozen input и dispose. Для Paddle/Tesseract live loop находится в host; для vin-scanner live loop и UI остаются в оригинальном компоненте.

| Операция | Вход | Выход/события |
|---|---|---|
| initialize | owner, same-origin resource references, signal, progress callback | engine/version/capabilities; отказ с кодом без внешнего fallback |
| startLive | owner, revisionAtStart, ready/state/result callbacks | Paddle/Tesseract через host frame loop; форк через native component.open/events |
| recognizeFrozen | runId/generation/frameId, immutable image, optional manual guide | Ответ по ocr-adapter.schema.json |
| dispose | owner | Отменить promises, terminate/close, cleanup; безопасно при повторном вызове |

Native supported/missing из `open()` сохраняются. Decoder отслеживается по READY/свойству компонента. Отмена Promise сама по себе не отменяет getUserMedia: generation guard и немедленный stop позднего stream обязательны.

## ocr-adapter.schema.json

Описывает runtime result, который **не экспортируется целиком**. В нём намеренно допустим OCR-текст и native VIN в памяти. Fork native verdict не пропускается через strict regex/threshold host. items нужны для Paddle/Tesseract и frozen/наблюдаемого native read; публичное live событие форка не обязано содержать raw reads или frameId, поэтому они nullable/пусты.

Форма общего результата не переписывает алгоритм движка. Семантические ограничения: vin-scanner использует profile native-full и nativeVerdict; Paddle/Tesseract — generic-strict и nativeVerdict=null. Времена неотрицательны; native live timing может быть только сессионным, не придуманным inferenceMs.

## report-v2.schema.json

Проекция по allowlist, `additionalProperties: false` во всех структурных объектах. Только safe scalar metadata, фиксированные codes, числовые метрики и статусы. Поля vin/text/image/deviceId и сырые сообщения исключений не предусмотрены. Пользовательский VIN, исходный read и native event detail целиком никогда не сериализуются.

Schema не доказывает приватность произвольной строки. Поэтому свободный текст в event/check detail исключён, идентификаторы имеют ограниченный формат, environment userAgent отдельно санитизируется; дополнительно нужен TC43 с sentinel-значениями и просмотр экспорта. Camera labels/IDs не являются environment facts отчёта.

`network.externalVerification` описывает независимую проверку, а не вычисленный UI статус. По умолчанию `not_performed`; ноль в application counters без DevTools/внешнего наблюдения не превращает его в `pass`.
