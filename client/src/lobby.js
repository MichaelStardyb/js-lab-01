export function createLobby({ onJoin, onLeave, onChat }) {
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

  refreshRooms();
  setInterval(() => void refreshRooms(), 5000);
  return { setStatus, setRoster, addMessage, setJoined, refreshRooms };
}
