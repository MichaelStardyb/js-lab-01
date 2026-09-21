import { createLoop } from './loop.js';
import { createInput } from './input.js';
import { World } from './sim/world.js';
import { Ship, Asteroid, Pickup } from './sim/entity.js';
import { Vector2 } from './sim/vector.js';

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const dpr = window.devicePixelRatio || 1;
canvas.width = 800 * dpr;
canvas.height = 600 * dpr;
canvas.style.width = '800px';
canvas.style.height = '600px';
ctx.scale(dpr, dpr);

const input = createInput(window);
const world = new World();

let ship = new Ship(new Vector2(400, 300));
world.spawn(ship);

// Спавн перешкод
world.spawn(new Asteroid(new Vector2(100, 100), new Vector2(20, 30)));
world.spawn(new Asteroid(new Vector2(600, 500), new Vector2(-40, 10)));
world.spawn(new Pickup(new Vector2(400, 100))); // Лікування

let respawnTimer = 0;

function simulate(step) {
    // Управління кораблем
    if (ship.alive) {
        if (input.isDown('ArrowLeft')) ship.angle -= 4 * step;
        if (input.isDown('ArrowRight')) ship.angle += 4 * step;
        if (input.isDown('ArrowUp')) {
            const dir = Vector2.fromAngle(ship.angle);
            ship.vel = ship.vel.add(dir.scale(300 * step));
        }
        // Гальмування (тертя)
        ship.vel = ship.vel.scale(0.98);
        
        // Стрільба (передача world)
        if (input.isDown('Space')) ship.fire(world);
    } else {
        // Логіка респауну
        respawnTimer += step;
        if (respawnTimer > 2) {
            ship = new Ship(new Vector2(400, 300));
            world.spawn(ship);
            respawnTimer = 0;
        }
    }
    // Випадковий спавн нових астероїдів
    if (Math.random() < 0.02) {
        const x = Math.random() * 800;
        const y = Math.random() * 600;
        const vx = (Math.random() - 0.5) * 100;
        const vy = (Math.random() - 0.5) * 100;
        world.spawn(new Asteroid(new Vector2(x, y), new Vector2(vx, vy)));
    }

    // Випадковий спавн аптечок (рідше)
    if (Math.random() < 0.002) {
        const x = Math.random() * 800;
        const y = Math.random() * 600;
        world.spawn(new Pickup(new Vector2(x, y)));
    }
    
    world.step(step);
}

function render(alpha, stats) {
    ctx.clearRect(0, 0, 800, 600);
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, 800, 600);
    
    for (const e of world) {
        ctx.save();
        ctx.translate(e.pos.x, e.pos.y);
        
        if (e.kind === 'ship') {
            ctx.rotate(e.angle);
            ctx.strokeStyle = 'white';
            ctx.beginPath(); ctx.moveTo(15, 0); ctx.lineTo(-10, 10); ctx.lineTo(-10, -10); ctx.closePath(); ctx.stroke();
        } else if (e.kind === 'bullet') {
            ctx.fillStyle = 'yellow';
            ctx.beginPath(); ctx.arc(0, 0, e.radius, 0, Math.PI*2); ctx.fill();
        } else if (e.kind === 'asteroid') {
            ctx.strokeStyle = 'gray';
            ctx.beginPath(); ctx.arc(0, 0, e.radius, 0, Math.PI*2); ctx.stroke();
        } else if (e.kind === 'pickup') {
            ctx.fillStyle = 'cyan';
            ctx.fillRect(-5, -5, 10, 10);
        } else if (e.kind === 'explosion') {
            ctx.fillStyle = 'orange';
            for (let p of e.particles) {
                ctx.fillRect(p.pos.x - e.pos.x, p.pos.y - e.pos.y, 2, 2);
            }
        }
        ctx.restore();
    }

    ctx.fillStyle = 'lime';
    ctx.font = '16px monospace';
    ctx.fillText(`Score: ${world.score}`, 10, 20);
    ctx.fillText(`HP: ${ship.alive ? ship.hp : 0}`, 10, 40);
}

const loop = createLoop({ step: 1/60, simulate, render });
loop.start();