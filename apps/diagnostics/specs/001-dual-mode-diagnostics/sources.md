# Источники и происхождение выводов

Проверено 2026-11-06. Точные SHA локальных checkout и baseline — в [provenance.json](../../context/provenance.json). Ссылки на main/master могут изменяться; для будущей сборки источником версий будет lockfile + asset manifest, не плавающая документация.

| Источник | Что подтверждает |
|---|---|
| [Пользовательский форк, pinned SHA](https://github.com/komaroffsergei/vin-scanner/tree/a9288bb3668633906df657aed29e908dddbe691e) | Фактическая структура и содержимое исследованного форка |
| [package.json пакета](https://github.com/komaroffsergei/vin-scanner/blob/a9288bb3668633906df657aed29e908dddbe691e/packages/vin-scanner/package.json) | v0.1.1, ONNX Runtime dependency, Node >=20, exports, AGPL-3.0-only |
| [core pipeline](https://github.com/komaroffsergei/vin-scanner/blob/a9288bb3668633906df657aed29e908dddbe691e/packages/vin-scanner/src/core/pipeline.js) | Внедряемый ORT, детекция/выпрямление/распознавание и фиксированные входы |
| [Исходники компонента и worker](https://github.com/komaroffsergei/vin-scanner/tree/a9288bb3668633906df657aed29e908dddbe691e/packages/vin-scanner/src) | Собственная камера, lifecycle, fallback и сообщения; вывод о необходимости общего host — инженерное решение |
| [Core consensus и rescoring](https://github.com/komaroffsergei/vin-scanner/tree/a9288bb3668633906df657aed29e908dddbe691e/packages/vin-scanner/src/core) | Temporal tracking, Tier C, n-gram; по уточнению пользователя сохраняются полностью |
| [NOTICE](https://github.com/komaroffsergei/vin-scanner/blob/a9288bb3668633906df657aed29e908dddbe691e/NOTICE.md) и [LICENSE](https://github.com/komaroffsergei/vin-scanner/blob/a9288bb3668633906df657aed29e908dddbe691e/LICENSE) | Происхождение весов, лицензия и атрибуция |
| [PaddleOCR JS — официальный core README](https://github.com/PaddlePaddle/PaddleOCR/blob/main/paddleocr-js/packages/core/README.md) | JS API, worker и работа с моделями; не доказательство нашего offline single-file режима |
| [PaddleOCR JS package metadata](https://registry.npmjs.org/@paddleocr%2Fpaddleocr-js/0.4.2) | Проверенная npm-версия и metadata лицензии |
| [Tesseract.js API](https://github.com/naptha/tesseract.js/blob/master/docs/api.md) | createWorker, параметры, recognize и terminate |
| [Tesseract.js performance](https://github.com/naptha/tesseract.js/blob/master/docs/performance.md) | Переиспользование worker и расходы инициализации |
| [Tesseract local installation](https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md) | Ресурсные пути; примеры документа могут отставать от v7 и требуют проверки |
| [Tesseract.js metadata](https://registry.npmjs.org/tesseract.js/7.0.0) | Проверенная npm-версия и metadata лицензии |
| [ONNX Runtime Web deployment](https://onnxruntime.ai/docs/tutorials/web/deploy.html) | WASM/JS companions, пути и условия развёртывания |
| [ORT Web metadata](https://registry.npmjs.org/onnxruntime-web/1.24.2) | Проверенная npm-версия и metadata лицензии |
| [MDN getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia) | Secure context, разрешения, ошибки и зависимость от среды открытия |
| [MDN worker-src](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/worker-src) | CSP для worker; итоговая политика должна проверяться в браузерах |
| [codex-workspace](https://github.com/komaroffsergei/codex-workspace) | Рабочие правила и submodule pins; приватный репозиторий не включён в архив |
| [Sepia](https://github.com/Nanako0129/sepia) | Назначение плагина: работа с прозой, не SDD framework |

Виртуальный контракт TISS в этом комплекте выведен из исследованной реализации baseline и известного контекста TISS-7731. Jira в рамках подготовки этого архива повторно не читалась и не изменялась. Перед production-интеграцией контракт следует сверить с актуальной историей; это не требуется для автономного браузерного мока.

Результаты телефонов, бенчмарки точности и пользовательские отзывы не подставлялись вместо собственных измерений. Предположения о сборке и поддержке браузеров явно оставлены как задачи T01/T13.
