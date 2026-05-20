import { describe, expect, test } from 'bun:test';
import { subagentOutputRequestsUserHandoff } from './delegate';

describe('subagentOutputRequestsUserHandoff', () => {
  test('true when <needs_user> is present', () => {
    expect(
      subagentOutputRequestsUserHandoff(
        '<diagnosis>x</diagnosis><needs_user>clarify</needs_user>',
      ),
    ).toBe(true);
  });

  test('false when only blocked', () => {
    expect(subagentOutputRequestsUserHandoff('<blocked>x</blocked>')).toBe(
      false,
    );
  });
});
