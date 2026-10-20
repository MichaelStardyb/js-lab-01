# Лабораторна робота 7: План розвідки та архітектурного аудиту (Фаза 0)

## 1. Загальний огляд середовища та структури репозиторію

- **Версія Node.js**: `v24.21.0` (підтримується `>=20.0.0`, в CI використовується Node 22).
- **Менеджер пакетів**: npm `11.19.0`.
- **Архітектура репозиторію**: Монорепозиторій на npm workspaces:
  - `client/` — Vite + Canvas 2D + Web Audio API + Netgraph + Lobby UI.
  - `server/` — Node.js + WebSocket (`ws`) + Fixed Ticker (30 TPS) + Authoritative Room Game.
  - `shared/` — Чиста спільна фізика (`integrate`), арена (`wrapPosition`, `wrapAngle`), генератор псевдовипадкових чисел (`mulberry32`), бінарний кодек (`binaryCodec`) та Zod-схеми протоколу (`schema`).
- **Скрипти кореневого `package.json`**:
  - `dev:client`: запуск клієнта через Vite.
  - `dev:server`: запуск сервера з tsx.
  - `start`: запуск продакшен-сервера.
  - `build`: збірка клієнта через Vite.
  - `test`: запуск тестів через `node --import tsx --test`.
  - `lint`: запуск `tsx server/scripts/check-syntax.ts`.
  - `bench:netcode`: запуск бенчмарку мережевого кодека.
  - `typecheck`: `tsc -b`.
- **Поточний CI (`.github/workflows/ci.yml`)**:
  - Запускається на `push` та `pull_request` для всіх гілок.
  - Використовує Ubuntu Latest, Node 22, кеш npm, послідовно виконує `npm install`, `npm run typecheck`, `npm test`.
- **Лінтер та перевірка коду**:
  - ESLint/Biome наразі відсутні; перевірка синтаксису виконується скриптом `server/scripts/check-syntax.ts` (викликає `node --check`).
- **Конфігурація TypeScript**:
  - `tsconfig.base.json`: `target: ES2022`, `module: NodeNext`, `moduleResolution: NodeNext`, `strict: true`, `noUncheckedIndexedAccess: true`, `verbatimModuleSyntax: true`.
  - `tsconfig.json` у корені з проектними посиланнями на `client`, `server`, `shared`.

---

## 2. Локалізація компонентів гри (файли та рядки)

| Компонент | Шлях до файлу | Рядки | Примітки |
| :--- | :--- | :--- | :--- |
| `createLoop` | [client/src/loop.ts](file:///client/src/loop.ts) | 7–43 | Ігровий цикл із накопичувачем (акумулятором), фіксований крок 60 Гц. |
| `integrate` | [shared/sim/ship.ts](file:///shared/sim/ship.ts) | 22–35 | Чиста функція інтеграції позиції, кута та швидкості корабля. |
| `Vector2` | [client/src/sim/vector.ts](file:///client/src/sim/vector.ts) | 1–16 | 2D-вектор з незмінними (immutable) методами `add`, `sub`, `scale`, `normalize`. |
| `Entity`, `Ship` | [client/src/sim/entity.ts](file:///client/src/sim/entity.ts) | 5–86 | Базовий клас та корабель гравця, приватне `#hp`, метод `fire`. |
| `Bullet`, `Asteroid`, `Pickup`, `Explosion` | [client/src/sim/entity.ts](file:///client/src/sim/entity.ts) | 88–153 | Сутності снарядів, астероїдів, аптечок та частинок вибуху. |
| `World` (spawn, despawn, sweep, ofKind) | [client/src/sim/world.ts](file:///client/src/sim/world.ts) | 3–46 | Контейнер сутностей на базі `Map`, генератор `*ofKind`, O(n²) колізії. |
| Колізії (клієнтські) | [client/src/sim/world.ts](file:///client/src/sim/world.ts) | 24–38 | Подвійний цикл перевірки кіл із викликом `a.pos.sub(b.pos).length()`. |
| Колізії (серверні) | [server/src/game.ts](file:///server/src/game.ts) | 244–348 | Перевірки bullet-player, bullet-asteroid, ship-asteroid, ship-pickup. |
| Seeded RNG (`mulberry32`) | [shared/sim/prng.ts](file:///shared/sim/prng.ts) | 1–21 | Детермінований псевдовипадковий генератор на базі seed. |
| Бінарний кодек (`encodeSnapshot`, `decodeSnapshot`, `encodeInput`, `decodeInput`) | [shared/protocol/binaryCodec.ts](file:///shared/protocol/binaryCodec.ts) | 32–215 | Серіалізація через `DataView`, Little-Endian, версія 1, кут ×10000. |
| `parseClientMessage`, Branded Types | [shared/protocol/schema.ts](file:///shared/protocol/schema.ts) | 3–88 | Zod-валідація, номінальні типи `EntityId`, `Tick`, `Seq`. |
| Rate Limiter (`TokenBucket`) | [server/src/protocol.ts](file:///server/src/protocol.ts) | 36–59 | Алгоритм корзини токенів із відновленням у часі. |
| `Room`, кімнати | [server/src/rooms.ts](file:///server/src/rooms.ts), [server/src/room.ts](file:///server/src/room.ts) | 1–118 | Менеджер кімнат та клас кімнати (`EventEmitter`). |
| Серверний цикл (30 кроків/с) | [server/src/loop.ts](file:///server/src/loop.ts) | 1–49 | `createFixedTicker`, крок 33.3 мс (1000 / 30). |
| Серверна гра (`RoomGame`) | [server/src/game.ts](file:///server/src/game.ts) | 91–442 | Авторитетний стан, крок симуляції, розсилка знімків. |
| Клієнтський Prediction / Reconciliation | [client/src/main.ts](file:///client/src/main.ts) | 378–430 | Буфер непідтверджених input, повторне програвання, згладжування visualOffset. |
| Netgraph та HUD | [client/src/main.ts](file:///client/src/main.ts) | 184–280 | Візуалізація RTT, FPS, SPS, бітрейту та виправлень помилок. |
| Чат | [client/src/main.ts](file:///client/src/main.ts), [server/src/room.ts](file:///server/src/room.ts) | 105–135, 40–44 | Текстові повідомлення в межах кімнати. |
| Лобі | [client/src/lobby.ts](file:///client/src/lobby.ts) | 1–120 | Вибір імені, списку кімнат, підключення до гри. |

---

## 3. Наявні тести та перевірка детермінізму

- Поточні тести знаходяться у `shared/test/` (3 файли) та `server/test/` (3 файли).
- Загалом 10 тестів, що запускаються через стандартний runner Node.js: `node --import tsx --test shared/test/*.test.ts server/test/*.test.ts`.
- **Тест детермінізму**: [shared/test/simulation.test.ts](file:///shared/test/simulation.test.ts#L6-L21). Перевіряє, що функція `integrate` зі спільним сидом генератора `mulberry32` за 500 кроків повертає суворо ідентичний стан (`assert.deepEqual(run(), run())`).

---

## 4. Аналіз ін'єкції таймерів у `createLoop`

У поточному коді [client/src/loop.ts](file:///client/src/loop.ts#L9-L41) виклики `performance.now()`, `requestAnimationFrame` та `cancelAnimationFrame` захардкоджені безпосередньо.
Для модульного тестування у Vitest із фейковими таймерами (`vi.useFakeTimers`) або headless-середовищі необхідний неруйнівний рефакторинг:
```typescript
export interface LoopOptions {
  step?: number;
  simulate: (step: number) => void;
  render: (alpha: number, stats: LoopStats) => void;
  now?: () => number;
  raf?: (callback: FrameRequestCallback) => number;
  caf?: (id: number) => void;
}

export function createLoop({
  step = 1 / 60,
  simulate,
  render,
  now = () => performance.now(),
  raf = (cb) => requestAnimationFrame(cb),
  caf = (id) => cancelAnimationFrame(id),
}: LoopOptions) {
  // Використовує now, raf, caf замість глобальних функцій
}
```
Це забезпечить зворотну сумісність із існуючим клієнтом і дозволить повне тестування у Vitest.

---

## 5. Серверні ліміти та обмеження масштабування

Конфігурація сервера задається в [server/src/config.ts](file:///server/src/config.ts):
- `MAX_PLAYERS_PER_ROOM`: за замовчуванням `8`, схема Zod дозволяє значення до `1000`. Для навантажувальних тестів на 32/64/128 клієнтів значення буде передаватись через змінну середовища `MAX_PLAYERS_PER_ROOM=128`.
- `RATE_LIMIT_PER_SEC`: за замовчуванням `15` запитів/с.
- `INPUT_RATE_LIMIT_PER_SEC`: за замовчуванням `90` input/с. Для 30 кроків/с клієнт відправляє 30–60 пакетів, ліміту 90 достатньо.
- `MAX_PAYLOAD_BYTES`: 4096 байт. Для бінарного знімка розмір складає $12 + N \times 18$ байт. Для 128 сутностей: $12 + 128 \times 18 = 2316$ байт, що вкладається в ліміт 4 КБ.
- Вузьке місце під час масштабування на 64–128 клієнтів:
  1. Кодування знімка окремо для кожного сокета у `server/src/game.ts` (`encodeSnapshot` викликається у циклі по гравцях).
  2. Перевірка колізій O(n²) між кулями, гравцями, астероїдами та аптечками.

---

## 6. Інвентаризація алокацій у гарячому шляху (Hot-Path Allocation Inventory)

### Клієнт (на кожен кадр рендеру / крок симуляції):
1. **Інтерполяція** ([client/src/main.ts:523-559](file:///client/src/main.ts#L523-L559)):
   - `before.entities.map(...)` та `after.entities.map(...)` створюють 2 нові масиви щокадру.
   - `new Map(...)` створюється двічі на кожен кадр.
   - `new Set(...)` та розпакування `[...earlier.keys(), ...later.keys()]` створюють 2 масиви та 1 множину щокадру.
   - `result.push({ ...to, x: ..., y: ..., angle: ... })` алокує новий об'єкт для кожної відображуваної сутності.
2. **Векторні операції** ([client/src/sim/vector.ts](file:///client/src/sim/vector.ts)):
   - Будь-який метод (`add`, `sub`, `scale`, `normalize`, `fromAngle`) інстанціює `new Vector2(...)`.
3. **Генератор у World** ([client/src/sim/world.ts:12-38](file:///client/src/sim/world.ts#L12-L38)):
   - `*ofKind(kind)` генерує об'єкт-ітератор на кожен виклик.
   - `Array.from(this)` створює новий масив сутностей на кожному кроці симуляції.
   - `a.pos.sub(b.pos).length()` у перевірці колізій алокує новий вектор для кожної пари сутностей.
4. **Малювання на Canvas** ([client/src/main.ts:562-680](file:///client/src/main.ts#L562-L680)):
   - `ctx.save()` / `ctx.restore()` викликається для кожної сутності щокадру.
   - Шаблонні рядки кольорів: `` `hsl(${entity.id * 67 % 360} 75% 70%)` `` генерують рядки у купі щокадру.
5. **Частинки вибухів** ([client/src/main.ts:100-111](file:///client/src/main.ts#L100-L111), [client/src/sim/entity.ts:138-142](file:///client/src/sim/entity.ts#L138-L142)):
   - Кожен вибух алокує масив із 10–12 об'єктів частинок, які згодом видаляються через `splice` або garbage collector.

### Сервер (на кожен тік 30 TPS):
1. **Збірка знімка** ([server/src/game.ts:388-441](file:///server/src/game.ts#L388-L441)):
   - `#snapshotEntities()` виділяє новий масив `entities` та окремий об'єкт для кожного гравця, кулі, астероїда й аптечки.
2. **Кодування пакетів** ([server/src/game.ts:352-368](file:///server/src/game.ts#L352-L368)):
   - Для кожного клієнта викликається `encodeSnapshot`, що виділяє новий `ArrayBuffer` через `new ArrayBuffer(12 + entities.length * 18)` та `new DataView`.

---

## 7. Стабільність форм об'єктів (Hidden Classes / Shapes у V8)

- Усі поля в `SnapshotEntity`, що декодуються у `binaryCodec.ts`, мають стабільну форму (`id`, `kind`, `x`, `y`, `angle`, `vx`, `vy`, `hp`).
- Потенційні деоптимізації / нестабільні форми:
  - У `client/src/sim/entity.ts`: клас `Bullet` динамічно додає `this.homingTarget = null`, тоді як інші нащадки `Entity` цього поля не мають.
  - У `client/src/main.ts`: об'єкт `RenderableEntity` формується через `{ ...to, x, y, angle }`, де поле `hp` присутнє не у всіх сутностей, або додається пізніше.
  - Використання оператора `delete` не виявлено (використовується `Map.prototype.delete`, що не псує форму об'єктів).
  - Дірок у масивах (sparse arrays) немає, проте часте використання `splice` у масивах куль та частинок спричиняє переалокацію елементів.

---

## 8. Припущення та подальші кроки

- **Припущення 1**: Тестовий фреймворк `vitest` буде встановлено як `devDependency` у корінь монорепозиторію разом із `@vitest/coverage-v8` та `fast-check`. Команда `npm test` запускатиме Vitest по всіх workspaces.
- **Припущення 2**: Усі нові скрипти бенчмарків (`bench:browser`, `bench:report`, `bench:load`) писатимуться на TypeScript і запускатимуться кросплатформно через `tsx`.
- **Припущення 3**: Поріг колізій O(n²) проти просторового хешу (Spatial Hash Grid) буде визначено на підставі реальних вимірювань у Фазі 6 та 8.
- **Блокуючі невизначеності**: Відсутні. Переходимо до Фази 1 (M1).
