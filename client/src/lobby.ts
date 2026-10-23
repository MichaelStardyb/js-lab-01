interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function createLobby({
  onJoin,
  onLeave,
  onChat,
  onTogglePrediction,
  onToggleNoise,
  onChangeInterp,
  onTouchControl,
}: {
  onJoin: (info: { name: string; room: string }) => void;
  onLeave: () => void;
  onChat: (text: string) => void;
  onTogglePrediction?: () => void;
  onToggleNoise?: () => void;
  onChangeInterp?: (delta: number) => void;
  onTouchControl?: (code: string, active: boolean) => void;
}) {
  const root = document.querySelector<HTMLDivElement>('#lobby')!;
  root.innerHTML = `
    <div class="lobby-header">
      <div class="brand-row">
        <h1>Dogfight</h1>
        <span id="build-sha" class="build-stamp" title="Git SHA збірки">SHA: ...</span>
      </div>
      <button type="button" id="pwa-install-btn" class="btn-install" hidden>Встановити додаток</button>
    </div>
    <div id="offline-banner" class="offline-banner" hidden role="alert">
      Офлайн-режим — мережа недоступна, працює кеш оболонки PWA
    </div>
    <div id="ios-install-modal" class="ios-modal" hidden role="dialog" aria-labelledby="ios-modal-title">
      <div class="ios-modal-card">
        <h3 id="ios-modal-title">Встановлення на iPhone / iPad</h3>
        <p>1. Натисніть кнопку <strong>Поділитися (Share)</strong> у панелі Safari.<br/>2. Оберіть <strong>На Початковий екран (Add to Home Screen)</strong>.</p>
        <button type="button" id="ios-modal-close">Закрити</button>
      </div>
    </div>
    <form id="join-form" class="join-form">
      <label>Нікнейм<input name="nickname" maxlength="24" required value="Pilot" /></label>
      <label>Кімната<input name="room" maxlength="32" required placeholder="Назва кімнати" value="arena-1" /></label>
      <button type="submit">Увійти / створити</button>
      <button type="button" id="leave" disabled>Вийти</button>
    </form>
    <p id="connection-status" role="status">Не підключено</p>
    <fieldset class="net-controls">
      <legend>Мережа та Спостережуваність</legend>
      <div class="net-buttons">
        <button type="button" id="btn-prediction" class="btn-toggle active" title="Клавіша P">Передбачення: УВІМК (P)</button>
        <button type="button" id="btn-noise" class="btn-toggle" title="Клавіша N">Шум: ВИМК (N)</button>
      </div>
      <div class="interp-row">
        <span>Інтерполяція:</span>
        <button type="button" id="btn-interp-dec" title="Клавіша [">-10</button>
        <strong id="interp-val">100 мс</strong>
        <button type="button" id="btn-interp-inc" title="Клавіша ]">+10</button>
      </div>
      <div class="net-presets">
        <a href="?codec=binary&delay=100&jitter=15&drop=0.02" class="preset-link">DataView</a>
        <a href="?codec=json&delay=100&jitter=15&drop=0.02" class="preset-link">JSON</a>
        <a href="?codec=binary&delay=100&dumb=1" class="preset-link">Dumb</a>
        <a href="?codec=binary&delay=100&nondeterministic=1" class="preset-link">Шум</a>
        <a href="/health" target="_blank" rel="noopener" class="preset-link">/health</a>
        <a href="/ready" target="_blank" rel="noopener" class="preset-link">/ready</a>
        <a href="/metrics" target="_blank" rel="noopener" class="preset-link">/metrics</a>
      </div>
      <div id="server-telemetry" class="server-telemetry">
        <span>Статус: <strong id="srv-ready">перевірка...</strong></span>
        <span>Тік p99: <strong id="srv-p99">0.00 мс</strong></span>
        <span>ELU: <strong id="srv-elu">0.0%</strong></span>
      </div>
    </fieldset>
    <div class="lobby-columns">
      <section><h2>Активні кімнати</h2><ul id="rooms"></ul></section>
      <section><h2>Гравці</h2><ul id="roster"></ul></section>
    </div>
    <section class="chat">
      <h2>Чат кімнати</h2>
      <ol id="messages" aria-live="polite"></ol>
      <form id="chat-form"><label class="visually-hidden" for="chat-input">Повідомлення</label><input id="chat-input" maxlength="500" autocomplete="off" placeholder="Напишіть повідомлення" /><button type="submit">Надіслати</button></form>
    </section>
    <section class="touch-pad" aria-label="Мобільне керування кораблем">
      <h2>Керування (Клавіатура W/A/D/Space або Сенсор)</h2>
      <div class="touch-grid">
        <button type="button" class="touch-btn" data-key="ArrowLeft">◀ Вліво</button>
        <button type="button" class="touch-btn" data-key="ArrowUp">▲ Тяга</button>
        <button type="button" class="touch-btn" data-key="ArrowRight">▶ Вправо</button>
        <button type="button" class="touch-btn touch-fire" data-key="Space">● Вогонь</button>
      </div>
    </section>
  `;

  const form = root.querySelector<HTMLFormElement>('#join-form')!;
  const rooms = root.querySelector<HTMLUListElement>('#rooms')!;
  const roster = root.querySelector<HTMLUListElement>('#roster')!;
  const messages = root.querySelector<HTMLOListElement>('#messages')!;
  const status = root.querySelector<HTMLParagraphElement>('#connection-status')!;
  const leaveButton = root.querySelector<HTMLButtonElement>('#leave')!;
  const buildShaEl = root.querySelector<HTMLSpanElement>('#build-sha')!;
  const srvReadyEl = root.querySelector<HTMLSpanElement>('#srv-ready')!;
  const srvP99El = root.querySelector<HTMLSpanElement>('#srv-p99')!;
  const srvEluEl = root.querySelector<HTMLSpanElement>('#srv-elu')!;
  const installBtn = root.querySelector<HTMLButtonElement>('#pwa-install-btn')!;
  const iosModal = root.querySelector<HTMLDivElement>('#ios-install-modal')!;
  const iosModalClose = root.querySelector<HTMLButtonElement>('#ios-modal-close')!;
  const offlineBanner = root.querySelector<HTMLDivElement>('#offline-banner')!;

  // PWA Install handling
  let deferredPrompt: BeforeInstallPromptEvent | null = null;
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  const isIOS = /iphone|ipad|ipod/i.test(window.navigator.userAgent);

  if (!isStandalone && isIOS) {
    installBtn.hidden = false;
    installBtn.textContent = 'Встановити на iOS';
  }

  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    if (isStandalone) return;
    deferredPrompt = e as BeforeInstallPromptEvent;
    installBtn.hidden = false;
    installBtn.textContent = 'Встановити гру';
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installBtn.hidden = true;
  });

  installBtn.addEventListener('click', () => {
    if (deferredPrompt) {
      void deferredPrompt.prompt().then(() => {
        deferredPrompt = null;
        installBtn.hidden = true;
      });
    } else if (isIOS) {
      iosModal.hidden = false;
    }
  });

  iosModalClose.addEventListener('click', () => {
    iosModal.hidden = true;
  });

  // Online / Offline connectivity indicator
  function syncOnlineState() {
    offlineBanner.hidden = navigator.onLine;
  }
  window.addEventListener('online', syncOnlineState);
  window.addEventListener('offline', syncOnlineState);
  syncOnlineState();

  // Touch buttons for mobile PWA playability
  const touchButtons = root.querySelectorAll<HTMLButtonElement>('.touch-btn');
  touchButtons.forEach((btn) => {
    const keyCode = btn.dataset.key;
    if (!keyCode) return;
    const activate = (ev: Event) => {
      ev.preventDefault();
      btn.classList.add('pressed');
      onTouchControl?.(keyCode, true);
    };
    const deactivate = (ev: Event) => {
      ev.preventDefault();
      btn.classList.remove('pressed');
      onTouchControl?.(keyCode, false);
    };
    btn.addEventListener('pointerdown', activate);
    btn.addEventListener('pointerup', deactivate);
    btn.addEventListener('pointercancel', deactivate);
    btn.addEventListener('pointerleave', deactivate);
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(form);
    onJoin({
      name: String(data.get('nickname')).trim(),
      room: String(data.get('room')).trim(),
    });
  });

  leaveButton.addEventListener('click', () => onLeave());

  root.querySelector<HTMLFormElement>('#chat-form')!.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = root.querySelector<HTMLInputElement>('#chat-input')!;
    const text = input.value.trim();
    if (!text) return;
    onChat(text);
    input.value = '';
  });

  let latestGitSha = 'local';

  async function refreshRooms() {
    try {
      const [roomsRes, statsRes] = await Promise.all([
        fetch('/api/rooms'),
        fetch('/api/stats'),
      ]);
      if (!roomsRes.ok) throw new Error(`HTTP ${roomsRes.status}`);
      const list = await roomsRes.json();
      rooms.replaceChildren(...list.map((room: { id?: string; name?: string; players?: number; playerCount?: number }) => {
        const item = document.createElement('li');
        const id = room.id ?? room.name ?? '';
        const count = room.players ?? room.playerCount ?? 0;
        item.textContent = `${id} (${count})`;
        item.addEventListener('click', () => {
          form.elements.namedItem('room') && ((form.elements.namedItem('room') as HTMLInputElement).value = id);
        });
        return item;
      }));
      if (statsRes.ok) {
        const stats = await statsRes.json();
        if (typeof stats.gitSha === 'string' && stats.gitSha) {
          latestGitSha = stats.gitSha;
          buildShaEl.textContent = `SHA: ${stats.gitSha}`;
        }
        srvReadyEl.textContent = 'ONLINE';
        const p99 = stats.durationMs?.p99 ?? stats.durationMs?.max ?? 0;
        srvP99El.textContent = `${Number(p99).toFixed(2)} мс`;
        const elu = (Number(stats.eventLoopUtilization ?? 0) * 100).toFixed(1);
        srvEluEl.textContent = `${elu}%`;
      }
    } catch {
      srvReadyEl.textContent = 'OFFLINE';
      if (leaveButton.disabled && status.textContent === 'Не підключено') {
        status.textContent = 'Очікування зв’язку з сервером...';
      }
    }
  }

  function setStatus(text: string) {
    status.textContent = text;
  }

  function setRoster(players: Array<string | { name: string }>) {
    roster.replaceChildren(...players.map((player) => {
      const item = document.createElement('li');
      item.textContent = typeof player === 'string' ? player : player.name;
      return item;
    }));
  }

  function addMessage(author: string, text: string) {
    const item = document.createElement('li');
    const strong = document.createElement('strong');
    strong.textContent = `${author}: `;
    item.append(strong, document.createTextNode(text));
    messages.append(item);
    messages.scrollTop = messages.scrollHeight;
  }

  function setJoined(joined: boolean) {
    leaveButton.disabled = !joined;
  }

  const btnPrediction = root.querySelector('#btn-prediction');
  const btnNoise = root.querySelector('#btn-noise');
  const btnInterpDec = root.querySelector('#btn-interp-dec');
  const btnInterpInc = root.querySelector('#btn-interp-inc');
  const interpVal = root.querySelector('#interp-val');

  btnPrediction?.addEventListener('click', () => onTogglePrediction?.());
  btnNoise?.addEventListener('click', () => onToggleNoise?.());
  btnInterpDec?.addEventListener('click', () => onChangeInterp?.(-10));
  btnInterpInc?.addEventListener('click', () => onChangeInterp?.(+10));

  function updateControls({ dumbClient, nondeterministicExperiment, interpolationDelay }: { dumbClient?: boolean; nondeterministicExperiment?: boolean; interpolationDelay?: number }) {
    if (btnPrediction) {
      btnPrediction.textContent = dumbClient ? 'Передбачення: ВИМК (P)' : 'Передбачення: УВІМК (P)';
      btnPrediction.classList.toggle('active', !dumbClient);
    }
    if (btnNoise) {
      btnNoise.textContent = nondeterministicExperiment ? 'Шум: УВІМК (N)' : 'Шум: ВИМК (N)';
      btnNoise.classList.toggle('active', Boolean(nondeterministicExperiment));
    }
    if (interpVal) {
      interpVal.textContent = `${interpolationDelay} мс`;
    }
  }

  function getGitSha(): string {
    return latestGitSha;
  }

  void refreshRooms();
  setInterval(() => void refreshRooms(), 5000);
  return { setStatus, setRoster, addMessage, setJoined, refreshRooms, updateControls, getGitSha };
}
