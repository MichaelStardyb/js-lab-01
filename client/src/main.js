import { createLoop } from './loop.js';
import { createInput } from './input.js';
import { World } from './sim/world.js';
import { Ship, Asteroid, Pickup, Explosion } from './sim/entity.js';
import { Vector2 } from './sim/vector.js';
import { gameBus } from './events.js';
import { RoomConnection } from './connection.js';
import { createLobby } from './lobby.js';
import './style.css';

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const dpr = window.devicePixelRatio || 1;
canvas.width = 800 * dpr; canvas.height = 600 * dpr;
ctx.scale(dpr, dpr);

const input = createInput(window);
const world = new World();
let ship = new Ship(new Vector2(400, 300));

// Слухаємо події пострілів (незалежний модуль)[cite: 17]
gameBus.addEventListener('fired', () => console.log('Піу-піу!'));

let connection;
let activeRoom;
let playerName;
let gameStarted = false;
const lobby = createLobby({
    onJoin: ({ room, name }) => {
        activeRoom = room;
        playerName = name;
        lobby.setRoster([]);
        lobby.setJoined(true);
        lobby.setStatus('Підключення до кімнати...');
        connection?.close();
        const roomConnection = new RoomConnection();
        connection = roomConnection;
        roomConnection.addEventListener('open', () => {
            if (connection !== roomConnection) return;
            roomConnection.send({ type: 'join', room: activeRoom, name: playerName });
            lobby.setStatus(`Підключено до ${activeRoom}`);
        });
        roomConnection.addEventListener('close', () => {
            if (connection === roomConnection && activeRoom) {
                lobby.setStatus('З’єднання втрачено. Спроба перепідключення...');
            }
        });
        roomConnection.addEventListener('error', (event) => {
            if (connection === roomConnection) lobby.setStatus(event.detail.message);
        });
        roomConnection.addEventListener('message', ({ detail }) => {
            if (connection !== roomConnection) return;
            if (detail.type === 'roster' || detail.type === 'joined') {
                lobby.setRoster(detail.players ?? detail.roster ?? []);
                if (detail.type === 'joined') lobby.setStatus(`У кімнаті ${activeRoom}`);
                lobby.refreshRooms();
            } else if (detail.type === 'chat') {
                lobby.addMessage(detail.name ?? detail.from ?? 'Гравець', detail.text ?? '');
            } else if (detail.type === 'event' && detail.event?.type === 'chat') {
                lobby.addMessage(detail.event.name ?? 'Гравець', detail.event.text ?? '');
            } else if (detail.type === 'error') {
                lobby.setJoined(false);
                lobby.setStatus(detail.message ?? 'Помилка протоколу');
            }
        });
        if (!gameStarted) {
            gameStarted = true;
            runGame();
        }
    },
    onLeave: () => {
        connection?.send({ type: 'leave' });
        connection?.close();
        connection = undefined;
        activeRoom = undefined;
        lobby.setJoined(false);
        lobby.setRoster([]);
        lobby.setStatus('Ви вийшли з кімнати');
        lobby.refreshRooms();
    },
    onChat: (text) => connection?.send({ type: 'chat', text }),
});

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