(() => {
  "use strict";

  const LEVELS = Object.freeze([
    { id: 1, name: "ПЕРИМЕТР", length: 4, alphabet: "0123456789", attempts: 8 },
    { id: 2, name: "АДМИН-ПАНЕЛЬ", length: 4, alphabet: "0123456789ABCDEF", attempts: 8 },
    { id: 3, name: "ЯДРО", length: 5, alphabet: "0123456789ABCDEF", attempts: 9 },
    { id: 4, name: "АРХИВ", length: 6, alphabet: "0123456789ABCDEF", attempts: 10 },
    { id: 5, name: "КОРЕНЬ", length: 6, alphabet: "0123456789ABCDEF", attempts: 9 }
  ]);

  const BEST_KEY = "root-access.best.v1";
  const SOUND_KEY = "root-access.sound.v1";
  const MAX_LEVEL = LEVELS.length;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const dom = {
    startScreen: document.getElementById("start-screen"),
    gameScreen: document.getElementById("game-screen"),
    startBtn: document.getElementById("start-btn"),
    howBtn: document.getElementById("how-btn"),
    bestStart: document.getElementById("best-start"),
    brandBtn: document.getElementById("brand-btn"),
    soundToggle: document.getElementById("sound-toggle"),
    levelNum: document.getElementById("level-num"),
    levelName: document.getElementById("level-name"),
    score: document.getElementById("score"),
    attemptsLabel: document.getElementById("attempts-label"),
    traceMeter: document.getElementById("trace-meter"),
    terminalPanel: document.getElementById("terminal-panel"),
    statusLine: document.getElementById("status-line"),
    codeSlots: document.getElementById("code-slots"),
    hintSlot: document.getElementById("hint-slot"),
    message: document.getElementById("message"),
    keypad: document.getElementById("keypad"),
    scanBtn: document.getElementById("scan-btn"),
    backBtn: document.getElementById("back-btn"),
    enterBtn: document.getElementById("enter-btn"),
    log: document.getElementById("log"),
    logCount: document.getElementById("log-count"),
    restartBtn: document.getElementById("restart-btn"),
    modal: document.getElementById("modal"),
    modalKicker: document.getElementById("modal-kicker"),
    modalTitle: document.getElementById("modal-title"),
    modalText: document.getElementById("modal-text"),
    modalCode: document.getElementById("modal-code"),
    modalPrimary: document.getElementById("modal-primary"),
    modalSecondary: document.getElementById("modal-secondary"),
    copyBtn: document.getElementById("copy-btn"),
    howModal: document.getElementById("how-modal"),
    howClose: document.getElementById("how-close"),
    toast: document.getElementById("toast")
  };

  let state = null;
  let best = loadBest();
  let audioEnabled = loadSound();
  let audioCtx = null;
  let activeDialog = null;
  let lastFocused = null;
  let resultTimer = null;
  let toastTimer = null;
  let modalPrimaryHandler = null;
  let modalSecondaryHandler = null;
  let lastRunText = "";

  init();

  function init() {
    dom.bestStart.textContent = formatScore(best);
    renderSound();
    bindEvents();
  }

  function bindEvents() {
    dom.startBtn.addEventListener("click", startGame);
    dom.howBtn.addEventListener("click", openHow);
    dom.howClose.addEventListener("click", () => closeDialog(dom.howModal));
    dom.brandBtn.addEventListener("click", showStart);
    dom.soundToggle.addEventListener("click", toggleSound);
    dom.scanBtn.addEventListener("click", useScan);
    dom.backBtn.addEventListener("click", removeSymbol);
    dom.enterBtn.addEventListener("click", submitGuess);
    dom.restartBtn.addEventListener("click", restartLevel);
    dom.modalPrimary.addEventListener("click", () => modalPrimaryHandler?.());
    dom.modalSecondary.addEventListener("click", () => modalSecondaryHandler?.());
    dom.copyBtn.addEventListener("click", copyFinalResult);
    dom.keypad.addEventListener("click", (event) => {
      const key = event.target.closest(".key");
      if (!key || key.disabled) return;
      addSymbol(key.dataset.symbol);
    });
    dom.howModal.addEventListener("click", (event) => {
      if (event.target === dom.howModal) closeDialog(dom.howModal);
    });
    document.addEventListener("keydown", onGlobalKeydown);
  }

  function onGlobalKeydown(event) {
    if (activeDialog) {
      if (event.key === "Tab") {
        trapFocus(event);
        return;
      }
      if (event.key === "Escape" && activeDialog === dom.howModal) {
        event.preventDefault();
        closeDialog(dom.howModal);
        return;
      }
      if (event.key === "Enter" && !isInteractiveTarget(event.target)) {
        event.preventDefault();
        const action = activeDialog.querySelector(".btn--primary") || activeDialog.querySelector("button:not([disabled])");
        action?.click();
      }
      return;
    }

    const gameOpen = !dom.gameScreen.classList.contains("hidden");

    if (!gameOpen) {
      if (event.key === "Enter" && !event.repeat && !isInteractiveTarget(event.target)) {
        event.preventDefault();
        startGame();
      }
      return;
    }

    if (!state || state.completed) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    if (event.key === "Backspace") {
      event.preventDefault();
      removeSymbol();
      return;
    }

    if (event.key === "Enter") {
      if (event.target instanceof Element && event.target.closest(".key")) {
        event.preventDefault();
        submitGuess();
        return;
      }
      if (isInteractiveTarget(event.target)) return;
      event.preventDefault();
      submitGuess();
      return;
    }

    if (event.key.toLowerCase() === "s" || event.key.toLowerCase() === "ы") {
      event.preventDefault();
      useScan();
      return;
    }

    const symbol = eventToSymbol(event);
    if (symbol && LEVELS[state.levelIndex].alphabet.includes(symbol)) {
      event.preventDefault();
      addSymbol(symbol);
    }
  }

  function eventToSymbol(event) {
    if (/^[0-9a-f]$/i.test(event.key)) return event.key.toUpperCase();
    if (/^Digit[0-9]$/.test(event.code)) return event.code.slice(5);
    if (/^Numpad[0-9]$/.test(event.code)) return event.code.slice(6);
    if (/^Key[A-F]$/.test(event.code)) return event.code.slice(3);
    return null;
  }

  function isInteractiveTarget(target) {
    return target instanceof Element && Boolean(target.closest("button, a, input, select, textarea"));
  }

  function startGame() {
    clearTimeout(resultTimer);
    if (activeDialog) closeDialog(activeDialog);
    state = {
      levelIndex: 0,
      total: 0,
      code: "",
      guess: "",
      attemptsLeft: 0,
      history: [],
      scanUsed: false,
      scanPos: null,
      completed: false,
      won: false
    };
    dom.startScreen.classList.add("hidden");
    dom.gameScreen.classList.remove("hidden");
    startLevel(0);
  }

  function startLevel(index) {
    if (!state) {
      state = {
        levelIndex: index,
        total: 0,
        code: "",
        guess: "",
        attemptsLeft: 0,
        history: [],
        scanUsed: false,
        scanPos: null,
        completed: false,
        won: false
      };
    }

    clearTimeout(resultTimer);
    if (activeDialog) closeDialog(activeDialog);

    const level = LEVELS[index];
    state.levelIndex = index;
    state.code = generateCode(level);
    state.guess = "";
    state.attemptsLeft = level.attempts;
    state.history = [];
    state.scanUsed = false;
    state.scanPos = null;
    state.completed = false;
    state.won = false;

    dom.startScreen.classList.add("hidden");
    dom.gameScreen.classList.remove("hidden");
    dom.levelNum.textContent = String(index + 1).padStart(2, "0");
    dom.levelName.textContent = level.name;
    dom.statusLine.textContent = "ОЖИДАНИЕ КОДА";
    setMessage(`Введи код из ${level.length} уникальных символов.`);

    buildSlots(level.length);
    buildKeypad(level);
    renderAll();
    updateDocumentTitle();
    scrollTop();
    play("start");
  }

  function restartLevel() {
    if (!state) return;
    startLevel(state.levelIndex);
    showToast("СЕССИЯ ПЕРЕЗАПУЩЕНА");
  }

  function showStart() {
    clearTimeout(resultTimer);
    if (activeDialog) closeDialog(activeDialog);
    state = null;
    dom.gameScreen.classList.add("hidden");
    dom.startScreen.classList.remove("hidden");
    dom.bestStart.textContent = formatScore(best);
    document.title = "ROOT//ACCESS — ночной взлом сервера";
    scrollTop();
  }

  function buildSlots(count) {
    dom.codeSlots.replaceChildren();
    for (let index = 0; index < count; index += 1) {
      const slot = document.createElement("div");
      slot.className = "slot";
      slot.dataset.index = String(index);
      dom.codeSlots.appendChild(slot);
    }
  }

  function buildKeypad(level) {
    dom.keypad.replaceChildren();
    dom.keypad.classList.toggle("five-cols", level.alphabet.length === 10);
    for (const symbol of level.alphabet) {
      const key = document.createElement("button");
      key.type = "button";
      key.className = "key";
      key.dataset.symbol = symbol;
      key.textContent = symbol;
      dom.keypad.appendChild(key);
    }
  }

  function addSymbol(symbol) {
    if (!state || state.completed || state.attemptsLeft <= 0) return;
    const level = LEVELS[state.levelIndex];

    if (state.guess.length >= level.length) {
      setMessage("Код уже заполнен. Нажми ВВОД.", "warn");
      return;
    }

    if (state.guess.includes(symbol)) {
      setMessage("Символы не повторяются — выбери другой.", "warn");
      play("error");
      return;
    }

    state.guess += symbol;
    dom.statusLine.textContent = "ВВОД КОДА";
    play("key");
    renderAll();
  }

  function removeSymbol() {
    if (!state || state.completed || !state.guess.length) return;
    state.guess = state.guess.slice(0, -1);
    dom.statusLine.textContent = "ВВОД КОДА";
    play("back");
    renderAll();
  }

  function useScan() {
    if (!state || state.completed || state.attemptsLeft <= 0) return;
    if (state.scanUsed) {
      setMessage("Скан уже использован на этом уровне.", "warn");
      play("error");
      return;
    }

    state.scanUsed = true;
    state.scanPos = Math.floor(Math.random() * state.code.length);
    setMessage("Скан завершён. Бонус за чистый взлом снят.", "success");
    dom.statusLine.textContent = "СКАН ЗАВЕРШЁН";
    play("scan");
    renderAll();
  }

  function submitGuess() {
    if (!state || state.completed || state.attemptsLeft <= 0) return;
    const level = LEVELS[state.levelIndex];

    if (state.guess.length !== level.length) {
      setMessage(`Заполни все ${level.length} позиции.`, "error");
      play("error");
      return;
    }

    const evaluation = evaluate(state.guess, state.code);
    const won = evaluation.exact === level.length;
    state.attemptsLeft -= 1;
    const points = won ? calcPoints(level, state.attemptsLeft, state.scanUsed) : 0;

    state.history.push({
      no: state.history.length + 1,
      guess: state.guess,
      exact: evaluation.exact,
      partial: evaluation.partial,
      pegs: evaluation.pegs,
      points
    });

    state.completed = won || state.attemptsLeft <= 0;
    state.won = won;

    if (won) {
      state.total += points;
      dom.statusLine.textContent = "ДОСТУП РАЗРЕШЁН";
      setMessage(`Код верный. +${points} очков.`, "success");
      play("win");
      renderAll();
      updateDocumentTitle();

      const levelIndex = state.levelIndex;
      resultTimer = setTimeout(() => {
        if (!state || !state.completed || state.levelIndex !== levelIndex) return;
        if (levelIndex === MAX_LEVEL - 1) {
          showFinalResult();
        } else {
          showLevelWin(levelIndex, points);
        }
      }, reduceMotion ? 250 : 850);
      return;
    }

    state.guess = "";

    if (state.attemptsLeft <= 0) {
      dom.statusLine.textContent = "ДОСТУП ЗАБЛОКИРОВАН";
      setMessage(`Доступ заблокирован. Код был: ${spaced(state.code)}.`, "error");
      play("lose");
      shake();
      renderAll();

      const levelIndex = state.levelIndex;
      resultTimer = setTimeout(() => {
        if (!state || !state.completed || state.levelIndex !== levelIndex) return;
        showLevelLose(levelIndex);
      }, reduceMotion ? 250 : 900);
      return;
    }

    dom.statusLine.textContent = "ДОСТУП ОТКЛОНЁН";
    setMessage(
      `Система: ${evaluation.exact} на месте, ${evaluation.partial} не на месте. Осталось ${state.attemptsLeft} ${pluralAttemptsLower(state.attemptsLeft)}.`,
      "warn"
    );
    play("wrong");
    shake();
    renderAll();
  }

  function evaluate(guess, code) {
    let exact = 0;
    let partial = 0;
    const codeLeft = [];
    const guessLeft = [];

    for (let index = 0; index < code.length; index += 1) {
      if (guess[index] === code[index]) {
        exact += 1;
      } else {
        codeLeft.push(code[index]);
        guessLeft.push(guess[index]);
      }
    }

    for (const symbol of guessLeft) {
      const found = codeLeft.indexOf(symbol);
      if (found !== -1) {
        partial += 1;
        codeLeft.splice(found, 1);
      }
    }

    const miss = code.length - exact - partial;
    return {
      exact,
      partial,
      pegs: [
        ...Array(exact).fill("exact"),
        ...Array(partial).fill("partial"),
        ...Array(miss).fill("miss")
      ]
    };
  }

  function calcPoints(level, attemptsLeft, scanUsed) {
    const base = 60 + level.id * 30;
    const attemptBonus = Math.max(0, attemptsLeft) * 25;
    const scanBonus = scanUsed ? 0 : 50;
    const levelBonus = level.id * 25;
    return base + attemptBonus + scanBonus + levelBonus;
  }

  function generateCode(level) {
    const pool = [...level.alphabet];
    let code = "";
    for (let index = 0; index < level.length; index += 1) {
      const pick = Math.floor(Math.random() * pool.length);
      code += pool.splice(pick, 1)[0];
    }
    return code;
  }

  function renderAll() {
    if (!state) return;
    const level = LEVELS[state.levelIndex];
    renderSlots(level);
    renderKeypad(level);
    renderTrace(level);
    dom.score.textContent = formatScore(state.total);
    renderLog();
    renderHint();

    dom.backBtn.disabled = state.completed || !state.guess.length;
    dom.enterBtn.disabled = state.completed || state.attemptsLeft <= 0;
    dom.scanBtn.disabled = state.completed || state.scanUsed || state.attemptsLeft <= 0;
    dom.scanBtn.querySelector("span").textContent = state.scanUsed ? "ИСПОЛЬЗОВАН" : "+1 СИМВОЛ";
  }

  function renderSlots(level) {
    const slots = dom.codeSlots.children;
    for (let index = 0; index < slots.length; index += 1) {
      const slot = slots[index];
      const symbol = state.guess[index] || "";
      const active = !state.completed && index === state.guess.length && state.guess.length < level.length;

      slot.textContent = symbol;
      slot.classList.toggle("filled", Boolean(symbol));
      slot.classList.toggle("active", active);
      slot.classList.toggle("scanned", state.scanUsed && state.scanPos === index);
      slot.setAttribute("aria-label", `Позиция ${index + 1}: ${symbol || "пусто"}`);
    }
  }

  function renderKeypad(level) {
    const unavailable = state.completed || state.attemptsLeft <= 0;
    for (const key of dom.keypad.children) {
      const symbol = key.dataset.symbol;
      key.disabled = unavailable || state.guess.includes(symbol) || state.guess.length >= level.length;
    }
  }

  function renderTrace(level) {
    dom.attemptsLabel.textContent = `${state.attemptsLeft} ${pluralAttempts(state.attemptsLeft)}`;
    dom.traceMeter.replaceChildren();
    const used = level.attempts - state.attemptsLeft;

    for (let index = 0; index < level.attempts; index += 1) {
      const segment = document.createElement("i");
      segment.className = `trace-seg ${index < used ? "used" : "remaining"}`;
      dom.traceMeter.appendChild(segment);
    }
  }

  function renderLog() {
    dom.logCount.textContent = String(state.history.length).padStart(2, "0");

    if (!state.history.length) {
      const empty = document.createElement("p");
      empty.className = "log-empty";
      empty.textContent = "Журнал пуст. Первая попытка появится здесь.";
      dom.log.replaceChildren(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    [...state.history].reverse().forEach((item) => {
      const row = document.createElement("div");
      row.className = "log-row";

      const number = document.createElement("span");
      number.className = "log-num";
      number.textContent = String(item.no).padStart(2, "0");

      const main = document.createElement("div");
      main.className = "log-main";

      const guess = document.createElement("div");
      guess.className = "log-guess";
      guess.textContent = spaced(item.guess);

      const sub = document.createElement("div");
      sub.className = "log-sub";
      const pegs = document.createElement("div");
      pegs.className = "log-pegs";
      item.pegs.forEach((kind) => {
        const peg = document.createElement("i");
        peg.className = `peg ${kind}`;
        pegs.appendChild(peg);
      });
      sub.appendChild(pegs);
      main.append(guess, sub);

      const meta = document.createElement("div");
      meta.className = "log-meta";
      if (item.points > 0) {
        meta.append(document.createTextNode(`+${item.points}`), document.createElement("br"));
      }
      meta.append(document.createTextNode(`${item.exact}/${item.partial}`));

      row.append(number, main, meta);
      fragment.appendChild(row);
    });

    dom.log.replaceChildren(fragment);
  }

  function renderHint() {
    if (state.scanUsed && state.scanPos !== null) {
      dom.hintSlot.textContent = `СКАН: позиция ${state.scanPos + 1} — «${state.code[state.scanPos]}»`;
      dom.hintSlot.classList.remove("hidden");
    } else {
      dom.hintSlot.textContent = "";
      dom.hintSlot.classList.add("hidden");
    }
  }

  function showLevelWin(levelIndex, points) {
    const level = LEVELS[levelIndex];
    showResult({
      kicker: `УРОВЕНЬ ${String(levelIndex + 1).padStart(2, "0")} / 05 ПРОЙДЕН`,
      title: "ДОСТУП ПОЛУЧЕН",
      text: `Попыток: ${state.history.length} из ${level.attempts}. За уровень: +${points}. В копилке: ${state.total}.`,
      code: spaced(state.code),
      primaryLabel: "СЛЕДУЮЩИЙ СЕРВЕР →",
      onPrimary: () => startLevel(levelIndex + 1),
      secondaryLabel: "В МЕНЮ",
      onSecondary: showStart
    });
  }

  function showLevelLose(levelIndex) {
    const level = LEVELS[levelIndex];
    showResult({
      kicker: "СЛЕД ОБОРВАН",
      title: "ДОСТУП ЗАБЛОКИРОВАН",
      text: `Сервер ${level.name} сменил ключи. Попробуй этот уровень ещё раз или вернись в меню.`,
      code: spaced(state.code),
      primaryLabel: "ПОВТОРИТЬ СЕРВЕР",
      onPrimary: () => startLevel(levelIndex),
      secondaryLabel: "В МЕНЮ",
      onSecondary: showStart
    });
  }

  function showFinalResult() {
    const isRecord = state.total > best;
    if (isRecord) {
      best = state.total;
      saveBest(best);
    }
    dom.bestStart.textContent = formatScore(best);

    lastRunText = `ROOT//ACCESS\nСчёт: ${formatScore(state.total)}\nЛучший: ${formatScore(best)}\nСерверов: 5/5\n${new Date().toLocaleDateString("ru-RU")}`;

    showResult({
      kicker: "СЕССИЯ ЗАВЕРШЕНА",
      title: isRecord ? "НОВЫЙ РЕКОРД" : "ROOT ACCESS",
      text: `Все пять серверов за спиной. Итоговый счёт: ${formatScore(state.total)}. Лучший результат: ${formatScore(best)}.${isRecord ? " Это новый рекорд." : ""}`,
      code: `СЧЁТ ${formatScore(state.total)}`,
      primaryLabel: "СЫГРАТЬ СНОВА",
      onPrimary: startGame,
      secondaryLabel: "В МЕНЮ",
      onSecondary: showStart,
      showCopy: true
    });
  }

  function showResult({ kicker, title, text, code, primaryLabel, onPrimary, secondaryLabel, onSecondary, showCopy = false }) {
    dom.modalKicker.textContent = kicker;
    dom.modalTitle.textContent = title;
    dom.modalText.textContent = text;
    dom.modalCode.textContent = code || "";
    dom.modalCode.classList.toggle("hidden", !code);
    dom.modalPrimary.textContent = primaryLabel;
    dom.modalSecondary.textContent = secondaryLabel;
    dom.copyBtn.classList.toggle("hidden", !showCopy);

    modalPrimaryHandler = () => {
      closeDialog(dom.modal);
      onPrimary?.();
    };
    modalSecondaryHandler = () => {
      closeDialog(dom.modal);
      onSecondary?.();
    };

    showDialog(dom.modal);
  }

  function showDialog(dialog) {
    if (activeDialog && activeDialog !== dialog) closeDialog(activeDialog);
    lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    activeDialog = dialog;
    dialog.classList.remove("hidden");
    document.body.classList.add("modal-open");

    window.setTimeout(() => {
      if (activeDialog !== dialog) return;
      const target = dialog.querySelector(".btn--primary") || dialog.querySelector("button:not([disabled])");
      target?.focus({ preventScroll: true });
    }, 20);
  }

  function closeDialog(dialog) {
    if (!dialog) return;
    dialog.classList.add("hidden");

    if (activeDialog === dialog) {
      activeDialog = null;
      document.body.classList.remove("modal-open");
      const target = lastFocused;
      lastFocused = null;
      if (target && document.contains(target) && !target.closest(".hidden")) {
        target.focus({ preventScroll: true });
      }
    }
  }

  function openHow() {
    play("click");
    showDialog(dom.howModal);
  }

  function trapFocus(event) {
    if (!activeDialog) return;
    const focusables = [...activeDialog.querySelectorAll("button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")]
      .filter((element) => !element.classList.contains("hidden") && element.offsetParent !== null);

    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const outside = !activeDialog.contains(document.activeElement);

    if (event.shiftKey && (document.activeElement === first || outside)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || outside)) {
      event.preventDefault();
      first.focus();
    }
  }

  function updateDocumentTitle() {
    if (!state) {
      document.title = "ROOT//ACCESS — ночной взлом сервера";
      return;
    }
    if (state.completed) {
      document.title = state.won ? "ROOT//ACCESS — доступ получен" : "ROOT//ACCESS — доступ закрыт";
      return;
    }
    document.title = `ROOT//ACCESS — уровень ${state.levelIndex + 1}/${MAX_LEVEL}`;
  }

  function setMessage(text, type = "") {
    dom.message.textContent = text;
    dom.message.className = type ? `message ${type}` : "message";
  }

  function shake() {
    dom.terminalPanel.classList.remove("is-shaking");
    void dom.terminalPanel.offsetWidth;
    dom.terminalPanel.classList.add("is-shaking");
    window.setTimeout(() => dom.terminalPanel.classList.remove("is-shaking"), 380);
  }

  function scrollTop() {
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  }

  function showToast(text) {
    clearTimeout(toastTimer);
    dom.toast.textContent = text;
    dom.toast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => dom.toast.classList.remove("is-visible"), 2200);
  }

  function formatScore(value) {
    return Math.max(0, Math.floor(value)).toString().padStart(6, "0");
  }

  function spaced(value) {
    return [...value].join(" ");
  }

  function pluralAttempts(value) {
    const last = value % 10;
    const lastTwo = value % 100;
    if (last === 1 && lastTwo !== 11) return "ПОПЫТКА";
    if (last >= 2 && last <= 4 && (lastTwo < 10 || lastTwo >= 20)) return "ПОПЫТКИ";
    return "ПОПЫТОК";
  }

  function pluralAttemptsLower(value) {
    return pluralAttempts(value).toLowerCase();
  }

  function loadBest() {
    try {
      const raw = window.localStorage.getItem(BEST_KEY);
      const parsed = Number.parseInt(raw, 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    } catch {
      return 0;
    }
  }

  function saveBest(value) {
    try {
      window.localStorage.setItem(BEST_KEY, String(value));
    } catch {
      return;
    }
  }

  function loadSound() {
    try {
      return window.localStorage.getItem(SOUND_KEY) !== "0";
    } catch {
      return true;
    }
  }

  function saveSound() {
    try {
      window.localStorage.setItem(SOUND_KEY, audioEnabled ? "1" : "0");
    } catch {
      return;
    }
  }

  function renderSound() {
    dom.soundToggle.textContent = audioEnabled ? "ЗВУК: ВКЛ" : "ЗВУК: ВЫКЛ";
    dom.soundToggle.setAttribute("aria-pressed", String(audioEnabled));
  }

  function toggleSound() {
    audioEnabled = !audioEnabled;
    saveSound();
    renderSound();
    if (audioEnabled) {
      play("click");
      showToast("ЗВУК ВКЛЮЧЁН");
    } else {
      showToast("ЗВУК ВЫКЛЮЧЕН");
    }
  }

  function ensureAudio() {
    if (!audioEnabled) return null;
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return null;
      audioCtx = new AudioContextClass();
    }
    if (audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  function tone(frequency, duration, type = "sine", volume = 0.025, delay = 0, slideTo = null) {
    const ctx = ensureAudio();
    if (!ctx) return;
    const start = ctx.currentTime + delay;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    if (slideTo) oscillator.frequency.exponentialRampToValueAtTime(slideTo, start + duration);

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.03);
  }

  function play(kind) {
    if (!audioEnabled) return;
    switch (kind) {
      case "key":
        tone(520 + Math.random() * 60, 0.04, "square", 0.012);
        break;
      case "back":
        tone(260, 0.05, "square", 0.01);
        break;
      case "click":
        tone(420, 0.05, "triangle", 0.016);
        break;
      case "start":
        tone(330, 0.08, "triangle", 0.02, 0);
        tone(440, 0.08, "triangle", 0.02, 0.08);
        tone(660, 0.12, "triangle", 0.02, 0.16);
        break;
      case "scan":
        tone(260, 0.24, "sawtooth", 0.016, 0, 940);
        break;
      case "error":
        tone(180, 0.08, "square", 0.018);
        break;
      case "wrong":
        tone(150, 0.12, "sawtooth", 0.02);
        tone(105, 0.16, "sawtooth", 0.016, 0.08);
        break;
      case "win":
        tone(523, 0.12, "triangle", 0.02, 0);
        tone(659, 0.12, "triangle", 0.02, 0.09);
        tone(784, 0.12, "triangle", 0.02, 0.18);
        tone(1046, 0.18, "triangle", 0.022, 0.27);
        break;
      case "lose":
        tone(220, 0.15, "sawtooth", 0.018, 0);
        tone(174, 0.18, "sawtooth", 0.018, 0.12);
        tone(130, 0.24, "sawtooth", 0.016, 0.25);
        break;
      default:
        break;
    }
  }

  async function copyFinalResult() {
    if (!lastRunText) return;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(lastRunText);
      } else if (!fallbackCopy(lastRunText)) {
        throw new Error("copy failed");
      }
      showToast("РЕЗУЛЬТАТ СКОПИРОВАН");
    } catch {
      if (fallbackCopy(lastRunText)) {
        showToast("РЕЗУЛЬТАТ СКОПИРОВАН");
      } else {
        showToast("НЕ УДАЛОСЬ СКОПИРОВАТЬ");
      }
    }
  }

  function fallbackCopy(text) {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.top = "-1000px";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    let success = false;
    try {
      success = document.execCommand("copy");
    } catch {
      success = false;
    }
    field.remove();
    return success;
  }
})();
