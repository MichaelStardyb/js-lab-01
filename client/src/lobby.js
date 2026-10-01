export function createLobby({ onJoin, onLeave, onChat, onTogglePrediction, onToggleNoise, onChangeInterp }) {
  const root = document.querySelector('#lobby');
  root.innerHTML = `
    <h1>Dogfight</h1>
    <form id="join-form" class="join-form">
      <label>Нікнейм<input name="nickname" maxlength="24" required value="Pilot" /></label>
      <label>Кімната<input name="room" maxlength="32" required placeholder="Назва кімнати" /></label>
      <button type="submit">Увійти / створити</button>
      <button type="button" id="leave" disabled>Вийти</button>
    </form>
    <p id="connection-status" role="status">Не підключено</p>
    <fieldset class="net-controls">
      <legend>Мережа (Lab 5)</legend>
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
  `;

  const form = root.querySelector('#join-form');
  const rooms = root.querySelector('#rooms');
  const roster = root.querySelector('#roster');
  const messages = root.querySelector('#messages');
  const status = root.querySelector('#connection-status');
  const leaveButton = root.querySelector('#leave');

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(form);
    onJoin({
      name: String(data.get('nickname')).trim(),
      room: String(data.get('room')).trim(),
    });
  });
  leaveButton.addEventListener('click', onLeave);
  root.querySelector('#chat-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = root.querySelector('#chat-input');
    const text = input.value.trim();
    if (text) {
      onChat(text);
      input.value = '';
    }
  });

  async function refreshRooms() {
    try {
      const response = await fetch('/api/rooms');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const entries = Array.isArray(data) ? data : data.rooms;
      rooms.replaceChildren();
      for (const room of entries ?? []) {
        const item = document.createElement('li');
        item.textContent = `${room.name ?? room.id} (${room.players ?? room.playerCount ?? 0})`;
        item.addEventListener('click', () => {
          form.elements.room.value = room.id ?? room.name;
        });
        rooms.append(item);
      }
    } catch (error) {
      setStatus(`Не вдалося завантажити кімнати: ${error.message}`);
    }
  }

  function setStatus(value) {
    status.textContent = value;
  }

  function setRoster(players) {
    roster.replaceChildren();
    for (const player of players ?? []) {
      const item = document.createElement('li');
      item.textContent = typeof player === 'string' ? player : player.name;
      roster.append(item);
    }
  }

  function addMessage(author, text) {
    const item = document.createElement('li');
    item.textContent = `${author}: ${text}`;
    messages.append(item);
    messages.scrollTop = messages.scrollHeight;
  }

  function setJoined(joined) {
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

  function updateControls({ dumbClient, nondeterministicExperiment, interpolationDelay }) {
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

  refreshRooms();
  setInterval(() => void refreshRooms(), 5000);
  return { setStatus, setRoster, addMessage, setJoined, refreshRooms, updateControls };
}
