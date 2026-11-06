> Implementation amendment: [approved-changes.md](approved-changes.md) supersedes offline packaging, CSP, network and acceptance assumptions.

# План проверки будущей реализации

Все runtime-кейсы ниже имеют статус **не выполнялся**. Проверка документов/архива фиксируется отдельно в context/validation.json. Наличие тест-кейса не означает пройденный тест.

## Уровни свидетельств

- Статический анализ: пути ресурсов, CSP, контракт и отсутствие реального клиента BFF.
- Автоматизированная логика: управляемые часы/late callbacks/synthetic frames; не подтверждает физическую камеру.
- Реальный desktop browser: JPEG/multipart/worker/inference/network; не заменяет телефон.
- Реальный телефон: камера/читаемость/поворот/background/lock/индикатор, память и открытие локального файла.

## Матрица кейсов

| ID | Действие | Ожидаемый результат | Критерий |
|---|---|---|---|
| TC01 | Открыть страницу без взаимодействия | Две вкладки, три engine options, камера/worker выключены | AC01 |
| TC02 | JS выключен или HTML открыт в неисполняющем просмотрщике | Статическое сообщение диагностики, без ложного успеха | AC01, AC10 |
| TC03 | 320/390/768 px и keyboard-only | Нет page overflow, tab semantics/фокус/кнопки доступны | AC01 |
| TC04 | Открыть камеру, разрешить | Реальный rear-preferred поток, settings, playsinline | AC02 |
| TC05 | Отказать, камера занята, API отсутствует, insecure context | Различимые blocked/error причины; ручной VIN доступен | AC02, AC07 |
| TC06 | Оставить permission pending, нажать Stop, затем разрешить | Поздний stream сразу stop, preview не воскресает | AC07 |
| TC07 | Переключить камеру/поворот | Старый track остановлен, ROI корректна, VIN не меняется | AC02, AC11 |
| TC08 | Проверить focus/zoom/torch/sharpness | Действительные capabilities; отсутствие optional, не device fail | AC02 |
| TC09 | Каждый сценарий mock-scenarios.json | Ожидаемые состояния/ошибки/виртуальный обмен, ноль HTTP | AC03 |
| TC10 | Снять JPEG, сериализовать multipart | frameId/image/vin.jpg; размеры/вес/processing time фактические | AC02–AC03 |
| TC11 | Долгий ответ и interval меньше inference | maxInFlight=1, queue=0, свежий следующий кадр | AC03, AC07 |
| TC12 | Ответ с большим remainingMs | Общий deadline не увеличен | AC03, AC07 |
| TC13 | FrameInProgress/TooEarly | Пауза, новый свежий frameId, без очереди | AC03 |
| TC14 | Остальные четыре HTTP 400 | RequestRejected; точный код; без logout/реального 403 | AC03 |
| TC15 | Повтор frameId/create/delete, cancel после terminal | Идемпотентность, неизменный terminal, empty 200 delete | AC03 |
| TC16 | Ответ с чужим session/frame, ответ после deadline | Отброшен; поле не меняется | AC07 |
| TC17 | Stop/Start и двойной Start | Старый результат не попадает в новый run | AC07 |
| TC18 | Paddle реальный кадр + missing/corrupt asset | Настоящий OCR/метрики либо явная ошибка без CDN/мока | AC04 |
| TC19 | Tesseract реальный кадр + missing language/core | Настоящий OCR/метрики либо явная ошибка | AC04 |
| TC20 | Native vin-scanner live с ngрам | Полный компонент, beam активен, native результат/события | AC04, AC06 |
| TC21 | Один frozen снимок на трёх движках | Те же bytes/dimensions/frozenFrameId, раздельные profiles | AC05 |
| TC22 | Paddle/Tesseract: 16/18 символов, I/O/Q, несколько строк, два VIN | Не принять; не склеить/не исправить | AC06 |
| TC23 | Paddle/Tesseract: два read одного изображения, два свежих совпадения, конфликт | Повтор снимка не подтверждает, свежие совпадения подтверждают, конфликт сбрасывает | AC06 |
| TC24 | Смена движка во время init/inference | Старый runtime завершён, callbacks отвергнуты | AC07 |
| TC25 | Мок → native fork → Paddle → мок | Максимум один camera owner и runtime, не смешаны результаты | AC07 |
| TC26 | Hidden/pagehide во время камеры/init/обработки | tracks/timers/worker остановлены, без auto resume | AC07, AC11 |
| TC27 | Ручной VIN во время init и во время кадра | Старый run не пишет поле | AC08 |
| TC28 | Новый явный Start после ручной правки | Новая revision, допустимая однократная подстановка, без autosearch | AC08 |
| TC29 | Init более 60 с и late ready после отмены | InitializationTimeout/stop, камера не включается | AC07 |
| TC30 | Дедлайн 30 с, late native found/slow OCR | Результат после срока не подставлен, native runtime закрыт | AC07 |
| TC31 | DevTools network + cold offline + CSP violations | Ноль runtime HTTP(S)/WS(S), blob reads отдельно, forbidden attempts видимы | AC03, AC10 |
| TC32 | Очистить кэш, отключить сеть, открыть итоговый HTML | Выбранный движок работает без предварительной загрузки или честно blocked | AC10 |
| TC33 | Worker/WASM/SIMD/OffscreenCanvas/createImageBitmap недоступны | Точная engine-specific причина, другой engine не притворяется выбранным | AC04, AC10 |
| TC34 | Сверить manifest/build/NOTICE | Все ресурсы закреплены; отсутствующий/битый asset не проходит build | AC04 |
| TC35 | Эталонный VIN и confidence разных шкал | exact match/ошибки только при ground truth; confidence не выдаёт accuracy | AC05–AC06 |
| TC36 | Native replay fixtures Tier A/B/C | Те же accepted VIN/tier/confidence/checkDigit, что pinned worker; host не блокирует Tier C | AC06 |
| TC37 | Native beam/n-gram/rescore/коррекция длины | Поведение как pinned decoder/worker; исправленный итог принимается без strict gate | AC06 |
| TC38 | Native shutter/3-frame burst/guide fallback/torch/autofocus/retry | Все штатные функции сохранены, optional API отражены | AC04, AC06 |
| TC39 | Native frozen manual fallback с несколькими strip reads | Native verdict не переопределён; один исходный снимок явно указан | AC05–AC06 |
| TC40 | Native close при worker init/camera retry/late permission/bitmap | Нет resurrected stream/worker; core output parity сохранён | AC07 |
| TC41 | Corrupt/missing n-gram | Native greedy fallback сохранён, decoder=greedy и ограничение профиля показаны | AC04, AC06 |
| TC42 | Native RU overlay и остальные локали | RU читаема; другие языки не удалены, controls доступны | AC01, AC04 |
| TC43 | JSON success/failure/cancel/fork event | schema v2 проходит; нет VIN/OCR/deviceId/blob/base64 | AC09 |
| TC44 | Copy разрешён/запрещён, download | Копирование либо понятный fallback, JSON скачивается | AC09 |
| TC45 | Expected mock failure и synthetic self-tests | Logic pass отделён от device/engine; phone checks остаются manual | AC03, AC09, AC12 |

## Матрица реальных телефонов

| Среда | Открытие | Что записать | Текущий статус |
|---|---|---|---|
| Android Chrome, доступный современный телефон | Локальный HTML в Chrome, cold offline | Версия ОС/браузера, protocol/context, три engines, реальные timing | Не проверено |
| Android Chrome, более слабое устройство | То же | Повторные запуски, время, OOM/перезагрузка вкладки, ограничения | Не проверено |
| iPhone Safari, доступный современный iPhone | Файл/передача и фактическое приложение открытия | Исполняется ли JS, камера, Worker/SIMD, все три engines | Не проверено |
| iPhone Safari, более старое доступное устройство | То же | Память/холодный init, повторные native scans, поворот/фон | Не проверено |
| Android/iOS встроенный просмотрщик вложений | Открытие из файлов/мессенджера | Static fallback, ограничение среды; не объявлять дефект камеры | Не проверено |

Для каждого поддерживаемого браузерного запуска выполнить portrait/landscape, читаемость ROI, сворачивание, блокировку экрана, возврат и проверку выключения индикатора камеры. Указать наблюдателя/дату; не считать отсутствие JS в Quick Look отрицательным результатом Safari.

## Набор эталонов и сравнение

Использовать законно доступные/синтетические изображения с известным VIN: чистая табличка, номер под стеклом, штамп, наклон, блики, слабый свет, похожие символы, обрезанный номер, посторонняя строка и два VIN. Для native parity дополнить последовательностями чтений из существующих тестов форка, покрывающими все tiers и rescoring. Expected labels находятся только в локальном тестовом наборе; отчёт пользователю их не экспортирует.

Публиковать отдельно точное совпадение на frozen наборе, live acceptance и задержки. Не объявлять n-gram/consensus результат «ошибкой», если он отличается от raw read; правильность проверяется ground truth. Не сравнивать accuracy по confidence или по успешному моку.

## Критерий выхода

Автоматизированные регрессии и отсутствие runtime network должны проходить. Для каждой целевой phone/browser комбинации есть фактический результат или явное ограничение. Если важная native функция потеряна либо алгоритм отличается от pinned форка, T08/AC06 не закрыты. Если реальные телефоны недоступны, выпуск не получает утверждение о проверенной мобильной поддержке.
