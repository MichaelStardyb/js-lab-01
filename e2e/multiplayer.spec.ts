import { test, expect } from '@playwright/test';

test.describe('Multiplayer E2E Battle and Chat', () => {
  test('two players join same room, exchange chat, and observe ship movement', async ({ browser }) => {
    // 1. Create two isolated browser contexts
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    // 2. Both navigate to client with ?e2e=1 test hook
    await page1.goto('/?e2e=1&delay=0&jitter=0&drop=0');
    await page2.goto('/?e2e=1&delay=0&jitter=0&drop=0');

    const roomName = `room-${Date.now()}`;

    // 3. Player 1 joins room
    await page1.locator('input[name="nickname"]').fill('PilotOne');
    await page1.locator('input[name="room"]').fill(roomName);
    await page1.locator('#join-form button[type="submit"]').click();
    await expect(page1.locator('#connection-status')).toContainText(roomName, { timeout: 6000 });

    // Wait until Player 1's ship is initialized
    await expect.poll(async () => {
      return await page1.evaluate(() => window.__e2e?.getSnapshot().ownShip !== null);
    }, { timeout: 6000 }).toBe(true);

    // 4. Player 2 joins same room
    await page2.locator('input[name="nickname"]').fill('PilotTwo');
    await page2.locator('input[name="room"]').fill(roomName);
    await page2.locator('#join-form button[type="submit"]').click();
    await expect(page2.locator('#connection-status')).toContainText(roomName, { timeout: 6000 });

    // Wait until Player 2 sees at least 2 ships
    await expect.poll(async () => {
      const snap = await page2.evaluate(() => window.__e2e?.getSnapshot());
      return snap?.ships.length ?? 0;
    }, { timeout: 6000 }).toBeGreaterThanOrEqual(2);

    // 5. Chat Test: Player 1 sends message, Player 2 verifies text in DOM
    const chatMsg = `Greetings from PilotOne ${Date.now()}`;
    await page1.locator('#chat-input').fill(chatMsg);
    await page1.locator('#chat-form').dispatchEvent('submit');

    await expect(page2.locator('#messages')).toContainText(`PilotOne: ${chatMsg}`, { timeout: 5000 });

    // 6. Movement Test: Player 1 thrusts, Player 2 observes position change
    const p1Snap = await page1.evaluate(() => window.__e2e?.getSnapshot());
    const pilotOneId = p1Snap?.ownEntityId;
    expect(pilotOneId).not.toBeNull();

    // Get initial position of PilotOne as seen by Player 2
    let initialX = 0;
    let initialY = 0;
    await expect.poll(async () => {
      const snap = await page2.evaluate(() => window.__e2e?.getSnapshot());
      const p1Ship = snap?.ships.find((s) => s.id === pilotOneId);
      if (p1Ship) {
        initialX = p1Ship.x;
        initialY = p1Ship.y;
        return true;
      }
      return false;
    }, { timeout: 5000 }).toBe(true);

    // Focus canvas and hold thrust key
    await page1.locator('#gameCanvas').focus();
    await page1.keyboard.down('KeyW');

    // Player 2 should observe PilotOne's position changing by more than 15 units
    await expect.poll(async () => {
      const snap = await page2.evaluate(() => window.__e2e?.getSnapshot());
      const p1Ship = snap?.ships.find((s) => s.id === pilotOneId);
      if (!p1Ship) return 0;
      return Math.hypot(p1Ship.x - initialX, p1Ship.y - initialY);
    }, { timeout: 6000 }).toBeGreaterThan(15);

    await page1.keyboard.up('KeyW');

    // 7. Clean up contexts
    await context1.close();
    await context2.close();
  });
});
