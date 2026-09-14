import { createLoop } from './loop.js';
import { createInput } from './input.js';

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Налаштування чіткості екрана (DPR)
const dpr = window.devicePixelRatio || 1;
canvas.width = 800 * dpr;
canvas.height = 600 * dpr;
canvas.style.width = '800px';
canvas.style.height = '600px';
ctx.scale(dpr, dpr);

const input = createInput(window);

// Стан корабля
let ship = { x: 400, y: 300, vx: 0, vy: 0, angle: 0 };
let prevShip = { ...ship };

function simulate(step) {
    prevShip = { ...ship };
    
    // Управління
    if (input.isDown('ArrowLeft')) ship.angle -= 4 * step;
    if (input.isDown('ArrowRight')) ship.angle += 4 * step;
    if (input.isDown('ArrowUp')) {
        ship.vx += Math.cos(ship.angle) * 300 * step;
        ship.vy += Math.sin(ship.angle) * 300 * step;
    }

    // Рух
    ship.x += ship.vx * step;
    ship.y += ship.vy * step;

    // Загортання країв арени
    if (ship.x < 0) ship.x = 800;
    if (ship.x > 800) ship.x = 0;
    if (ship.y < 0) ship.y = 600;
    if (ship.y > 600) ship.y = 0;
}

function render(alpha, stats) {
    // Очищення екрана
    ctx.clearRect(0, 0, 800, 600);
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, 800, 600);
    
    // Малювання HUD
    ctx.fillStyle = 'lime';
    ctx.font = '16px monospace';
    ctx.fillText(`steps/s: ${stats.sps}`, 10, 20);
    ctx.fillText(`frames/s: ${stats.fps}`, 10, 40);
    ctx.fillText(`frame ms: ${stats.frameMs.toFixed(1)}`, 10, 60);

    // Інтерполяція (для плавного малювання)
    const drawX = prevShip.x + (ship.x - prevShip.x) * alpha;
    const drawY = prevShip.y + (ship.y - prevShip.y) * alpha;
    let drawAngle = prevShip.angle + (ship.angle - prevShip.angle) * alpha;

    // Малювання корабля
    ctx.save();
    ctx.translate(drawX, drawY);
    ctx.rotate(drawAngle);
    ctx.strokeStyle = 'white';
    ctx.beginPath();
    ctx.moveTo(15, 0);
    ctx.lineTo(-10, 10);
    ctx.lineTo(-10, -10);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
}

const loop = createLoop({ step: 1/60, simulate, render });
loop.start();