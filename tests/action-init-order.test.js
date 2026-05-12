import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('action router init order', () => {
  it('starts the app only after click action maps are initialized', () => {
    const script = readFileSync(resolve(process.cwd(), 'app.js'), 'utf8');
    const clickActionsIndex = script.indexOf('const CLICK_ACTIONS =');
    const bootstrapIndex = script.indexOf('bootstrapApp().catch');

    expect(clickActionsIndex).toBeGreaterThan(-1);
    expect(bootstrapIndex).toBeGreaterThan(-1);
    expect(clickActionsIndex).toBeLessThan(bootstrapIndex);
  });
});
