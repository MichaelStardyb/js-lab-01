import { createLoop } from './loop.js';
import { createInput } from './input.js';
import { World } from './sim/world.js';
import { Ship, Asteroid, Pickup, Explosion } from './sim/entity.js';
import { Vector2 } from './sim/vector.js';
import { loadAll, fetchJson } from './assets/loader.js';
import { gameBus } from './events.js';

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const dpr = window.devicePixelRatio || 1;
canvas.width = 800 * dpr; canvas.height = 600 * dpr;
canvas.style.width = '800px'; canvas.style.height = '600px';
ctx.scale(dpr, dpr);

const input = createInput(window);
const world = new World();
let ship = new Ship(new Vector2(400, 300));

let audioContext;

function playShotSound() {
    const AudioContextClass = window.AudioContext;
    if (!AudioContextClass) return;

    audioContext ??= new AudioContextClass();
    if (audioContext.state === 'suspended') void audioContext.resume();

    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const now = audioContext.currentTime;

    oscillator.type = 'sawtooth';
    oscillator.frequency.setValueAtTime(880, now);
    oscillator.frequency.exponentialRampToValueAtTime(180, now + 0.12);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.15, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.13);
}

gameBus.addEventListener('fired', playShotSound);

async function startApp() {
    // 1. Екран завантаження[cite: 17]
    ctx.fillStyle = 'black'; ctx.fillRect(0, 0, 800, 600);
    ctx.fillStyle = 'white'; ctx.font = '20px Arial';
    ctx.fillText('Завантаження ассетів...', 300, 300);

    const manifest = ['sprite1.png', 'sprite2.png', 'audio1.mp3'];
    await loadAll(manifest, (progress) => {
        ctx.fillStyle = 'black'; ctx.fillRect(0, 0, 800, 600);
        ctx.fillStyle = 'white'; ctx.font = '20px Arial';
        ctx.fillText(`Завантаження: ${Math.round(progress * 100)}%`, 300, 300);
    });

    // 2. Лобі по HTTP[cite: 17]
    ctx.fillStyle = 'black'; ctx.fillRect(0, 0, 800, 600);
    ctx.fillStyle = 'lime';
    ctx.fillText('Отримання списку кімнат...', 300, 300);

    const controller = new AbortController();
    try {
        const rooms = await fetchJson('/api/rooms.json', { signal: controller.signal });
        
        ctx.fillStyle = 'black'; ctx.fillRect(0, 0, 800, 600);
        ctx.fillStyle = 'lime';
        ctx.fillText('Доступні кімнати (Натисни 1 або 2 щоб вибрати):', 150, 200);
        rooms.forEach((room, i) => {
            ctx.fillText(`[${i + 1}] ${room.name} (Гравців: ${room.players})`, 200, 240 + i * 30);
        });

        // Чекаємо вибору кімнати для старту[cite: 17]
        window.addEventListener('keydown', function startGame(e) {
            if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Numpad1' || e.code === 'Numpad2') {
                window.removeEventListener('keydown', startGame);
                runGame();
            }
        });
    } catch (e) {
        ctx.fillText('Помилка завантаження лобі', 300, 350);
    }
}

function runGame() {
    world.spawn(ship);
    let respawnTimer = 0;

    const loop = createLoop({ step: 1/60, simulate: (step) => {
        if (ship.alive) {
            if (input.isDown('ArrowLeft')) ship.angle -= 4 * step;
            if (input.isDown('ArrowRight')) ship.angle += 4 * step;
            if (input.isDown('ArrowUp')) ship.vel = ship.vel.add(Vector2.fromAngle(ship.angle).scale(300 * step));
            ship.vel = ship.vel.scale(0.98);
            if (input.isDown('Space')) ship.fire(world);
        } else {
            respawnTimer += step;
            if (respawnTimer > 2) {
                ship = new Ship(new Vector2(400, 300));
                world.spawn(ship);
                respawnTimer = 0;
            }
        }

        // Спавнер астероїдів і аптечок
        if (Math.random() < 0.02) world.spawn(new Asteroid(new Vector2(Math.random()*800, Math.random()*600), new Vector2((Math.random()-0.5)*100, (Math.random()-0.5)*100)));
        if (Math.random() < 0.002) world.spawn(new Pickup(new Vector2(Math.random()*800, Math.random()*600)));

        world.step(step);
    }, render: (alpha, stats) => {
        ctx.fillStyle = '#111'; ctx.fillRect(0, 0, 800, 600);
        for (const e of world) {
            ctx.save(); ctx.translate(e.pos.x, e.pos.y);
            if (e.kind === 'ship') {
                ctx.rotate(e.angle); ctx.strokeStyle = 'white';
                ctx.beginPath(); ctx.moveTo(15, 0); ctx.lineTo(-10, 10); ctx.lineTo(-10, -10); ctx.closePath(); ctx.stroke();
            } else if (e.kind === 'bullet') {
                ctx.fillStyle = 'yellow'; ctx.beginPath(); ctx.arc(0, 0, e.radius, 0, Math.PI*2); ctx.fill();
            } else if (e.kind === 'asteroid') {
                ctx.strokeStyle = 'gray'; ctx.beginPath(); ctx.arc(0, 0, e.radius, 0, Math.PI*2); ctx.stroke();
            } else if (e.kind === 'pickup') {
                ctx.fillStyle = 'cyan'; ctx.fillRect(-5, -5, 10, 10);
            } else if (e.kind === 'explosion') {
                ctx.fillStyle = 'orange';
                for (let p of e.particles) ctx.fillRect(p.pos.x - e.pos.x, p.pos.y - e.pos.y, 2, 2);
            }
            ctx.restore();
        }

        // Відмальовка HUD[cite: 16]
        ctx.fillStyle = 'lime'; ctx.font = '16px monospace';
        ctx.fillText(`Score: ${world.score}`, 10, 20);
        ctx.fillText(`HP: ${ship.alive ? ship.hp : 0}`, 10, 40);
    }});
    loop.start();
}

startApp();