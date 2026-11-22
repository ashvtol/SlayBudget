import { describe, expect, it } from 'vitest';
import { cleanMerchant } from './merchant';

describe('cleanMerchant', () => {
  it('drops store and reference numbers', () => {
    expect(cleanMerchant('shell oil 58000012345')).toBe('Shell');
    expect(cleanMerchant('walmart+ member 06/58000012345')).toBe('Walmart+ Member');
    expect(cleanMerchant('target #1234')).toBe('Target');
  });

  it('drops payment-processor prefixes and keeps the business', () => {
    expect(cleanMerchant('sq junior')).toBe('Junior');
    expect(cleanMerchant('SQ *BLUE BOTTLE')).toBe('Blue Bottle');
    expect(cleanMerchant('tst le')).toBe('Le');
    expect(cleanMerchant('TST* SWEETGREEN')).toBe('Sweetgreen');
    expect(cleanMerchant('dd indnoncafebistr')).toBe('Indnoncafebistr');
    expect(cleanMerchant('paypal *spotify')).toBe('Spotify');
  });

  it('names well-known brands the way people say them', () => {
    expect(cleanMerchant('amazon markeplace')).toBe('Amazon');
    expect(cleanMerchant('amazon.com amzn.com/bill')).toBe('Amazon');
    expect(cleanMerchant('uberbv amsterdam')).toBe('Uber');
    expect(cleanMerchant('uber eats')).toBe('Uber Eats');
    expect(cleanMerchant('apple.com/bill internet')).toBe('Apple');
    expect(cleanMerchant('google youtubepremi')).toBe('YouTube Premium');
    expect(cleanMerchant('geico auto')).toBe('GEICO');
    expect(cleanMerchant('gympass new')).toBe('Gympass');
    expect(cleanMerchant('sdot paybyphone')).toBe('PayByPhone');
    expect(cleanMerchant('wsdot goodtogo')).toBe('Good To Go');
    expect(cleanMerchant('dd doordash')).toBe('DoorDash');
  });

  it('title-cases everything else and never returns an empty name', () => {
    expect(cleanMerchant('AMC THEATRES')).toBe('Amc Theatres');
    expect(cleanMerchant('immigration canada')).toBe('Immigration Canada');
    expect(cleanMerchant('12345678')).toBe('12345678');
    expect(cleanMerchant('sq')).toBe('Sq');
  });
});
