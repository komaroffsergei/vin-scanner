# Прослеживаемость требований

Ни одна строка ниже не является отметкой выполнения приложения. Это связь спецификации, проектирования и будущих проверок.

| Требования | Решения/контракт | Задачи | Проверки |
|---|---|---|---|
| FR01 | D02; plan UI | T03–T04 | TC01–TC03, TC25 |
| FR02 | environment/report | T04, T11 | TC02, TC05, TC33 |
| FR03 | camera owner/lifecycle | T04, T09 | TC04–TC07, TC24–TC26 |
| FR04 | baseline/native разделение | T04, T08 | TC07–TC08, TC38 |
| FR05 | Settings schema | T05–T07, T10 | TC10–TC12, TC21 |
| FR06 | virtual-api.openapi.json | T05 | TC09–TC10, TC31 |
| FR07 | mock-scenarios.json | T05 | TC09, TC13–TC15, TC45 |
| FR08 | D04, D05 | T01, T04, T06–T08 | TC01, TC18–TC20, TC24 |
| FR09 | ocr-adapter.schema.json | T01, T06–T08 | TC18–TC20 |
| FR10 | Frame/ComparisonRow | T10 | TC21, TC39 |
| FR11 | D06, engine profiles | T06–T08 | TC22, TC36–TC39 |
| FR12 | D07, nativeVerdict | T06–T08 | TC23, TC36, TC39 |
| FR13 | report metrics | T10 | TC35 |
| FR14 | RunContext/no queue | T05, T09 | TC11, TC16–TC17 |
| FR15 | init/recognition budgets | T09 | TC12, TC29–TC30 |
| FR16 | D09 | T04, T08–T09 | TC24–TC26, TC40 |
| FR17 | generation/correlation | T04, T09 | TC06, TC16–TC17, TC24, TC40 |
| FR18 | revision/applied | T09 | TC27–TC28 |
| FR19 | report-v2.schema.json | T11 | TC43–TC44 |
| FR20 | check status/reason codes | T11 | TC05, TC33, TC45 |
| FR21 | D01, CSP/asset closure | T01–T02, T11–T12 | TC09, TC31–TC34 |
| FR22 | D11 | T01–T02, T13 | TC31–TC34, phone matrix |
| FR23 | UI/locale | T04, T08 | TC03, TC07, TC42 |
| FR24 | D06–D08, manifest/NOTICE | T02, T08 | TC20, TC34, TC36–TC42 |

## Проверка качества спецификации

- [x] Уточнение «мок без сетевых запросов» отражено в требованиях/контрактах/задачах.
- [x] Уточнение «полноценный форк, без ограничений алгоритма» отражено в D06–D08, FR11–FR12/FR24 и T08.
- [x] Generic strict profile не применяется к native fork verdict.
- [x] Native camera и baseline camera взаимоисключающие; UI/torch/manual fallback форка не потеряны.
- [x] Выполненное исследование отделено от будущих runtime/phone проверок.
- [x] У всех FR есть задачи и проверяемые критерии; все реализации остаются unchecked.
- [x] Baseline/provenance включены; исходный пользовательский HTML не редактируется.
- [x] Формат одного HTML указан как видимое предположение, вопрос упаковки не объявлен согласованным.
- [ ] T01 доказал автономную работу трёх стеков — ещё не выполнялся.
- [ ] Все AC01–AC12 подтверждены — реализация не начата.
- [ ] Реальные Android/iPhone проверены — ещё не выполнялось.

Машинная проверка JSON/refs/ссылок/UTF-8/ZIP фиксируется в `context/validation.json`. Она подтверждает пакет документов, а не пункты T01–T13.
