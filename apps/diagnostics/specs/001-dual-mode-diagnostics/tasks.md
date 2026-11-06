> Implementation amendment: [approved-changes.md](approved-changes.md) supersedes offline packaging, CSP, network and acceptance assumptions.

# Задачи реализации и зависимости

Все пункты ниже **не выполнены**. Чтение исходников и написание этой спецификации не закрывает технические этапы. Порядок выбран так, чтобы сначала проверить риск упаковки, затем сохранить baseline, после этого подключать движки и проводить приёмку.

## T01 — Доказать автономную загрузку трёх стеков

Зависимости: нет. Требования: FR08–FR09, FR21–FR22, FR24. Проверки: TC18–TC20, TC31–TC33.

- [ ] Создать минимальные временные harness по одному движку, без полноценного UI стенда.
- [ ] Проверить embedded blob worker, WASM, OpenCV, language/model loaders и ORT companions под `file:` с холодным кэшем.
- [ ] Для форка проверить полный компонент и полный worker с n-gram, не только createVinPipeline.
- [ ] Установить минимальный рабочий CSP без HTTP(S), CDN fallback и JS unsafe-eval.
- [ ] Записать фактический результат Android Chrome и iPhone Safari, включая способ открытия файла и missing API.

Готово: доказан реальный inference каждого стека либо конкретный блокер. Неуспех не заменяется изображением с заранее известным ответом. При фундаментальной несовместимости single HTML пересматривается упаковка до продолжения основной интеграции.

## T02 — Закрепить ресурсы и сборочную воспроизводимость

Зависимости: T01. Требования: FR21–FR22, FR24. Проверки: TC31–TC34.

- [ ] Зафиксировать npm lockfile и точные транзитивные версии.
- [ ] Заполнить manifest: JS/worker/WASM/companion/model/dict/ngram/eng data, байты, SHA-256, источник, лицензия.
- [ ] Включить n-gram форка и NOTICE/атрибуцию; проверить decoder beam на валидном bundled файле.
- [ ] Сделать сборку одним HTML с ленивой материализацией выбранных ресурсов.
- [ ] Проверить замыкание imports/путей, холодный offline без кэша и отсутствие runtime HTTP.

Готово: сборка падает на отсутствующем/неверном ресурсе, даёт один воспроизводимый release artifact с manifest; полный размер измерен, а не угадан по весам моделей.

## T03 — Перенести baseline в изолированное приложение стенда

Зависимости: T02. Требования: FR01–FR07, AC12. Проверки: TC01–TC10.

- [ ] Создать `apps/diagnostics` с объяснённым назначением, без изменения B2B.
- [ ] Перенести существующую логику без второй реализации камеры/мока.
- [ ] Перечитать актуальный HTML и сохранить внешние обновления Android content:/permissions/error details из context/concurrent-source-update.md; не затереть их baseline.
- [ ] Сохранить frozen baseline и прогнать существующие synthetic self-tests как регрессию.
- [ ] Build output держать отдельно от исходного пользовательского HTML до явной замены.

Готово: прежняя диагностика работает в новой сборке до включения OCR; функции и поведение сопоставлены с baseline.

## T04 — Две вкладки и исключительное владение ресурсами

Зависимости: T03. Требования: FR01–FR04, FR08, FR16–FR17, FR23. Проверки: TC01–TC08, TC24–TC30.

- [ ] Сделать tablist с двумя panel и select Paddle/Tesseract/vin-scanner.
- [ ] Ввести generation/run ownership и cameraOwner baseline/native, без нового глобального state framework.
- [ ] Выделить из prepareFrame неизменяемый ROI/JPEG результат и source metadata.
- [ ] Исключить auto camera/init при открытии страницы и выборе select.
- [ ] При смене владельца сначала завершать прежние tracks/runtime; late callbacks не открывают ресурсы вновь.

Готово: любой повтор/переключение оставляет максимум один активный поток и runtime; UI доступен на мобильной ширине.

## T05 — Сохранить и явно обозначить браузерный мок

Зависимости: T04. Требования: FR05–FR07, FR14–FR15, FR18, FR21. Проверки: TC09–TC17.

- [ ] Подписать виртуальные методы/адреса, payload metadata и синтетический VIN.
- [ ] Сохранить multipart frameId/image и все сценарии `mock-scenarios.json`.
- [ ] Проверить отсутствие HTTP-операций даже при показе настоящего адреса BFF.
- [ ] Проверить idempotency/cancel, ошибки 400, одно in-flight, отсутствие backlog и непродлеваемый deadline.

Готово: основной сценарий и каждый ожидаемый отказ проходят; synthetic checks не становятся camera/OCR pass.

## T06 — Tesseract.js

Зависимости: T04, T02. Требования: FR08–FR15, FR24. Проверки: TC19, TC21–TC23, TC35.

- [ ] Один worker, eng, SINGLE_LINE, VIN whitelist и локальные core/lang paths.
- [ ] Реальный recognize общего кадра, разбор строк без склейки, confidence с исходной шкалой.
- [ ] Strict format и два свежих совпадения только для live; frozen отдельный результат.
- [ ] Отмена init/inference, terminate и ожидаемые missing-resource ошибки.

Готово: реальные чтения плюс ошибки подтверждены; ответ мока нигде не используется как OCR.

## T07 — PaddleOCR JS

Зависимости: T04, T02. Требования: FR08–FR15, FR24. Проверки: TC18, TC21–TC23, TC35.

- [ ] Закреплённый JS package, tiny det/rec, worker, WASM CPU/один поток, локальные OpenCV/ORT пути.
- [ ] Обработать реальную форму массива predict/items и nullable score; сохранить geometry только в памяти.
- [ ] Общий строгий фильтр/подтверждение; не ранжировать точность по confidence.
- [ ] Проверить dispose/termination и исключить CDN defaults.

Готово: реальные кадры проходят официальный runtime с фактическими метриками и корректным cleanup.

## T08 — Полноценный пользовательский vin-scanner

Зависимости: T04, T02. Требования: FR09–FR13, FR15–FR18, FR24. Проверки: TC20, TC36–TC42.

- [ ] Подключить штатный web component с embedded detector/rec/dict/wasm/ngram URLs.
- [ ] Сохранить native overlay/quad/shutter/3-frame burst/guide strips/torch/autofocus/retry/hint/интервал 200 мс.
- [ ] Сохранить beam/n-gram/rescore/исправления/Tier A/B/C и исходные defaults. Не применять строгий host-фильтр или второй consensus.
- [ ] Подписаться на все публичные события; отображать decoder/tier/checkDigitOk/source.
- [ ] Добавить RU в существующие locale tables, не удалять языки.
- [ ] Минимально защитить async worker/camera/bitmap/retry generation и video.play; core алгоритма не менять.
- [ ] Для frozen использовать исходный worker INIT/FRAME/RESET, не core-only реализацию.
- [ ] Сопоставить native outputs с pinned исходником на одинаковых последовательностях/кадрах.

Готово: функциональная полнота и native parity подтверждены отдельно; корректировки жизненного цикла не меняют распознавание. Принятый штатным форком Tier C принимается стендом.

## T09 — Дедлайны, отмена и защита ручного ввода

Зависимости: T05–T08. Требования: FR14–FR18. Проверки: TC11–TC17, TC24–TC30, TC40.

- [ ] Разделить init timeout 60 с и recognition deadline 30 с.
- [ ] Revision запоминать при Start, включая ручной ввод во время init.
- [ ] Проверять owner/correlation/deadline после каждого async шага; stop сначала инвалидирует поколение.
- [ ] Уничтожать runtime/track/timers на stop, terminal, switch, hidden/pagehide; auto resume отсутствует.

Готово: fault injection поздних ответов и незавершённых разрешений не меняет новую сессию и не оставляет камеру включённой.

## T10 — Frozen сравнение и локальный эталон

Зависимости: T06–T09. Требования: FR10–FR13. Проверки: TC21–TC23, TC35, TC39.

- [ ] Общие frozen bytes/frameId, камера после freeze выключена.
- [ ] Последовательные реальные вычисления, один runtime; результаты с native/strict профилем.
- [ ] Ввод ground truth в памяти, exact match/позиционные ошибки при равной длине.
- [ ] Init/first/warm/infer/total метрики раздельно, без сопоставления confidence как accuracy.

Готово: видно, что сравнивалось на одинаковом снимке, а что в native live. Недоступная метрика имеет null/untested.

## T11 — Отчёт и честная диагностика

Зависимости: T09–T10. Требования: FR19–FR21. Проверки: TC31, TC43–TC45.

- [ ] Реализовать allowlist report v2, независимые device/logic/engine/manual результаты.
- [ ] Не экспортировать VIN, raw OCR, фото, binary, deviceId, raw exceptions и нативные event detail целиком.
- [ ] Учесть virtual calls, blob resource reads, запрещённые попытки и степень независимой network проверки.
- [ ] Copy fallback/download и русские причины ошибок; ожидаемый mock failure не означает device failure.

Готово: schema validation и privacy sentinel проверки проходят на success/error/cancel/native событиях.

## T12 — Автоматизированные регрессии и комплект приёмки

Зависимости: T05–T11. Требования: все, где применимо. Проверки: TC01–TC45.

- [ ] Существующие core tests форка не удалены; новые проверки только значимой логики и контрактов.
- [ ] Synthetic harness покрывает гонки, deadline, retry/cancel, idempotency и manual revision.
- [ ] Native parity cases A/B/C, beam/rescore/guide fallback не подменены mock engine.
- [ ] Проверить CSP/network/resource closure, мобильные размеры, ошибки console и отчёт.

Готово: результаты с источником проверки сохранены; headless camera tests подписаны synthetic, а не реальный Android/iPhone.

## T13 — Реальные телефоны и выпуск

Зависимости: T12. Требования: AC01–AC12. Проверки: матрица `test-plan.md`.

- [ ] Android Chrome и iPhone Safari: холодный локальный запуск каждого движка, camera permission/deny/pending, portrait/landscape, hidden/lock/indicator.
- [ ] Полный native функционал форка на поддерживаемых устройствах, ошибки дополнительных API как optional limitations.
- [ ] Повторные сессии/смена движков без одновременных worker и активных tracks; измерение времени/размера, памяти если API доступен.
- [ ] Offline/network audit, копирование/скачивание отчёта, отсутствие VIN/фотографий в нём.
- [ ] Зафиксировать поддержанные и ограниченные комбинации, положить manifest/NOTICE/readme рядом с исходниками и выдать итоговый HTML.

Готово: приёмка проверяема и не обещает поддержку непроверенных просмотрщиков. Работа с BFF/AI quality сервера остаётся вне проверки.
