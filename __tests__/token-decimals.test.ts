import {
  formatUnits,
  parseUnits,
  tokenDecimals,
  formatTokenAmount,
  pickXrgeBalance,
  pickTokenBalances,
} from '@/lib/token-decimals';

// Token amounts are integer base units; `decimals` says where the point goes. These assert exact
// (BigInt) conversion with no float drift, and that input is refused when it has too many places.

describe('formatUnits — raw integer base units → exact human string', () => {
  test('1647 qBTC satoshis (8 dp) → "0.00001647"', () => {
    expect(formatUnits(1647, 8)).toBe('0.00001647');
  });
  test('128660 qUSDC (6 dp) → "0.12866" (trailing zeros trimmed)', () => {
    expect(formatUnits(128660, 6)).toBe('0.12866');
  });
  test('a token with 0 decimals is unchanged', () => {
    expect(formatUnits(1647, 0)).toBe('1647');
    expect(formatUnits(911624, 0)).toBe('911624');
  });
  test('whole amounts have no fractional part', () => {
    expect(formatUnits(100000000, 8)).toBe('1');
    expect(formatUnits(0, 6)).toBe('0');
  });
  test('values above 2^53 are exact when passed as a string', () => {
    // 123456789012345678 base units at 8 dp — exceeds Number.MAX_SAFE_INTEGER,
    // so only the string path is exact (a float would lose the low digits).
    expect(formatUnits('123456789012345678', 8)).toBe('1234567890.12345678');
    expect(Number.isSafeInteger(123456789012345678)).toBe(false);
  });
});

describe('parseUnits — human input string → exact integer base units', () => {
  test('"0.1" qUSDC (6 dp) → 100000 units', () => {
    expect(parseUnits('0.1', 6)).toBe(100000n);
  });
  test('"0.00001647" qBTC (8 dp) → 1647 units', () => {
    expect(parseUnits('0.00001647', 8)).toBe(1647n);
  });
  test('"25" XRGE (0 dp) → 25 units', () => {
    expect(parseUnits('25', 0)).toBe(25n);
  });
  test('"0.1234567" qUSDC (6 dp) is refused — too many decimals', () => {
    expect(() => parseUnits('0.1234567', 6)).toThrow(/Too many decimals/);
  });
  test('a fractional amount for a 0-decimal token is refused', () => {
    expect(() => parseUnits('1.5', 0)).toThrow();
  });
  test('malformed input is refused', () => {
    for (const bad of ['', '.', 'abc', '1.2.3', '-5']) {
      expect(() => parseUnits(bad, 6)).toThrow();
    }
  });
  test('round-trips with formatUnits', () => {
    expect(formatUnits(parseUnits('1234.56', 6), 6)).toBe('1234.56');
  });
});

describe('tokenDecimals — fallback never guesses 18', () => {
  test('built-in bridge tokens', () => {
    expect(tokenDecimals('qBTC')).toBe(8);
    expect(tokenDecimals('QETH')).toBe(6);
    expect(tokenDecimals('qusdc')).toBe(6);
  });
  test('unknown / RougeChain tokens default to 0, not 18', () => {
    expect(tokenDecimals('QTEK')).toBe(0);
    expect(tokenDecimals('XRGE')).toBe(0);
    expect(tokenDecimals('')).toBe(0);
  });
});

test('formatTokenAmount adds thousands separators', () => {
  expect(formatTokenAmount('XRGE', 27812488)).toBe('27,812,488');
  expect(formatTokenAmount('QBTC', 1647)).toBe('0.00001647');
});

describe('balance field selection — prefer exact *_raw (node 1.6.4+), else float fallback', () => {
  test('prefers balance_raw / token_balances_raw when present', () => {
    const b = {
      balance: 100.0,
      balance_raw: '101',
      token_balances: { QBTC: 1.0 },
      token_balances_raw: { QBTC: '1647' },
    };
    expect(pickXrgeBalance(b)).toBe(101);
    expect(pickTokenBalances(b)).toEqual({ QBTC: 1647 });
  });
  test('falls back to the older fields on a 1.6.3 node (no *_raw)', () => {
    const b = { balance: 42, token_balances: { QBTC: 1647 } };
    expect(pickXrgeBalance(b)).toBe(42);
    expect(pickTokenBalances(b)).toEqual({ QBTC: 1647 });
  });
  test('falls back to `tokens` and handles a missing balance', () => {
    expect(pickTokenBalances({ tokens: { QUSDC: 128660 } })).toEqual({ QUSDC: 128660 });
    expect(pickXrgeBalance({})).toBe(0);
    expect(pickTokenBalances({})).toEqual({});
  });
});
