import { describe, expect, it } from 'vitest';
import { statementClues } from './statement-clues';

const clues = (line: string) => Object.fromEntries(statementClues(line).map((c) => [c.label, c.value]));

describe('statementClues', () => {
  it('names the payment processor and the city', () => {
    expect(clues('TST* GANTRY PUBLIC HOUSE SEATTLE WA')).toEqual({ 'Paid through': 'Toast', Location: 'Seattle, WA' });
    expect(clues('SQ *BLUE BOTTLE COFFEE Seattle WA')).toEqual({ 'Paid through': 'Square', Location: 'Seattle, WA' });
    expect(clues('PAYPAL *STEAM GAMES 4029357733 WA')['Paid through']).toBe('PayPal');
    expect(clues('DD *DOORDASH CHIPOTLE SAN FRANCISCO CA')).toMatchObject({ 'Paid through': 'DoorDash', Location: 'San Francisco, CA' });
  });

  it('finds a city run into the name, or in its own padded column', () => {
    expect(clues('VIVID SEATS LTD*VIVICHICAGO             IL').Location).toBe('Chicago, IL');
    expect(clues('ASTOUND             WILKES-BARRE        PA').Location).toBe('Wilkes-Barre, PA');
  });

  it('falls back to the state name when the city is unclear', () => {
    expect(clues('AMAZON MARKEPLACE NA  PA').Location).toBe('Pennsylvania');
  });

  it('reads websites, phone numbers, store and reference numbers', () => {
    expect(clues('AMAZON TIPS*YB99X95HAMZN.COM/BILL       WA')).toMatchObject({ Website: 'amzn.com', Location: 'Washington' });
    expect(clues('NETFLIX.COM 866-579-7172 CA')).toEqual({ Website: 'netflix.com', Phone: '(866) 579-7172', Location: 'California' });
    expect(clues('COSTCO WHSE #0123 SEATTLE WA')).toEqual({ Store: '#0123', Location: 'Seattle, WA' });
    expect(clues('SHELL 58000012345 SEATTLE WA')).toEqual({ Reference: '58000012345', Location: 'Seattle, WA' });
    expect(clues('UBER *TRIP HELP.UBER.COM help.uber.comNL').Website).toBe('help.uber.com');
  });

  it('reads who an ACH payment went to', () => {
    expect(clues('ACH Electronic Debit AMERICAN EXPR ACH PMT M1434')).toEqual({ 'Paid through': 'ACH bank transfer', 'Paid to': 'American Expr', Reference: 'M1434' });
    expect(clues('ACH Electronic Debit AMERICAN EXPR ACH PMT M2330 1').Reference).toBe('M2330');
    expect(clues('ACH Electronic Debit CITI AUTOPAY PAYMENT 251899050970052 1')).toMatchObject({ 'Paid to': 'Citi', Reference: '251899050970052' });
    expect(clues('ACH Electronic Credit Acme Corporati PAYROLL')).toEqual({ 'Paid through': 'ACH bank transfer', 'Paid by': 'Acme Corporati' });
  });

  it('says nothing when there is nothing to read', () => {
    expect(statementClues('PAYMENT THANK YOU')).toEqual([]);
    expect(statementClues('')).toEqual([]);
  });

  describe('Amex fixed-width lines (name 20, city 20, then state or country)', () => {
    it('reads the city by position, even when the name runs into it', () => {
      expect(clues('DD *DOORDASH TATSDELSAN FRANCISCO       CA')).toMatchObject({ 'Paid through': 'DoorDash', Location: 'San Francisco, CA' });
      expect(clues('PwP    AMERICAN EXPRSEATTLE             WA')).toMatchObject({ 'Paid through': 'Pay with Points', Location: 'Seattle, WA' });
      expect(clues('METROPOLITAN MKT 164MERCER ISLAND       WA').Location).toBe('Mercer Island, WA');
    });

    it('keeps a foreign region code as given instead of reading it as a US state', () => {
      expect(clues('ETHNIX UNISEX SALOONBangalore           IN').Location).toBe('Bangalore, IN');
      expect(clues('THAI AIRWAYS INTERNEBANGKOK             TH').Location).toBe('Bangkok, TH');
    });

    it('ignores a city column holding numbers or a website', () => {
      expect(clues('MUMBAI DUTY FREE    400099              MA').Location).toBe('Massachusetts');
      expect(clues('AMAZON TIPS*590478KIAMZN.COM/BILL       WA')).toMatchObject({ Website: 'amzn.com', Location: 'Washington' });
    });
  });

  it('names Apple Pay, alone or with the processor behind it', () => {
    expect(clues('AplPay TOTAL WINE ANSEATTLE             WA')['Paid through']).toBe('Apple Pay');
    expect(clues('AplPay TST* CAFE HAGSEATTLE             WA')['Paid through']).toBe('Apple Pay, Toast');
  });

  it('reads booking and order codes after the star', () => {
    expect(clues('AIRBNB * HM8H82ZFJJ SAN FRANCISCO       CA').Reference).toBe('HM8H82ZFJJ');
    expect(clues('AMAZON.COM*R11192TM3AMZN.COM/BILL       WA')).toMatchObject({ Reference: 'R11192TM3', Website: 'amazon.com' });
  });
});

