import { describe, expect, test } from 'bun:test';
import { PluginConfigSchema } from './schema';

describe('PluginConfigSchema - customInstruction', () => {
  test('accepts a string value', () => {
    const result = PluginConfigSchema.safeParse({
      customInstruction: 'Be precise.',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.customInstruction).toBe('Be precise.');
    }
  });

  test('accepts multiline string preserving newlines', () => {
    const value = 'Line 1\nLine 2\nLine 3';
    const result = PluginConfigSchema.safeParse({ customInstruction: value });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.customInstruction).toBe(value);
    }
  });

  test('accepts preset-level customInstruction', () => {
    const result = PluginConfigSchema.safeParse({
      preset: 'dev',
      presets: {
        dev: {
          customInstruction: 'Use terse output.',
          oracle: { model: 'openai/gpt-5.5' },
        },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.presets?.dev?.customInstruction).toBe(
        'Use terse output.',
      );
    }
  });

  test('remains optional — missing field is valid', () => {
    const result = PluginConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.customInstruction).toBeUndefined();
    }
  });

  test('rejects non-string values', () => {
    expect(PluginConfigSchema.safeParse({ customInstruction: 123 }).success).toBe(
      false,
    );
    expect(
      PluginConfigSchema.safeParse({ customInstruction: true }).success,
    ).toBe(false);
    expect(
      PluginConfigSchema.safeParse({ customInstruction: ['line'] }).success,
    ).toBe(false);
    expect(
      PluginConfigSchema.safeParse({ customInstruction: { a: 'b' } }).success,
    ).toBe(false);
    expect(
      PluginConfigSchema.safeParse({
        preset: 'dev',
        presets: {
          dev: {
            customInstruction: { bad: true },
          },
        },
      }).success,
    ).toBe(false);
  });

  test('accepts empty string', () => {
    const result = PluginConfigSchema.safeParse({ customInstruction: '' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.customInstruction).toBe('');
    }
  });
});
