import { describe, expect, test } from 'bun:test';
import {
  extractAssistantTextAfterPrompt,
  extractSessionResult,
  getAssistantMessageCount,
  isForwardableImagePart,
  normalizeImagePartsForChildPrompt,
  type PromptBodyPart,
} from './session';

describe('isForwardableImagePart', () => {
  test('accepts legacy image part type', () => {
    expect(isForwardableImagePart({ type: 'image' })).toBe(true);
  });

  test('accepts OpenCode file part with image/* mime', () => {
    expect(
      isForwardableImagePart({
        type: 'file',
        mime: 'image/png',
        url: 'https://example.com/blob',
      }),
    ).toBe(true);
    expect(
      isForwardableImagePart({
        type: 'file',
        mime: 'IMAGE/JPEG',
        url: 'https://example.com/blob',
      }),
    ).toBe(true);
  });

  test('rejects non-image file mime', () => {
    expect(
      isForwardableImagePart({
        type: 'file',
        mime: 'application/pdf',
        url: 'x',
      }),
    ).toBe(false);
  });

  test('accepts file part with image-like filename when mime absent', () => {
    expect(
      isForwardableImagePart({
        type: 'file',
        url: 'x',
        filename: 'clipboard.webp',
      }),
    ).toBe(true);
  });

  test('rejects plain text parts', () => {
    expect(isForwardableImagePart({ type: 'text', text: 'hi' })).toBe(false);
  });
});

describe('normalizeImagePartsForChildPrompt', () => {
  test('drops stored IDs and keeps FilePartInput-shaped drafts', () => {
    const normalized = normalizeImagePartsForChildPrompt([
      {
        type: 'file',
        mime: 'image/png',
        url: 'https://cdn.example.com/a.png',
        id: 'part1',
        sessionID: 'sess',
        messageID: 'msg',
      } as PromptBodyPart,
    ]);
    expect(normalized).toEqual([
      {
        type: 'file',
        mime: 'image/png',
        url: 'https://cdn.example.com/a.png',
      },
    ]);
  });

  test('resolves file source.path to file URL when url missing', () => {
    const normalized = normalizeImagePartsForChildPrompt(
      [
        {
          type: 'file',
          mime: 'image/png',
          url: '',
          source: { type: 'file', path: 'assets/clip.png' },
        } as PromptBodyPart,
      ],
      '/workspace/proj',
    );
    expect(normalized.length).toBe(1);
    expect(normalized[0]?.type).toBe('file');
    expect(normalized[0]?.mime).toBe('image/png');
    expect(String(normalized[0]?.url)).toMatch(/^file:/);
    expect(String(normalized[0]?.url)).toMatch(/clip\.png/);
  });

  test('maps legacy data URL image part to file draft', () => {
    const normalized = normalizeImagePartsForChildPrompt([
      {
        type: 'image',
        image: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
      } as PromptBodyPart,
    ]);
    expect(normalized).toEqual([
      {
        type: 'file',
        mime: 'image/gif',
        url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
      },
    ]);
  });
});

describe('session extraction', () => {
  function createClient(messages: Array<Record<string, unknown>>) {
    return {
      session: {
        messages: async () => ({
          data: messages,
        }),
      },
    };
  }

  test('extractSessionResult slices assistant output after baseline offset', async () => {
    const client = createClient([
      {
        info: { role: 'assistant' },
        parts: [{ type: 'text', text: '<needs_user>old</needs_user>' }],
      },
      {
        info: { role: 'assistant' },
        parts: [{ type: 'text', text: '<plan>new</plan>' }],
      },
    ]);

    const result = await extractSessionResult(client as never, 'child-1', {
      includeReasoning: false,
      assistantMessageOffset: 1,
    });

    expect(result.empty).toBe(false);
    expect(result.text).toBe('<plan>new</plan>');
  });

  test('extractAssistantTextAfterPrompt reads latest assistant turn on resumed session', async () => {
    const messages = [
      {
        info: { role: 'assistant' },
        parts: [{ type: 'text', text: '<needs_user>old</needs_user>' }],
      },
      {
        info: { role: 'assistant' },
        parts: [{ type: 'text', text: '<plan>new</plan>' }],
      },
    ];
    const client = createClient(messages);
    const firstMessage = messages[0];
    if (!firstMessage) {
      throw new Error('expected prior assistant message');
    }
    const assistantMessageOffset = await getAssistantMessageCount(
      createClient([firstMessage]) as never,
      'child-1',
    );

    const result = await extractAssistantTextAfterPrompt(
      client as never,
      'child-1',
      '/workspace',
      { assistantMessageOffset },
    );

    expect(result.empty).toBe(false);
    expect(result.text).toBe('<plan>new</plan>');
  });
});
