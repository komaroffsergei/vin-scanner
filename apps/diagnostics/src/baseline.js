
export function createBaseline(reportProvider) {
  'use strict';

  const BASE = 'https://my-dev.tiss.ru/bff-b2bweb/v1/vin-recognition';
  const TEST_VIN = 'XTA00000000000001';
  const $ = id => document.getElementById(id);
  const elements = {};
  const checks = new Map();
  const events = [];
  const privateValues = new Set([TEST_VIN]);
  const statuses = { pass: 'Работает', fail: 'Ошибка', blocked: 'Заблокировано средой', untested: 'Не проверено', manual: 'Требуется ручная проверка', running: 'Выполняется' };
  const checkDefinitions = [
    ['javascript', 'JavaScript', false], ['secure', 'Безопасный контекст', false], ['launch', 'Способ открытия документа', false], ['media', 'API доступа к камере', false],
    ['cameraPermission', 'Состояние разрешения в браузере', true], ['cameraPolicy', 'Политика доступа к камере', true],
    ['camera', 'Разрешение и реальный поток', false], ['rear', 'Задняя камера', false], ['playback', 'Превью и первый кадр', false],
    ['devices', 'Список камер', true], ['cameraSettings', 'Фактические настройки потока', true], ['canvas', 'Canvas 2D', false],
    ['jpeg', 'Обрезка и JPEG', false], ['budget', 'Размер и вес изображения', false], ['uuid', 'UUID для сессии и кадров', false],
    ['multipart', 'FormData и multipart', false], ['clock', 'Монотонный таймер', false], ['abort', 'Отмена асинхронных операций', false],
    ['capabilities', 'Возможности видеотрека', true], ['focus', 'Управление автофокусом', true], ['zoom', 'Управление зумом', true],
    ['torch', 'Фонарик', true], ['lifecycle', 'Реальное событие ухода в фон', false], ['cleanup', 'Освобождение реального потока', false]
  ];
  const manualDefinitions = [
    ['readability', 'Символы VIN читаются', 'Наведите камеру на строку VIN, нажмите «Проверить кадр» и рассмотрите обрезанный JPEG.'],
    ['rotation', 'Поворот телефона', 'С работающей камерой поверните телефон. Рамка и новый обрезанный кадр должны соответствовать строке VIN.'],
    ['background', 'Сворачивание и возврат', 'Сверните браузер и вернитесь. Камера и попытка должны остановиться и не запускаться самостоятельно.'],
    ['lock', 'Блокировка экрана', 'Заблокируйте телефон с работающей камерой и вернитесь. Если просмотрщик перезагрузил файл, этот пункт остаётся неподтверждённым.'],
    ['indicator', 'Системный индикатор камеры', 'После «Остановить всё» убедитесь, что системный индикатор использования камеры погас.']
  ];
  const manualResults = new Map(manualDefinitions.map(([id]) => [id, 'manual']));
  let externalBusy = false;
  let virtualOperations = 0;
  let stream = null;
  let cameraGeneration = 0;
  let cameraPending = false;
  let permissionHint = null;
  let cancelVideoWait = null;
  let photoUrl = null;
  let photoMetrics = null;
  let cameraCapabilities = {};
  let torchEnabled = false;
  let activeSession = null;
  let lastAttempt = null;
  let lastAttemptOwner = null;
  let vinRevision = 0;
  let selfTesting = false;
  let selfTestCancelled = false;
  const selfTestContexts = new Set();
  let selfTestResults = [];
  let progressTimer = null;
  let syntheticCanvas = null;
  let exportUrl = null;
  let captureBusy = false;
  let captureController = null;
  let capabilitiesBusy = false;
  const environment = {};
  let permissionStatus = null;

  function launchDetails() {
    const protocol = location.protocol;
    const origin = typeof window.origin === 'string' ? window.origin : location.origin;
    return { protocol, documentOrigin: origin, androidContentDocument: protocol === 'content:' };
  }

  function cameraFailureMessage(error) {
    if (error && error.name === 'NotAllowedError' && location.protocol === 'content:') return 'Доступ к видеопотоку отклонён при открытии Android-вложения content://. Причиной может быть источник документа или разрешения Chrome/Android. Наличие API и безопасного контекста не гарантирует показ диалога. Откройте инструкцию ниже; HTML не может сам включить разрешение.';
    if (error && error.name === 'NotAllowedError' && environment.cameraPolicyAllowed === false) return 'Политика документа запрещает camera. При таком запрете браузер может не показывать запрос разрешения. HTML не может изменить политику родительского документа или просмотрщика.';
    return errorInfo(error).message;
  }

  async function inspectCameraPermissions() {
    const policy = document.permissionsPolicy || document.featurePolicy;
    if (policy && typeof policy.allowsFeature === 'function') {
      try { environment.cameraPolicyAllowed = policy.allowsFeature('camera'); setCheck('cameraPolicy', environment.cameraPolicyAllowed ? 'pass' : 'blocked', environment.cameraPolicyAllowed ? 'Permissions Policy не запрещает camera. Разрешение браузера и Android проверяется отдельно.' : 'Permissions Policy запрещает camera; запрос может быть отклонён без диалога.', { allowed: environment.cameraPolicyAllowed }); }
      catch { environment.cameraPolicyAllowed = null; setCheck('cameraPolicy', 'untested', 'Браузер не позволяет прочитать политику camera.'); }
    } else { environment.cameraPolicyAllowed = null; setCheck('cameraPolicy', 'untested', 'API чтения Permissions Policy отсутствует; это не означает запрет камеры.'); }
    if (!navigator.permissions || typeof navigator.permissions.query !== 'function') { environment.cameraPermission = 'unavailable'; setCheck('cameraPermission', 'untested', 'Permissions API отсутствует. Реальный запрос камеры всё равно можно проверить кнопкой.'); return; }
    try {
      permissionStatus = await navigator.permissions.query({ name: 'camera' });
      const update = () => {
        environment.cameraPermission = permissionStatus.state;
        const explanations = { granted: 'Браузер сообщает granted. Фактический поток и разрешение Android проверяются отдельно.', prompt: 'Браузер сообщает prompt. Это ещё не гарантирует, что запрос разрешён для источника документа и Android покажет диалог.', denied: 'Браузер сообщает denied. Причиной может быть сохранённый запрет, политика документа или ограничение текущего источника; это не доказательство отказа пользователя.' };
        setCheck('cameraPermission', permissionStatus.state === 'denied' ? 'blocked' : permissionStatus.state === 'granted' ? 'pass' : 'manual', explanations[permissionStatus.state] || 'Неизвестное состояние разрешения.', { state: permissionStatus.state });
      };
      permissionStatus.onchange = update;
      update();
    } catch { environment.cameraPermission = 'unavailable'; setCheck('cameraPermission', 'untested', 'Этот браузер не поддерживает query({name: camera}). Это не запрещает попытку getUserMedia.'); }
  }

  function node(tag, className, text) {
    const result = document.createElement(tag);
    if (className) result.className = className;
    if (text !== undefined) result.textContent = text;
    return result;
  }

  function statusNode(status) { return node('span', 'status ' + status, statuses[status] || status); }

  function redact(text) {
    let result = String(text);
    for (const value of [...privateValues].filter(value => value && value.length >= 3).sort((left, right) => right.length - left.length)) result = result.split(value).join('[скрыто]');
    return result.replace(/\b[A-HJ-NPR-Z0-9]{17}\b/gi, '[VIN скрыт]');
  }

  function log(message, category = 'diagnostic') {
    const entry = { time: new Date().toISOString(), category, message: redact(message) };
    events.push(entry);
    if (events.length > 80) events.shift();
    const row = node('div', 'log-entry');
    const time = node('time', '', new Date(entry.time).toLocaleTimeString('ru-RU'));
    time.dateTime = entry.time;
    row.append(time, document.createTextNode(entry.message));
    elements.eventLog.prepend(row);
    while (elements.eventLog.children.length > 80) elements.eventLog.lastChild.remove();
  }

  function setCheck(id, status, detail, values) {
    const previous = checks.get(id);
    if (!previous) return;
    checks.set(id, { ...previous, status, detail, values: values || null, updatedAt: new Date().toISOString() });
    renderChecks();
  }

  function renderChecks() {
    const fragment = document.createDocumentFragment();
    for (const check of checks.values()) {
      const row = node('div', 'check');
      row.dataset.check = check.id;
      const top = node('div', 'check-top');
      const title = node('div', 'check-name', check.name);
      if (check.optional) title.append(node('span', 'optional', ' · необязательно'));
      top.append(title, statusNode(check.status));
      row.append(top, node('p', 'check-detail', check.detail));
      fragment.append(row);
    }
    elements.checks.replaceChildren(fragment);
    const required = [...checks.values()].filter(check => !check.optional);
    const counts = required.reduce((accumulator, check) => { accumulator[check.status] = (accumulator[check.status] || 0) + 1; return accumulator; }, {});
    const problems = (counts.fail || 0) + (counts.blocked || 0);
    const pending = required.length - (counts.pass || 0) - problems;
    elements.deviceSummary.textContent = 'Обязательные проверки: работает ' + (counts.pass || 0) + ' из ' + required.length + '; ошибок или блокировок ' + problems + '; ещё не подтверждено ' + pending + '. Ручные пункты оцениваются отдельно.';
  }

  function renderManual() {
    const fragment = document.createDocumentFragment();
    for (const [id, title, description] of manualDefinitions) {
      const row = node('div', 'manual-row');
      const top = node('div', 'check-top');
      top.append(node('strong', 'check-name', title), statusNode(manualResults.get(id)));
      row.append(top, node('p', 'small muted', description));
      const buttons = node('div', 'row manual-buttons');
      for (const [status, label] of [['pass', 'Подтверждаю'], ['fail', 'Не работает'], ['manual', 'Не проверено']]) {
        const button = node('button', '', label);
        button.type = 'button';
        button.dataset.manual = id;
        button.dataset.result = status;
        button.setAttribute('aria-label', label + ': ' + title);
        button.setAttribute('aria-pressed', String(manualResults.get(id) === status));
        buttons.append(button);
      }
      row.append(buttons);
      fragment.append(row);
    }
    elements.manualChecks.replaceChildren(fragment);
  }

  function errorInfo(error) {
    const name = error && error.name ? error.name : 'Error';
    const messages = {
      NotAllowedError: 'Браузер или ОС не разрешили доступ. Проверьте разрешение камеры и способ открытия HTML.',
      SecurityError: 'Доступ запрещён политикой безопасности или просмотрщиком файла.',
      NotFoundError: 'Браузер не нашёл подходящую камеру.',
      NotReadableError: 'Камера недоступна: возможно, занята другим приложением или ограничена ОС.',
      OverconstrainedError: 'Выбранная камера не поддерживает запрошенные ограничения.',
      AbortError: 'Операция отменена.',
      VideoTimeoutError: 'Поток получен, но браузер не предоставил кадр превью за 8 секунд.',
      ImageBudgetError: 'JPEG превышает заданный лимит. Измените параметры и повторите проверку.',
      JpegError: 'Не удалось получить бинарный JPEG через Canvas.toBlob.',
      UuidError: 'crypto.randomUUID недоступен. Подмена UUID другим алгоритмом не выполняется.',
      FrameError: 'Нет пригодного видеокадра или геометрия рамки пока не определена.',
      MultipartError: 'Не удалось локально сформировать multipart/FormData.',
      SettingsError: 'Некорректные параметры. Проверьте числа и указанные диапазоны.'
    };
    return { name, message: messages[name] || 'Операция не поддерживается или завершилась ошибкой браузера (' + name + ').' };
  }

  function namedError(name) { const error = new Error(name); error.name = name; return error; }
  function uuid() { if (!window.crypto || typeof window.crypto.randomUUID !== 'function') throw namedError('UuidError'); return window.crypto.randomUUID(); }
  function cloneSettings(settings) { return { captureIntervalMs: settings.captureIntervalMs, sessionTimeoutSeconds: settings.sessionTimeoutSeconds, image: { ...settings.image } }; }

  function readSettings() {
    const settings = { captureIntervalMs: Number(elements.intervalInput.value), sessionTimeoutSeconds: Number(elements.timeoutInput.value), image: { maxDimension: Number(elements.dimensionInput.value), jpegQuality: Number(elements.qualityInput.value), maxBytes: Number(elements.bytesInput.value) } };
    const delay = Number(elements.delayInput.value);
    const ranges = [[settings.captureIntervalMs, 1, 60000, true], [settings.sessionTimeoutSeconds, 0.1, 300], [settings.image.maxDimension, 32, 4096, true], [settings.image.jpegQuality, 0, 1], [settings.image.maxBytes, 1, 20000000, true], [delay, 0, 60000, true]];
    if (ranges.some(([value, minimum, maximum, integer]) => !Number.isFinite(value) || value < minimum || value > maximum || (integer && !Number.isInteger(value)))) throw namedError('SettingsError');
    return { settings, delay };
  }

  function updateControls() {
    const busy = !!activeSession || selfTesting || externalBusy;
    const live = !!stream && stream.getVideoTracks().some(track => track.readyState === 'live');
    elements.cameraButton.disabled = busy || cameraPending || live;
    elements.stopButton.disabled = !(activeSession || cameraPending || live || selfTesting || externalBusy);
    elements.captureButton.disabled = busy || !live || captureBusy;
    elements.cameraSelect.disabled = busy || cameraPending || !live || capabilitiesBusy;
    elements.runButton.disabled = busy || cameraPending || captureBusy;
    elements.selfTestButton.disabled = busy || cameraPending || captureBusy;
    elements.manualButton.disabled = selfTesting;
    for (const id of ['sourceSelect', 'scenarioSelect', 'intervalInput', 'timeoutInput', 'dimensionInput', 'qualityInput', 'bytesInput', 'delayInput', 'configSelect']) elements[id].disabled = busy;
    elements.focusButton.disabled = busy || !live || capabilitiesBusy || !Array.isArray(cameraCapabilities.focusMode) || !cameraCapabilities.focusMode.some(mode => mode === 'continuous' || mode === 'auto');
    elements.torchButton.disabled = busy || !live || capabilitiesBusy || cameraCapabilities.torch !== true;
    elements.zoomInput.disabled = busy || !live || capabilitiesBusy || !cameraCapabilities.zoom || !(cameraCapabilities.zoom.max > cameraCapabilities.zoom.min);
  }

  function stopCamera(reason, record = true) {
    if (photoUrl) { URL.revokeObjectURL(photoUrl); photoUrl = null; elements.cropImage.removeAttribute('src'); elements.thumbnail.hidden = true; }
    const wasPending = cameraPending;
    if (captureController) { captureController.abort(); captureController = null; captureBusy = false; }
    cameraGeneration++;
    clearTimeout(permissionHint);
    permissionHint = null;
    cameraPending = false;
    capabilitiesBusy = false;
    if (cancelVideoWait) cancelVideoWait();
    const tracks = stream ? stream.getTracks() : [];
    for (const track of tracks) track.stop();
    stream = null;
    elements.video.pause();
    elements.video.srcObject = null;
    elements.cameraBox.classList.remove('live');
    cameraCapabilities = {};
    torchEnabled = false;
    elements.torchButton.textContent = 'Включить фонарик';
    elements.torchButton.setAttribute('aria-pressed', 'false');
    elements.cameraInfo.textContent = 'Камера выключена. Для новой попытки нажмите «Открыть камеру».';
    if (wasPending && record) setCheck('camera', 'untested', 'Ожидание камеры отменено. Если разрешение придёт позднее, полученный поток будет остановлен.');
    if (tracks.length && record) {
      const ended = tracks.every(track => track.readyState === 'ended');
      setCheck('cleanup', ended ? 'pass' : 'fail', ended ? 'Все ' + tracks.length + ' трека остановлены; srcObject очищен. Системный индикатор проверьте вручную.' : 'Не все треки перешли в ended.', { tracks: tracks.length, allEnded: ended });
      log('Камера остановлена: ' + reason + '. Треков: ' + tracks.length + '.');
    }
    updateControls();
  }

  function cancelCurrent(reason) {
    if (selfTesting) {
      selfTestCancelled = true;
      for (const testContext of selfTestContexts) testContext.controller.abort();
      log('Синтетическая самопроверка остановлена: ' + reason + '.', 'self-test');
    }
    const context = activeSession;
    if (context) {
      context.cancelReason = reason;
      mockCancel(context);
      context.controller.abort();
      // Release the UI immediately; the session promise cannot own a newer run.
      activeSession = null;
      lastAttempt = { ...attemptSummary(context), status: 'Cancelled', applied: false };
      lastAttemptOwner = context;
      clearInterval(progressTimer);
      progressTimer = null;
      showSession('Cancelled', reason + '. Поздние результаты будут проигнорированы.');
    }
    stopCamera(reason);
    if (context) log('Попытка отменена: ' + reason + '.', 'simulation');
  }

  function waitForVideo(video, generation) {
    return new Promise((resolve, reject) => {
      let timer;
      const clean = () => { clearTimeout(timer); video.removeEventListener('loadeddata', ready); video.removeEventListener('playing', ready); if (cancelVideoWait === cancel) cancelVideoWait = null; };
      const ready = () => { if (generation !== cameraGeneration) { cancel(); return; } if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) { clean(); resolve(); } };
      const cancel = () => { clean(); reject(namedError('AbortError')); };
      cancelVideoWait = cancel;
      video.addEventListener('loadeddata', ready);
      video.addEventListener('playing', ready);
      timer = setTimeout(() => { clean(); reject(namedError('VideoTimeoutError')); }, 8000);
      ready();
    });
  }

  async function openCamera(deviceId) {
    if (cameraPending || activeSession || selfTesting) return;
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      setCheck('camera', 'blocked', 'В этом способе открытия API камеры недоступен. Это не проверка наличия камеры на телефоне.');
      log('Запрос камеры невозможен: mediaDevices.getUserMedia отсутствует.');
      return;
    }
    stopCamera('Выбор камеры', false);
    elements.cameraErrorDetails.hidden = true;
    elements.cameraErrorText.textContent = '';
    const generation = ++cameraGeneration;
    cameraPending = true;
    for (const id of ['camera', 'rear', 'playback', 'devices', 'cameraSettings', 'capabilities', 'focus', 'zoom', 'torch']) setCheck(id, id === 'camera' ? 'running' : 'untested', id === 'camera' ? 'Ожидается решение браузера или ОС.' : 'Проверяется для новой камеры.');
    elements.cameraInfo.textContent = 'Ожидается разрешение камеры. Это время не входит в таймер распознавания.';
    updateControls();
    const hintTimer = setTimeout(() => {
      if (generation !== cameraGeneration) return;
      setCheck('camera', 'running', 'Ответа на запрос разрешения пока нет. Проверьте системный диалог; можно нажать «Остановить всё».');
      elements.cameraInfo.textContent = 'Разрешение ещё не получено. Проверьте диалог ОС или отмените ожидание.';
    }, 12000);
    permissionHint = hintTimer;
    let acquired = null;
    try {
      const videoConstraints = deviceId ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } } : { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } };
      acquired = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false });
      clearTimeout(hintTimer);
      if (permissionHint === hintTimer) permissionHint = null;
      if (generation !== cameraGeneration || document.hidden) {
        for (const track of acquired.getTracks()) track.stop();
        if (!stream) setCheck('cleanup', 'pass', 'Поток, пришедший после отмены запроса разрешения, немедленно остановлен.', { latePermissionStreamStopped: true });
        log('Поздно полученный поток остановлен, камера не возобновилась.');
        return;
      }
      stream = acquired;
      const track = stream.getVideoTracks()[0];
      if (!track) throw namedError('NotFoundError');
      const settings = typeof track.getSettings === 'function' ? track.getSettings() : {};
      if (settings.deviceId) privateValues.add(settings.deviceId);
      if (settings.groupId) privateValues.add(settings.groupId);
      if (track.label) privateValues.add(track.label);
      track.addEventListener('ended', () => {
        if (stream === acquired) { cancelCurrent('Видеотрек завершён браузером или ОС'); setCheck('camera', 'blocked', 'ОС или браузер завершили видеопоток. Требуется новый явный запуск.'); }
      });
      elements.video.muted = true;
      elements.video.srcObject = stream;
      await elements.video.play();
      await waitForVideo(elements.video, generation);
      if (generation !== cameraGeneration) return;
      cameraPending = false;
      elements.cameraBox.classList.add('live');
      setCheck('camera', 'pass', 'Разрешение получено, видеотрек live; аудио не запрашивалось.', { videoTracks: stream.getVideoTracks().length, audioTracks: stream.getAudioTracks().length });
      if (location.protocol === 'content:') { setCheck('launch', 'pass', 'В этом запуске content:// удалось реально получить видеопоток. Успех подтверждён запросом камеры.'); elements.environmentNotice.hidden = true; }
      setCheck('playback', 'pass', 'Превью воспроизводится внутри страницы; первый видеокадр доступен.', { width: elements.video.videoWidth, height: elements.video.videoHeight, playsInline: elements.video.playsInline });
      const safeSettings = { width: settings.width || elements.video.videoWidth, height: settings.height || elements.video.videoHeight, frameRate: settings.frameRate ?? null, facingMode: settings.facingMode || null, resizeMode: settings.resizeMode || null };
      setCheck('cameraSettings', 'pass', 'Текущие настройки: ' + JSON.stringify(safeSettings), safeSettings);
      setCheck('rear', settings.facingMode === 'environment' ? 'pass' : 'manual', settings.facingMode === 'environment' ? 'Браузер сообщил facingMode=environment.' : 'Браузер не подтвердил заднюю камеру. Проверьте превью; при необходимости выберите другую камеру.');
      elements.cameraInfo.textContent = safeSettings.width + ' × ' + safeSettings.height + ' px · ' + (safeSettings.frameRate ? Number(safeSettings.frameRate).toFixed(1) + ' fps' : 'частота не сообщается') + ' · ' + (safeSettings.facingMode || 'направление не сообщается');
      inspectCapabilities(track);
      await listCameras(generation, settings.deviceId);
      log('Реальная камера подключена; превью доступно.');
    } catch (error) {
      clearTimeout(hintTimer);
      if (permissionHint === hintTimer) permissionHint = null;
      if (generation !== cameraGeneration) { if (acquired) for (const track of acquired.getTracks()) track.stop(); return; }
      const info = errorInfo(error);
      stopCamera('Ошибка открытия камеры');
      const message = cameraFailureMessage(error);
      setCheck(info.name === 'VideoTimeoutError' ? 'playback' : 'camera', ['NotAllowedError', 'SecurityError', 'NotReadableError'].includes(info.name) ? 'blocked' : 'fail', message + ' Код: ' + info.name + '.');
      elements.cameraInfo.textContent = message;
      environment.lastCameraError = { name: info.name, protocol: location.protocol, permissionState: environment.cameraPermission || null, cameraPolicyAllowed: environment.cameraPolicyAllowed ?? null };
      elements.cameraErrorDetails.hidden = false;
      elements.cameraErrorText.textContent = JSON.stringify({ name: info.name, browserMessage: redact(String(error.message || 'Браузер не сообщил текст ошибки.')), ...launchDetails(), secureContext: window.isSecureContext === true, permissionState: environment.cameraPermission || 'не сообщается', cameraPolicyAllowed: environment.cameraPolicyAllowed ?? 'не сообщается' }, null, 2);
      if (location.protocol === 'content:' && info.name === 'NotAllowedError') {
        setCheck('launch', 'blocked', 'При открытии Android-вложения content:// браузер вернул NotAllowedError. Это ограничение текущего запуска или разрешений, а не вывод о возможностях камеры телефона.');
        elements.environmentTag.textContent = 'Видеопоток заблокирован'; elements.environmentTag.className = 'status blocked';
        elements.environmentNotice.hidden = false; elements.environmentNotice.textContent = message;
      }
      log('Камера: ' + info.name + '. ' + message);
    } finally {
      if (generation === cameraGeneration) cameraPending = false;
      updateControls();
    }
  }

  async function listCameras(generation, selectedId) {
    if (typeof navigator.mediaDevices.enumerateDevices !== 'function') { setCheck('devices', 'untested', 'enumerateDevices отсутствует; основной видеопоток может работать.'); return; }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (generation !== cameraGeneration) return;
      const cameras = devices.filter(device => device.kind === 'videoinput');
      elements.cameraSelect.replaceChildren();
      cameras.forEach((camera, index) => {
        for (const value of [camera.deviceId, camera.groupId, camera.label]) if (value) privateValues.add(value);
        const option = node('option', '', camera.label || 'Камера ' + (index + 1));
        option.value = camera.deviceId;
        option.selected = camera.deviceId === selectedId;
        elements.cameraSelect.append(option);
      });
      setCheck('devices', cameras.length ? 'pass' : 'manual', 'Браузер перечислил камер: ' + cameras.length + '. Идентификаторы не попадут в отчёт.', { count: cameras.length });
    } catch (error) { setCheck('devices', 'manual', 'Поток работает, но список камер получить не удалось: ' + errorInfo(error).name + '.'); }
  }

  function inspectCapabilities(track) {
    cameraCapabilities = {};
    if (typeof track.getCapabilities !== 'function' || typeof track.applyConstraints !== 'function') {
      for (const id of ['capabilities', 'focus', 'zoom', 'torch']) setCheck(id, 'untested', 'Браузер не предоставляет нужное API управления треком. Это необязательная возможность.');
      return;
    }
    try {
      cameraCapabilities = track.getCapabilities();
      for (const key of ['deviceId', 'groupId']) if (cameraCapabilities[key]) privateValues.add(cameraCapabilities[key]);
      const safe = { width: cameraCapabilities.width || null, height: cameraCapabilities.height || null, frameRate: cameraCapabilities.frameRate || null, facingMode: cameraCapabilities.facingMode || null, focusMode: cameraCapabilities.focusMode || null, zoom: cameraCapabilities.zoom || null, torch: cameraCapabilities.torch === true };
      setCheck('capabilities', 'pass', 'Возможности трека прочитаны. Наличие настройки ещё не подтверждает эффект её применения.', safe);
      const focus = Array.isArray(cameraCapabilities.focusMode) && cameraCapabilities.focusMode.some(mode => mode === 'continuous' || mode === 'auto');
      setCheck('focus', focus ? 'manual' : 'untested', focus ? 'Режим автофокуса заявлен. Нажмите «Проверить автофокус» и оцените резкость.' : 'Управление автофокусом не предоставляется; камера может фокусироваться автоматически.');
      const zoom = cameraCapabilities.zoom;
      setCheck('zoom', zoom && zoom.max > zoom.min ? 'manual' : 'untested', zoom && zoom.max > zoom.min ? 'Заявлен диапазон ' + zoom.min + '…' + zoom.max + '. Передвиньте ползунок для проверки.' : 'Управление зумом не предоставляется.');
      if (zoom && zoom.max > zoom.min) {
        elements.zoomInput.min = String(zoom.min); elements.zoomInput.max = String(zoom.max); elements.zoomInput.step = String(zoom.step || 0.1);
        const current = track.getSettings().zoom;
        elements.zoomInput.value = String(Number.isFinite(current) ? current : zoom.min);
        elements.zoomValue.textContent = elements.zoomInput.value;
      } else elements.zoomValue.textContent = 'не доступен';
      setCheck('torch', cameraCapabilities.torch === true ? 'manual' : 'untested', cameraCapabilities.torch === true ? 'Фонарик заявлен. Проверьте его включение кнопкой.' : 'Управление фонариком не предоставляется.');
    } catch (error) { setCheck('capabilities', 'untested', 'Возможности прочитать не удалось: ' + errorInfo(error).name + '. Основной поток проверяется отдельно.'); }
    updateControls();
  }

  async function applyCameraSetting(kind, value) {
    const track = stream && stream.getVideoTracks()[0];
    if (!track || activeSession || selfTesting || capabilitiesBusy) return;
    const generation = cameraGeneration;
    capabilitiesBusy = true;
    updateControls();
    try {
      await track.applyConstraints({ advanced: [{ [kind]: value }] });
      if (generation !== cameraGeneration) return;
      const actual = track.getSettings()[kind];
      const confirmed = kind === 'zoom' ? Number.isFinite(actual) && Math.abs(actual - value) < Math.max(0.11, cameraCapabilities.zoom?.step || 0) : actual === value;
      const id = kind === 'focusMode' ? 'focus' : kind;
      setCheck(id, confirmed ? 'pass' : 'manual', confirmed ? 'Настройка принята и подтверждена getSettings. Визуальный эффект оцените по превью.' : 'Запрос принят, но фактическое значение не подтверждено браузером; проверьте визуально.', { requested: value, actual: actual ?? null });
      if (kind === 'torch') { torchEnabled = actual === undefined ? value : actual; elements.torchButton.textContent = torchEnabled ? 'Выключить фонарик' : 'Включить фонарик'; elements.torchButton.setAttribute('aria-pressed', String(torchEnabled)); }
      if (kind === 'zoom') elements.zoomValue.textContent = String(actual ?? value);
      log('Проверена дополнительная настройка: ' + kind + '.');
    } catch (error) { if (generation === cameraGeneration) setCheck(kind === 'focusMode' ? 'focus' : kind, 'blocked', 'Настройка заявлена, но применить её не удалось: ' + errorInfo(error).name + '. Основной сценарий проверяется отдельно.'); }
    finally { if (generation === cameraGeneration) capabilitiesBusy = false; updateControls(); }
  }

  function getSyntheticCanvas() {
    if (syntheticCanvas) return syntheticCanvas;
    const canvas = document.createElement('canvas');
    canvas.width = 1280; canvas.height = 240;
    const context = canvas.getContext('2d');
    if (!context) throw namedError('FrameError');
    context.fillStyle = '#f4f0dd'; context.fillRect(0, 0, 1280, 240);
    context.fillStyle = '#273b4c'; context.font = '22px sans-serif'; context.fillText('СИНТЕТИЧЕСКИЙ КАДР · НЕ РЕАЛЬНЫЙ ДОКУМЕНТ', 35, 47);
    context.font = 'bold 57px monospace'; context.fillText('VIN  ' + TEST_VIN, 35, 137);
    context.strokeStyle = '#496278'; context.lineWidth = 2; context.strokeRect(22, 73, 1236, 94);
    context.font = '18px sans-serif'; context.fillText('Только проверка Canvas / JPEG / FormData. OCR не выполняется.', 35, 209);
    syntheticCanvas = canvas;
    return canvas;
  }

  function sharpness(canvas) {
    const sample = document.createElement('canvas');
    sample.width = Math.min(256, canvas.width);
    sample.height = Math.max(3, Math.round(canvas.height * sample.width / canvas.width));
    const context = sample.getContext('2d', { willReadFrequently: true });
    context.drawImage(canvas, 0, 0, sample.width, sample.height);
    const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
    const gray = new Float64Array(sample.width * sample.height);
    let brightness = 0;
    for (let index = 0; index < gray.length; index++) { const offset = index * 4; gray[index] = 0.299 * pixels[offset] + 0.587 * pixels[offset + 1] + 0.114 * pixels[offset + 2]; brightness += gray[index]; }
    let sum = 0, squares = 0, count = 0;
    for (let row = 1; row < sample.height - 1; row++) for (let column = 1; column < sample.width - 1; column++) { const index = row * sample.width + column; const laplacian = gray[index - 1] + gray[index + 1] + gray[index - sample.width] + gray[index + sample.width] - 4 * gray[index]; sum += laplacian; squares += laplacian * laplacian; count++; }
    return { brightness: Math.round(brightness / gray.length), laplacianVariance: count ? Math.round((squares / count - (sum / count) ** 2) * 10) / 10 : 0 };
  }

  async function prepareFrame(sourceKind, settings, publish) {
    const startedAt = performance.now();
    const canvas = document.createElement('canvas');
    let source, sourceX = 0, sourceY = 0, sourceWidth, sourceHeight;
    const generation = cameraGeneration;
    if (sourceKind === 'camera') {
      if (!stream || elements.video.readyState < 2 || !elements.video.videoWidth) throw namedError('FrameError');
      source = elements.video;
      const box = source.getBoundingClientRect();
      const roi = elements.roi.getBoundingClientRect();
      if (!box.width || !box.height || !roi.width || !roi.height) throw namedError('FrameError');
      const scale = Math.max(box.width / source.videoWidth, box.height / source.videoHeight);
      const offsetX = (source.videoWidth * scale - box.width) / 2;
      const offsetY = (source.videoHeight * scale - box.height) / 2;
      sourceX = Math.max(0, Math.min(source.videoWidth - 1, (roi.left - box.left + offsetX) / scale));
      sourceY = Math.max(0, Math.min(source.videoHeight - 1, (roi.top - box.top + offsetY) / scale));
      sourceWidth = Math.min(source.videoWidth - sourceX, roi.width / scale);
      sourceHeight = Math.min(source.videoHeight - sourceY, roi.height / scale);
    } else { source = getSyntheticCanvas(); sourceWidth = source.width; sourceHeight = source.height; }
    const factor = Math.min(1, settings.image.maxDimension / Math.max(sourceWidth, sourceHeight));
    canvas.width = Math.max(1, Math.round(sourceWidth * factor)); canvas.height = Math.max(1, Math.round(sourceHeight * factor));
    const context = canvas.getContext('2d');
    if (!context) throw namedError('FrameError');
    context.drawImage(source, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
    const qualityMetrics = sharpness(canvas);
    const blob = await new Promise((resolve, reject) => { try { canvas.toBlob(result => result ? resolve(result) : reject(namedError('JpegError')), 'image/jpeg', settings.image.jpegQuality); } catch { reject(namedError('JpegError')); } });
    if (sourceKind === 'camera' && generation !== cameraGeneration) throw namedError('AbortError');
    if (blob.type !== 'image/jpeg' || !blob.size) throw namedError('JpegError');
    const frameId = uuid();
    const formData = new FormData();
    formData.append('frameId', frameId); formData.append('image', blob, 'vin.jpg');
    let multipartBytes, multipartType;
    try {
      const serialized = new Response(formData);
      multipartType = serialized.headers.get('content-type');
      multipartBytes = (await serialized.arrayBuffer()).byteLength;
      if (!multipartType || !multipartType.includes('multipart/form-data; boundary=') || multipartBytes <= blob.size || formData.get('frameId') !== frameId || formData.get('image').type !== 'image/jpeg') throw namedError('MultipartError');
    } catch { throw namedError('MultipartError'); }
    const metrics = { source: sourceKind, width: canvas.width, height: canvas.height, bytes: blob.size, multipartBytes, preparationMs: Math.round((performance.now() - startedAt) * 10) / 10, crop: { x: Math.round(sourceX), y: Math.round(sourceY), width: Math.round(sourceWidth), height: Math.round(sourceHeight) }, ...qualityMetrics };
    const withinBudget = blob.size <= settings.image.maxBytes && Math.max(canvas.width, canvas.height) <= settings.image.maxDimension;
    if (typeof publish === 'function' ? publish() : publish) {
      photoMetrics = metrics;
      if (photoUrl) URL.revokeObjectURL(photoUrl);
      photoUrl = URL.createObjectURL(blob);
      elements.cropImage.src = photoUrl; elements.thumbnail.hidden = false;
      elements.cropInfo.textContent = (sourceKind === 'camera' ? 'Реальная камера' : 'Синтетический кадр') + ' · ' + canvas.width + ' × ' + canvas.height + ' px · ' + Math.round(blob.size / 1024) + ' КБ · подготовка ' + metrics.preparationMs + ' мс · резкость ' + metrics.laplacianVariance + ' (без порога) · яркость ' + metrics.brightness + '/255.';
      if (sourceKind === 'camera') {
        setCheck('jpeg', 'pass', 'Рамка обрезана с учётом object-fit: cover; получен image/jpeg.', { width: canvas.width, height: canvas.height, preparationMs: metrics.preparationMs, crop: metrics.crop, laplacianVariance: metrics.laplacianVariance, brightness: metrics.brightness });
        setCheck('budget', withinBudget ? 'pass' : 'fail', 'JPEG: ' + blob.size + ' байт при лимите ' + settings.image.maxBytes + '; длинная сторона ' + Math.max(canvas.width, canvas.height) + ' px при лимите ' + settings.image.maxDimension + '.', { bytes: blob.size, maxBytes: settings.image.maxBytes, maxDimension: settings.image.maxDimension });
        setCheck('multipart', 'pass', 'Сериализованы frameId и image/jpeg; boundary сформирован браузером. Размер multipart ' + multipartBytes + ' байт. Сетевого запроса не было.', { fields: ['frameId', 'image'], imageType: 'image/jpeg', multipartBytes });
      }
    }
    if (!withinBudget) throw namedError('ImageBudgetError');
    return { frameId, blob, formData, metrics };
  }

  async function captureOnce() {
    if (captureBusy || activeSession || selfTesting) return;
    let controller, timer, expired = false;
    try {
      controller = new AbortController(); captureController = controller; captureBusy = true; updateControls();
      timer = setTimeout(() => { expired = true; controller.abort(); }, 8000);
      const { settings } = readSettings();
      const frame = await abortable(prepareFrame('camera', settings, () => captureController === controller && !controller.signal.aborted), controller.signal);
      log('Реальный кадр подготовлен: ' + frame.metrics.width + '×' + frame.metrics.height + ', JPEG ' + frame.metrics.bytes + ' байт.');
    }
    catch (error) {
      const info = errorInfo(error);
      if (expired) { setCheck('jpeg', 'fail', 'Подготовка кадра или multipart не завершилась за 8 секунд. Ожидание остановлено.'); log('Истекло время подготовки кадра; интерфейс освобождён.'); }
      else if (info.name !== 'AbortError') { setCheck(info.name === 'MultipartError' ? 'multipart' : info.name === 'UuidError' ? 'uuid' : info.name === 'ImageBudgetError' ? 'budget' : 'jpeg', 'fail', info.message); log('Подготовка кадра: ' + info.name + '.'); }
    }
    finally { clearTimeout(timer); if (captureController === controller) { captureController = null; captureBusy = false; } updateControls(); }
  }

  function sleep(milliseconds, signal) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) { reject(namedError('AbortError')); return; }
      const done = () => { signal.removeEventListener('abort', cancelled); resolve(); };
      const timer = setTimeout(done, Math.max(0, milliseconds));
      const cancelled = () => { clearTimeout(timer); signal.removeEventListener('abort', cancelled); reject(namedError('AbortError')); };
      signal.addEventListener('abort', cancelled, { once: true });
    });
  }

  function abortable(promise, signal) {
    return new Promise((resolve, reject) => {
      const cancelled = () => { signal.removeEventListener('abort', cancelled); reject(namedError('AbortError')); };
      signal.addEventListener('abort', cancelled, { once: true });
      Promise.resolve(promise).then(value => { signal.removeEventListener('abort', cancelled); resolve(value); }, error => { signal.removeEventListener('abort', cancelled); reject(error); });
      if (signal.aborted) cancelled();
    });
  }

  function makeContext(settings, scenario, delay, options = {}) {
    const startedAt = performance.now();
    const context = { id: uuid(), settings: cloneSettings(settings), scenario, delay, source: options.source || 'synthetic', fast: !!options.fast, startedAt, deadline: startedAt + settings.sessionTimeoutSeconds * 1000, controller: new AbortController(), revision: options.revision || 0, expired: false, applied: false, done: false, frames: 0, inFlight: 0, maxInFlight: 0, queue: 0, recoveries: 0, trace: options.trace || (() => {}), metrics: options.metrics || (() => {}), server: null, timer: null };
    if (selfTesting) { selfTestContexts.add(context); if (selfTestCancelled) context.controller.abort(); }
    return context;
  }

  function attemptSummary(context) { return { runId: context.id, settings: cloneSettings(context.settings), source: context.source, scenario: context.scenario, status: context.status || null, frames: context.frames, maxInFlight: context.maxInFlight, finalInFlight: context.inFlight, queue: context.queue, recoveries: context.recoveries, elapsedMs: Math.round(performance.now() - context.startedAt), applied: !!context.applied }; }
  function canApplyResult(context, current, revision) { return context === current && context.revision === revision && !context.done && !context.applied && !context.controller.signal.aborted && performance.now() < context.deadline; }
  function ensureActive(context) { if (performance.now() >= context.deadline) { context.expired = true; context.controller.abort(); } if (context.controller.signal.aborted) throw namedError('AbortError'); }
  function remaining(context) { return Math.max(0, Math.floor(context.server.deadline - performance.now())); }
  function requestError(code, propertyName = 'image') { const error = namedError('MockHttpError'); error.httpStatus = 400; error.code = code; error.body = { messages: ['Симулированная ошибка валидации'], errors: [{ propertyName, errorMessage: 'Тестовая ошибка: ' + code, errorCode: code }] }; return error; }

  async function mockOperation(context, operation, frame) {
    virtualOperations++;
    const path = operation === 'create' ? '/sessions/' + context.id : '/sessions/' + context.id + '/frames';
    context.trace('request', { method: 'POST', url: BASE + path, body: operation === 'create' ? null : { frameId: frame.frameId, image: { filename: 'vin.jpg', contentType: 'image/jpeg', bytes: frame.blob.size }, multipartBytes: frame.metrics.multipartBytes } });
    if (operation === 'frame') { context.inFlight++; context.maxInFlight = Math.max(context.maxInFlight, context.inFlight); context.metrics(context); }
    try {
      let latency = operation === 'create' ? Math.min(context.delay, context.fast ? 2 : 150) : context.delay;
      if (operation === 'frame' && context.scenario === 'slow') latency = Math.max(latency, context.fast ? 55 : 2500);
      if (operation === 'frame' && context.scenario === 'timeout') latency = context.settings.sessionTimeoutSeconds * 1000 + 1000;
      await sleep(latency, context.controller.signal);
      ensureActive(context);
      let body;
      if (operation === 'create') {
        if (!context.server) context.server = { deadline: performance.now() + context.settings.sessionTimeoutSeconds * 1000, status: context.scenario === 'disabled' ? 'Disabled' : 'Searching', terminal: context.scenario === 'disabled', cache: new Map(), errorSent: false };
        body = { sessionId: context.id, status: context.server.status, terminal: context.server.terminal, remainingMs: remaining(context), settings: cloneSettings(context.settings) };
      } else {
        if (!context.server) throw requestError('VinRecognitionSessionNotFound', 'sessionId');
        if (context.server.cache.has(frame.frameId)) { body = context.server.cache.get(frame.frameId); context.trace('response', { httpStatus: 200, body, duplicate: true }); return body; }
        if (context.server.terminal) throw requestError('VinRecognitionSessionNotFound', 'sessionId');
        const errors = { 'frame-in-progress': 'VinRecognitionFrameInProgress', 'frame-too-early': 'VinRecognitionFrameTooEarly', forbidden: 'VinRecognitionForbidden', 'not-found': 'VinRecognitionSessionNotFound', 'image-invalid': 'VinRecognitionImageInvalid', 'image-too-large': 'VinRecognitionImageTooLarge' };
        if (errors[context.scenario] && !context.server.errorSent) { context.server.errorSent = true; throw requestError(errors[context.scenario]); }
        if (context.scenario === 'http-error') { const error = namedError('MockHttpError'); error.httpStatus = 503; throw error; }
        const index = context.server.cache.size;
        const sequence = ['Searching', 'NeedBetterFrame', 'Candidate', 'Recognized'];
        let status = sequence[Math.min(index, sequence.length - 1)];
        if (context.scenario === 'no-vin') status = 'NoVin';
        if (context.scenario === 'limit') status = 'LimitExceeded';
        if (context.scenario === 'provider') status = 'ProviderUnavailable';
        if (context.scenario === 'deadline-extension') status = 'Searching';
        const terminal = !['Searching', 'NeedBetterFrame', 'Candidate'].includes(status);
        body = { sessionId: context.id, frameId: frame.frameId, status, terminal, vin: status === 'Recognized' ? TEST_VIN : null, remainingMs: context.scenario === 'deadline-extension' ? 600000 : remaining(context), nextCaptureAfterMs: !terminal && context.scenario === 'server-wait' ? (context.fast ? 30 : 1500) : null, reasonCode: null };
        context.server.cache.set(frame.frameId, body); context.server.status = status; context.server.terminal = terminal;
      }
      context.trace('response', { httpStatus: 200, body });
      return body;
    } catch (error) {
      if (error.name !== 'AbortError') context.trace('response', { httpStatus: error.httpStatus || null, body: error.body || null, simulation: true });
      throw error;
    } finally { if (operation === 'frame') { context.inFlight--; context.metrics(context); } }
  }

  function mockCancel(context) {
    virtualOperations++;
    if (context.cancelDispatched) return;
    context.cancelDispatched = true;
    if (context.server && !context.server.terminal) { context.server.status = 'Cancelled'; context.server.terminal = true; }
    context.trace('request', { method: 'DELETE', url: BASE + '/sessions/' + context.id, body: null, fireAndForget: true, operation: 'delete' });
    context.trace('response', { httpStatus: 200, body: null, operation: 'delete' });
  }

  async function runSession(context, options) {
    const armDeadline = () => { clearTimeout(context.timer); context.timer = setTimeout(() => { context.expired = true; context.controller.abort(); }, Math.max(0, context.deadline - performance.now())); };
    const tightenDeadline = milliseconds => { if (milliseconds !== null && Number.isFinite(milliseconds)) { context.deadline = Math.min(context.deadline, performance.now() + Math.max(0, milliseconds)); armDeadline(); } };
    const finish = (status, extra = {}) => { context.status = status; if (context.server && !['RequestRejected', 'LocalPreparationError'].includes(status)) { context.server.status = status; context.server.terminal = true; } return { ...attemptSummary(context), status, ...extra }; };
    armDeadline();
    try {
      options.state('Searching', 'Создание серверной сессии симулируется локально.');
      const session = await mockOperation(context, 'create');
      tightenDeadline(session.remainingMs);
      ensureActive(context);
      if (session.terminal) return finish(session.status);
      let nextCaptureAt = performance.now();
      while (true) {
        ensureActive(context);
        await sleep(Math.max(0, nextCaptureAt - performance.now()), context.controller.signal);
        ensureActive(context);
        const captureAt = performance.now();
        const frame = await abortable(options.capture(context.settings), context.controller.signal);
        ensureActive(context);
        context.frames++; context.metrics(context);
        let response;
        try { response = await mockOperation(context, 'frame', frame); }
        catch (error) {
          if (error.httpStatus === 400 && ['VinRecognitionFrameInProgress', 'VinRecognitionFrameTooEarly'].includes(error.code)) {
            context.recoveries++;
            options.state('Searching', 'Обработан ожидаемый ' + error.code + ': пауза, затем новый свежий кадр.');
            nextCaptureAt = performance.now() + context.settings.captureIntervalMs;
            continue;
          }
          throw error;
        }
        ensureActive(context);
        tightenDeadline(response.remainingMs);
        ensureActive(context);
        if (response.sessionId !== context.id || response.frameId !== frame.frameId) return finish('ProviderUnavailable', { reason: 'Неверная корреляция ответа.' });
        options.state(response.status, response.status === 'Candidate' ? 'Кандидат ещё не подтверждён; поле VIN не меняется.' : 'Ответ получен только в памяти страницы.');
        if (response.terminal) {
          if (response.status === 'Recognized') {
            if (typeof response.vin !== 'string' || !/^[A-HJ-NPR-Z0-9]{17}$/.test(response.vin)) return finish('ProviderUnavailable', { reason: 'Некорректный формат VIN.' });
            if (options.canApply()) { options.apply(response.vin); context.applied = true; }
            return finish('Recognized', { applied: context.applied });
          }
          return finish(response.status);
        }
        nextCaptureAt = Math.max(captureAt + context.settings.captureIntervalMs, performance.now() + (response.nextCaptureAfterMs === null ? 0 : response.nextCaptureAfterMs));
      }
    } catch (error) {
      if (context.controller.signal.aborted || error.name === 'AbortError') return finish(context.expired || performance.now() >= context.deadline ? 'TimedOut' : 'Cancelled');
      if (error.httpStatus === 400 && ['VinRecognitionForbidden', 'VinRecognitionSessionNotFound', 'VinRecognitionImageInvalid', 'VinRecognitionImageTooLarge'].includes(error.code)) return finish('RequestRejected', { errorCode: error.code });
      if (['ImageBudgetError', 'JpegError', 'FrameError', 'UuidError', 'MultipartError'].includes(error.name)) return finish('LocalPreparationError', { errorName: error.name });
      return finish('ProviderUnavailable');
    } finally {
      clearTimeout(context.timer);
      context.done = true;
      context.controller.abort();
      mockCancel(context);
    }
  }

  function showSession(status, message) { elements.sessionState.textContent = status; elements.sessionMessage.textContent = message; }
  function showMetrics(context) { elements.frameCount.textContent = String(context.frames); elements.parallelCount.textContent = String(context.maxInFlight); elements.queueCount.textContent = String(context.queue); }
  function showTrace(kind, payload) {
    if (payload.operation !== 'delete') elements[kind === 'request' ? 'requestView' : 'responseView'].textContent = JSON.stringify(payload, null, 2);
    if (kind === 'request') log('Мок: ' + payload.method + ' ' + payload.url.replace(BASE, '/vin-recognition') + (payload.fireAndForget ? ' (без ожидания).' : '.'), 'simulation');
    else if (payload.body && payload.body.status) log('Ответ мока: HTTP ' + payload.httpStatus + ', ' + payload.body.status + '.', 'simulation');
    else if (payload.httpStatus >= 400) log('Ответ мока: HTTP ' + payload.httpStatus + (payload.body?.errors?.[0]?.errorCode ? ', ' + payload.body.errors[0].errorCode : '') + '.', 'simulation');
  }

  async function startScenario() {
    if (activeSession || selfTesting || cameraPending || captureBusy) return false;
    let configuration;
    try { configuration = readSettings(); } catch (error) { showSession('Параметры не приняты', errorInfo(error).message); return false; }
    const profile = elements.configSelect.value;
    virtualOperations++;
    const config = { allowed: profile !== 'forbidden', enabled: profile !== 'disabled', available: profile !== 'unavailable', settings: cloneSettings(configuration.settings) };
    showTrace('request', { method: 'GET', url: BASE + '/config', body: null });
    showTrace('response', { httpStatus: profile === 'error' ? null : 200, body: profile === 'error' ? null : config });
    if (profile !== 'allowed') {
      const messages = { forbidden: 'allowed=false: сканер должен быть скрыт, ручной ввод доступен.', disabled: 'enabled=false: сканер недоступен с объяснением.', unavailable: 'available=false: сервис временно недоступен, ручной ввод доступен.', error: 'config не ответил: сканер скрыт, основной поиск не блокируется.' };
      showSession('Попытка не начата', messages[profile]);
      stopCamera('Симуляция недоступных настроек');
      return false;
    }
    const source = elements.sourceSelect.value;
    if (source === 'camera' && (!stream || !stream.getVideoTracks().some(track => track.readyState === 'live'))) { showSession('Нужна камера', 'Сначала нажмите «Открыть камеру» или выберите синтетический источник для проверки только логики.'); return false; }
    if (source === 'synthetic' && stream) stopCamera('Выбран синтетический источник');
    let context;
    try { context = makeContext(configuration.settings, elements.scenarioSelect.value, configuration.delay, { source, revision: vinRevision, trace: (kind, payload) => { if (activeSession === context) showTrace(kind, payload); }, metrics: context => { if (activeSession === context) showMetrics(context); } }); }
    catch (error) { showSession('Симуляция недоступна', errorInfo(error).message); return false; }
    activeSession = context;
    lastAttemptOwner = context;
    showMetrics(context);
    elements.progressFill.style.width = '0%';
    const updateTime = () => { if (activeSession !== context) return; const elapsed = performance.now() - context.startedAt; const left = Math.max(0, context.deadline - performance.now()); elements.timerText.textContent = 'Прошло ' + (elapsed / 1000).toFixed(1) + ' с · осталось ' + (left / 1000).toFixed(1) + ' с. Ответы не продлевают дедлайн.'; elements.progressFill.style.width = Math.min(100, elapsed / (context.settings.sessionTimeoutSeconds * 1000) * 100) + '%'; };
    clearInterval(progressTimer); progressTimer = setInterval(updateTime, 150); updateTime();
    elements.vinNote.textContent = 'Только синтетический результат. Ручное изменение поля во время попытки запрещает последующую подстановку.';
    log('Запущена ' + (source === 'camera' ? 'попытка с реальной камерой' : 'проверка с синтетическим источником') + '. Сценарий: ' + context.scenario + '.', 'simulation');
    updateControls();
    const result = await runSession(context, {
      state: (status, message) => { if (activeSession === context) showSession(status, message); },
      capture: settings => prepareFrame(source, settings, () => activeSession === context && !context.controller.signal.aborted),
      canApply: () => canApplyResult(context, activeSession, vinRevision),
      apply: value => { elements.vinInput.value = value; elements.vinNote.textContent = 'Подставлен синтетический VIN. Проверьте возможность его ручного изменения; реального поиска нет.'; }
    });
    if (activeSession !== context) { if (lastAttemptOwner === context) lastAttempt = result; return true; }
    lastAttempt = result;
    activeSession = null;
    clearInterval(progressTimer); progressTimer = null;
    const explanations = { Recognized: result.applied ? 'Синтетический VIN подставлен один раз. Поиск не запускается.' : 'Результат проигнорирован: поле изменено вручную или попытка уже не актуальна.', NoVin: 'Ожидаемый ответ мока: в документе нет VIN. Поле не изменено.', TimedOut: 'Общий дедлайн остановил попытку. Новых кадров и подстановок нет.', LimitExceeded: 'Ожидаемый ответ мока: лимит исчерпан. Доступен ручной ввод.', Disabled: 'Ожидаемый ответ мока: функция отключена. Кадры больше не снимаются.', ProviderUnavailable: 'Симулированный сервис недоступен. Это не неисправность камеры телефона.', Cancelled: 'Попытка отменена. Поздние ответы игнорируются.', RequestRejected: 'Обработан ожидаемый HTTP 400: ' + result.errorCode + '. Поле не изменено.', LocalPreparationError: errorInfo({ name: result.errorName }).message };
    showSession(result.status, explanations[result.status] || 'Сценарий завершён.');
    elements.timerText.textContent = 'Попытка завершена за ' + (result.elapsedMs / 1000).toFixed(2) + ' с. Для повтора нужен явный запуск.';
    showMetrics(context);
    stopCamera('Завершение сценария ' + result.status);
    log('Симуляция завершена: ' + result.status + '; кадров ' + result.frames + ', максимум одновременно ' + result.maxInFlight + ', очередь ' + result.queue + '.', 'simulation');
    updateControls();
    return true;
  }

  async function runSelfTests() {
    if (selfTesting || activeSession || cameraPending || captureBusy) return;
    stopCamera('Самопроверка логики');
    selfTesting = true; selfTestCancelled = false; selfTestContexts.clear(); selfTestResults = []; elements.selfTestResults.replaceChildren(statusNode('running')); updateControls();
    const settings = { captureIntervalMs: 8, sessionTimeoutSeconds: 1.2, image: { maxDimension: 640, jpegQuality: 0.6, maxBytes: 1500000 } };
    const add = (name, pass, detail, elapsedMs) => { selfTestResults.push({ name, pass, detail, elapsedMs }); const row = node('div', 'check'); const top = node('div', 'check-top'); top.append(node('span', 'check-name', name), statusNode(pass === null ? 'untested' : pass ? 'pass' : 'fail')); row.append(top, node('p', 'check-detail', detail)); if (selfTestResults.length === 1) elements.selfTestResults.replaceChildren(row); else elements.selfTestResults.append(row); };
    const test = async (name, action) => { if (selfTestCancelled) throw namedError('SuiteCancelled'); const started = performance.now(); try { const detail = await action(); if (selfTestCancelled) throw namedError('SuiteCancelled'); add(name, true, detail || 'Ожидаемое поведение подтверждено.', Math.round(performance.now() - started)); } catch (error) { if (selfTestCancelled) throw namedError('SuiteCancelled'); add(name, false, 'Проверка не пройдена: ' + (error.testDetail || errorInfo(error).name) + '.', Math.round(performance.now() - started)); } };
    const assert = (condition, detail) => { if (!condition) { const error = namedError('AssertionError'); error.testDetail = detail; throw error; } };
    const run = async (scenario, overrides = {}) => {
      const context = makeContext(overrides.settings || settings, scenario, 2, { source: 'synthetic', fast: true });
      let applications = 0;
      const result = await runSession(context, { state: () => {}, capture: actual => prepareFrame('synthetic', actual, false), canApply: () => overrides.canApply !== false, apply: () => { applications++; } });
      return { context, result, applications };
    };
    try {
      await test('Синтетический JPEG и multipart', async () => { const frame = await prepareFrame('synthetic', settings, false); assert(frame.blob.type === 'image/jpeg' && frame.metrics.multipartBytes > frame.blob.size, 'JPEG или multipart не сформирован'); return 'Реальные Canvas.toBlob и сериализация FormData выполнены на синтетическом рисунке.'; });
      await test('Успех и однократная подстановка', async () => { const { result, applications } = await run('success'); assert(result.status === 'Recognized' && result.frames === 4 && applications === 1, 'Неверная последовательность или число подстановок'); return 'Searching → NeedBetterFrame → Candidate → Recognized; подстановка ровно один раз.'; });
      for (const [scenario, expected] of [['no-vin', 'NoVin'], ['limit', 'LimitExceeded'], ['disabled', 'Disabled'], ['provider', 'ProviderUnavailable'], ['http-error', 'ProviderUnavailable']]) await test('Терминальное состояние: ' + scenario, async () => { const { result, applications } = await run(scenario); assert(result.status === expected && applications === 0 && (scenario !== 'disabled' || result.frames === 0), 'Неверный терминальный исход'); });
      for (const scenario of ['frame-in-progress', 'frame-too-early']) await test('Восстановление после 400: ' + scenario, async () => { const { result } = await run(scenario); assert(result.status === 'Recognized' && result.recoveries === 1 && result.frames === 5, 'Не отправлен следующий свежий кадр'); });
      for (const scenario of ['forbidden', 'not-found', 'image-invalid', 'image-too-large']) await test('Завершение после 400: ' + scenario, async () => { const { result, applications } = await run(scenario); assert(result.status === 'RequestRejected' && result.frames === 1 && applications === 0, 'Попытка не завершена после ошибки запроса'); });
      await test('Медленный ответ и отсутствие очереди', async () => { const { result } = await run('slow'); assert(result.status === 'Recognized' && result.maxInFlight === 1 && result.finalInFlight === 0 && result.queue === 0, 'Нарушено ограничение параллелизма'); return 'Максимум один кадр в обработке, очередь 0, после завершения активных запросов 0.'; });
      await test('nextCaptureAfterMs', async () => { const { result } = await run('server-wait'); assert(result.status === 'Recognized' && result.elapsedMs >= 85, 'Пауза сервера проигнорирована'); });
      for (const scenario of ['timeout', 'deadline-extension']) await test('Дедлайн: ' + scenario, async () => { const short = cloneSettings(settings); short.sessionTimeoutSeconds = 0.12; const { result, applications } = await run(scenario, { settings: short }); assert(result.status === 'TimedOut' && result.elapsedMs < 700 && applications === 0 && result.finalInFlight === 0, 'Дедлайн продлён или запрос остался активным'); return 'Локальный дедлайн соблюдён, даже если ответ предлагает больший remainingMs.'; });
      await test('Дедлайн без готовых кадров', async () => { const short = cloneSettings(settings); short.sessionTimeoutSeconds = 0.08; const context = makeContext(short, 'success', 0, { fast: true }); const result = await runSession(context, { state: () => {}, capture: () => new Promise(() => {}), canApply: () => true, apply: () => { throw namedError('UnexpectedApply'); } }); assert(result.status === 'TimedOut' && result.frames === 0 && result.elapsedMs < 700, 'Зависшая подготовка кадра заблокировала дедлайн'); return 'Попытка завершилась независимо от неответившей подготовки кадра; отправленных кадров 0.'; });
      await test('Защита ручного ввода', async () => { const { result, applications } = await run('success', { canApply: false }); assert(result.status === 'Recognized' && !result.applied && applications === 0, 'Защита ввода не сработала'); });
      await test('Отмена во время ответа', async () => { const context = makeContext(settings, 'slow', 2, { fast: true }); const timer = setTimeout(() => context.controller.abort(), 20); try { const result = await runSession(context, { state: () => {}, capture: actual => prepareFrame('synthetic', actual, false), canApply: () => true, apply: () => { throw namedError('UnexpectedApply'); } }); assert(result.status === 'Cancelled' && result.finalInFlight === 0, 'Отмена не освободила обработчик'); } finally { clearTimeout(timer); } });
      await test('Идемпотентность одного frameId', async () => { const context = makeContext(settings, 'success', 0, { fast: true }); try { await mockOperation(context, 'create'); const frame = await prepareFrame('synthetic', settings, false); const first = await mockOperation(context, 'frame', frame); const repeated = await mockOperation(context, 'frame', frame); assert(first === repeated && context.server.cache.size === 1, 'Повтор засчитан новым подтверждением'); context.server.status = 'Recognized'; context.server.terminal = true; mockCancel(context); assert(context.server.status === 'Recognized', 'DELETE переписал терминальный успех'); } finally { context.controller.abort(); } });
      await test('Поздний ответ и новая попытка', async () => { const old = makeContext(settings, 'success', 0); const current = makeContext(settings, 'success', 0); try { assert(!canApplyResult(old, current, 0), 'Принят ответ предыдущей сессии'); old.controller.abort(); assert(!canApplyResult(old, old, 0), 'Принят ответ отменённой сессии'); assert(!canApplyResult(current, current, 1), 'Проигнорирована ревизия ввода'); current.deadline = performance.now() - 1; assert(!canApplyResult(current, current, 0), 'Принят просроченный ответ'); } finally { old.controller.abort(); current.controller.abort(); } });
      await test('Повторный старт заблокирован', async () => { const started = await startScenario(); assert(started === false && activeSession === null, 'Вторая попытка запустилась во время другого прогона'); });
    } catch (error) { if (error.name === 'SuiteCancelled') add('Самопроверка остановлена', null, 'Оставшиеся сценарии не выполнялись. Для нового прогона нажмите кнопку самостоятельно.', 0); else add('Возможность выполнить самопроверку', false, errorInfo(error).message, 0); }
    finally { for (const context of selfTestContexts) context.controller.abort(); selfTestContexts.clear(); selfTesting = false; updateControls(); const passed = selfTestResults.filter(result => result.pass).length; log('Синтетическая самопроверка: ' + passed + '/' + selfTestResults.length + (selfTestCancelled ? ', прервана' : '') + '. Возможности реальной камеры этим не подтверждаются.', 'self-test'); }
  }

  function buildReport() { return JSON.stringify(reportProvider(), null, 2); }

  function showReport() { const text = buildReport(); elements.reportText.value = text; elements.reportArea.hidden = false; return text; }
  async function copyReport() {
    const text = showReport();
    try { if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') throw namedError('ClipboardUnavailable'); await navigator.clipboard.writeText(text); elements.exportNotice.textContent = 'Отчёт скопирован. Изображений и введённого VIN в нём нет.'; }
    catch { elements.reportText.focus(); elements.reportText.select(); elements.reportText.setSelectionRange(0, text.length); elements.exportNotice.textContent = 'Буфер обмена недоступен в этом способе запуска. Текст выделен — скопируйте его вручную.'; }
  }

  function downloadReport() {
    const text = buildReport();
    try { if (exportUrl) URL.revokeObjectURL(exportUrl); exportUrl = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' })); const anchor = document.createElement('a'); anchor.href = exportUrl; anchor.download = 'vin-device-diagnostics-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json'; document.body.append(anchor); anchor.click(); anchor.remove(); elements.exportNotice.textContent = 'Браузеру передана команда скачать JSON. Если просмотрщик не поддерживает скачивание, используйте копирование текста.'; }
    catch { showReport(); elements.exportNotice.textContent = 'Скачивание недоступно. Скопируйте показанный текст отчёта вручную.'; }
  }

  function inspectEnvironment() {
    Object.assign(environment, { ...launchDetails(), secureContext: window.isSecureContext === true, userAgent: navigator.userAgent, language: navigator.language, viewport: { width: innerWidth, height: innerHeight, devicePixelRatio: window.devicePixelRatio || 1 }, topLevel: window === window.top, onlineFlag: navigator.onLine, note: 'navigator.onLine is informational; no network probe is performed.' });
    elements.environmentInfo.textContent = location.protocol + ' · ' + (window.isSecureContext ? 'безопасный контекст' : 'небезопасный контекст') + ' · ' + innerWidth + '×' + innerHeight + ' CSS px. Доступность сети не проверяется.';
    elements.environmentTag.textContent = location.protocol === 'content:' ? 'Открыто из Android-вложения' : window.isSecureContext ? 'Безопасный контекст' : 'Контекст ограничен';
    elements.environmentTag.className = 'status ' + (location.protocol === 'content:' ? 'manual' : window.isSecureContext ? 'pass' : 'blocked');
    setCheck('javascript', 'pass', 'JavaScript выполняется. Ресурсы OCR загружаются только со своего HTTPS-стенда.');
    setCheck('secure', window.isSecureContext ? 'pass' : 'blocked', window.isSecureContext ? 'Браузер считает этот документ безопасным контекстом. Это ещё не разрешение камеры.' : 'Браузер не считает этот способ открытия безопасным. Камера и UUID могут быть заблокированы.');
    setCheck('launch', location.protocol === 'content:' ? 'manual' : 'pass', location.protocol === 'content:' ? 'Android открыл вложение через content://. API может присутствовать, но запрос камеры может быть отклонён без диалога даже в Chrome. Проверьте реальный поток; инструкции находятся под превью.' : 'Схема ' + location.protocol + '; origin: ' + environment.documentOrigin + '. Допустимость запроса камеры подтверждается только реальным потоком.', launchDetails());
    const media = navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function';
    setCheck('media', media ? 'pass' : 'blocked', media ? 'navigator.mediaDevices.getUserMedia доступен. Реальное разрешение проверяется по кнопке.' : 'API камеры отсутствует в этом просмотрщике или контексте; наличие аппаратной камеры не проверено.');
    const canvas = document.createElement('canvas');
    const canvasReady = !!canvas.getContext('2d') && typeof canvas.toBlob === 'function';
    setCheck('canvas', canvasReady ? 'pass' : 'fail', canvasReady ? 'Canvas 2D и toBlob доступны; реальный кадр проверяется отдельно.' : 'Нет Canvas 2D или toBlob.');
    try { const value = uuid(); if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw namedError('UuidError'); setCheck('uuid', 'pass', 'crypto.randomUUID реально создал UUID v4. Идентификатор не записан в отчёт.'); }
    catch { setCheck('uuid', 'blocked', 'crypto.randomUUID отсутствует или заблокирован. Небезопасной подмены UUID нет.'); }
    const clock = typeof performance !== 'undefined' && typeof performance.now === 'function';
    const firstTick = clock ? performance.now() : null;
    const monotonic = clock && performance.now() >= firstTick;
    setCheck('clock', monotonic ? 'pass' : 'fail', monotonic ? 'performance.now доступен; фактический дедлайн проверяется в симуляции.' : 'Монотонный таймер недоступен.');
    setCheck('abort', typeof AbortController === 'function' ? 'pass' : 'fail', typeof AbortController === 'function' ? 'AbortController доступен; прерывание ожидания проверяется в самотесте.' : 'AbortController отсутствует; симуляцию с отменой выполнить нельзя.');
    if (location.protocol === 'content:') { elements.environmentNotice.hidden = false; elements.environmentNotice.textContent = 'Файл открыт как Android-вложение content://. Даже если вы видите Chrome, безопасный контекст и API камеры, запрос разрешения может быть заблокирован для источника документа. Это не проверка камеры с обычного сайта. Инструкции находятся под превью; принудительно разрешить доступ из HTML нельзя.'; }
    else if (!media || !window.isSecureContext) { elements.environmentNotice.hidden = false; elements.environmentNotice.textContent = 'Способ открытия может ограничивать камеру. Это не вывод о неисправности телефона. Если файл открыт как вложение или предпросмотр, откройте его в полноценном браузере. Обойти ограничения просмотрщика из этого файла нельзя.'; }
    setCheck('lifecycle', 'manual', 'Нужно реально свернуть страницу с включённой камерой. Наличие обработчика не считается успешной проверкой.');
  }

  function init() {
    for (const element of document.querySelectorAll('[id]')) elements[element.id] = element;
    for (const [id, name, optional] of checkDefinitions) checks.set(id, { id, name, optional, status: 'untested', detail: 'Ещё не выполнялось.', values: null, updatedAt: null });
    renderManual();
    elements.cameraButton.addEventListener('click', () => { if (!stream) openCamera(); });
    elements.stopButton.addEventListener('click', () => cancelCurrent('Остановлено пользователем'));
    elements.captureButton.addEventListener('click', captureOnce);
    elements.cameraSelect.addEventListener('change', () => { const id = elements.cameraSelect.value; stopCamera('Смена камеры'); openCamera(id); });
    elements.focusButton.addEventListener('click', () => applyCameraSetting('focusMode', cameraCapabilities.focusMode.includes('continuous') ? 'continuous' : 'auto'));
    elements.torchButton.addEventListener('click', () => applyCameraSetting('torch', !torchEnabled));
    elements.zoomInput.addEventListener('change', () => applyCameraSetting('zoom', Number(elements.zoomInput.value)));
    elements.runButton.addEventListener('click', startScenario);
    elements.manualButton.addEventListener('click', () => { cancelCurrent('Переход к ручному вводу'); elements.vinInput.focus(); });
    elements.vinInput.addEventListener('input', () => { vinRevision++; if (elements.vinInput.value) privateValues.add(elements.vinInput.value); if (activeSession) elements.vinNote.textContent = 'Поле изменено вручную: результат текущей попытки больше не будет подставлен.'; });
    elements.sourceSelect.addEventListener('change', () => { elements.sourceNotice.textContent = elements.sourceSelect.value === 'synthetic' ? 'Выбран синтетический рисунок. Камера и телефон этим прогоном не проверяются; JPEG и multipart формируются настоящими браузерными API.' : 'Будет использован реальный кадр камеры. Ответы и итоговый VIN остаются синтетическими.'; });
    elements.selfTestButton.addEventListener('click', runSelfTests);
    elements.manualChecks.addEventListener('click', event => { const button = event.target.closest('button[data-manual]'); if (!button) return; manualResults.set(button.dataset.manual, button.dataset.result); renderManual(); log('Ручная проверка ' + button.dataset.manual + ': ' + statuses[button.dataset.result] + '.'); });
    elements.copyButton.addEventListener('click', copyReport);
    elements.downloadButton.addEventListener('click', downloadReport);
    elements.showReportButton.addEventListener('click', showReport);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { const hadWork = !!stream || cameraPending || !!activeSession; cancelCurrent('Страница скрыта'); if (hadWork) { setCheck('lifecycle', 'pass', 'Получен реальный visibilitychange → hidden. Поток и попытка остановлены; системный индикатор проверьте вручную.', { event: 'visibilitychange', visibility: 'hidden' }); log('Страница скрыта; автоматического возобновления не будет.'); } }
      else log('Страница снова видима. Камера не запускается автоматически.');
    });
    window.addEventListener('pagehide', () => { cancelCurrent('Уход со страницы'); if (photoUrl) { URL.revokeObjectURL(photoUrl); photoUrl = null; elements.cropImage.removeAttribute('src'); elements.thumbnail.hidden = true; } if (exportUrl) { URL.revokeObjectURL(exportUrl); exportUrl = null; } });
    window.addEventListener('resize', () => { environment.viewport = { width: innerWidth, height: innerHeight, devicePixelRatio: window.devicePixelRatio || 1 }; });
    window.addEventListener('error', event => { log('Необработанная ошибка JavaScript: ' + (event.error?.name || 'Error') + '.'); elements.environmentNotice.hidden = false; elements.environmentNotice.textContent = 'Выполнение одной из проверок завершилось ошибкой JavaScript. Сохраните отчёт; успешный итог для этой проверки не подтверждён.'; });
    window.addEventListener('unhandledrejection', event => { log('Необработанное завершение операции: ' + errorInfo(event.reason).name + '.'); });
    for (const id of ['vinInput', 'copyButton', 'downloadButton', 'showReportButton']) elements[id].disabled = false;
    inspectEnvironment();
    inspectCameraPermissions();
    updateControls();
    elements.bootWarning.hidden = true;
    log('Диагностика запущена. Кадры не отправляются; OCR-ресурсы загружаются со стенда.');
  }

  return {
    init, readSettings, openCamera, prepareFrame, runSelfTests,
    stop: cancelCurrent,
    setExternalBusy(value) { externalBusy = value; updateControls(); },
    isLive: () => !!stream && stream.getVideoTracks().some(track => track.readyState === 'live'),
    revision: () => vinRevision,
    applyVin(value, revision) {
      if (vinRevision !== revision) return false;
      privateValues.add(value); elements.vinInput.value = value;
      elements.vinNote.textContent = 'Результат локального OCR. Проверьте VIN; поиск не запускается автоматически.';
      return true;
    },
    snapshot: () => ({ environment, checks: [...checks.values()], manual: [...manualResults], selfTests: selfTestResults, events, lastAttempt, photoMetrics, virtualOperations }),
    redact,
  };
}
