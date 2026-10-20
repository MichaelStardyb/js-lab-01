import { describe, it, expect } from 'vitest';
import { loadConfig, defaultConfig, ConfigEnvSchema } from '../src/config.js';

describe('server/config loadConfig', () => {
  it('loads valid default configurations when environment is empty', () => {
    const config = loadConfig({});
    expect(config.port).toBe(defaultConfig.PORT);
    expect(config.host).toBe(defaultConfig.HOST);
    expect(config.maxRooms).toBe(defaultConfig.MAX_ROOMS);
    expect(config.maxPlayersPerRoom).toBe(defaultConfig.MAX_PLAYERS_PER_ROOM);
    expect(config.rateLimitPerSec).toBe(defaultConfig.RATE_LIMIT_PER_SEC);
    expect(config.inputRateLimitPerSec).toBe(defaultConfig.INPUT_RATE_LIMIT_PER_SEC);
  });

  it('overrides settings via valid environment variables', () => {
    const config = loadConfig({
      PORT: '8080',
      HOST: '0.0.0.0',
      MAX_PLAYERS_PER_ROOM: '64',
      RATE_LIMIT_PER_SEC: '50',
    });
    expect(config.port).toBe(8080);
    expect(config.host).toBe('0.0.0.0');
    expect(config.maxPlayersPerRoom).toBe(64);
    expect(config.rateLimitPerSec).toBe(50);
  });

  it('rejects invalid ports or negative values via Zod validation', () => {
    expect(() => ConfigEnvSchema.parse({ PORT: 'invalid_port' })).toThrow();
    expect(() => ConfigEnvSchema.parse({ PORT: '70000' })).toThrow();
    expect(() => ConfigEnvSchema.parse({ MAX_PLAYERS_PER_ROOM: '-5' })).toThrow();
  });

  it('rejects invalid hosts or hosts with whitespace', () => {
    expect(() => ConfigEnvSchema.parse({ HOST: 'bad host with spaces' })).toThrow();
  });
});
