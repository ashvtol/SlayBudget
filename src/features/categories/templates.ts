import { PALETTE } from './palette';

const [red, orange, amber, brown, ochre, yellow, green, teal, blue, indigo, violet, purple, magenta, pink, grey] = PALETTE;

/** Ready-made categories offered by the "+" menu (names in the spirit of Copilot's list). */
export const TEMPLATES: { name: string; emoji: string; color: string }[] = [
  { name: 'Bars & Nightlife', emoji: '🍸', color: violet },
  { name: 'Beauty', emoji: '💄', color: pink },
  { name: 'Car', emoji: '🚗', color: red },
  { name: 'Children', emoji: '🧸', color: ochre },
  { name: 'Clothing', emoji: '👕', color: blue },
  { name: 'Coffee', emoji: '☕', color: brown },
  { name: 'Donations', emoji: '🤝', color: amber },
  { name: 'Education', emoji: '📘', color: indigo },
  { name: 'Entertainment', emoji: '🎟️', color: red },
  { name: 'Gifts', emoji: '🎁', color: magenta },
  { name: 'Groceries', emoji: '🥑', color: green },
  { name: 'Gym', emoji: '💪', color: orange },
  { name: 'Healthcare', emoji: '💊', color: pink },
  { name: 'Home', emoji: '🏠', color: blue },
  { name: 'Insurance', emoji: '☂️', color: purple },
  { name: 'Loans', emoji: '💰', color: ochre },
  { name: 'Personal Care', emoji: '🧴', color: yellow },
  { name: 'Pets', emoji: '🐶', color: green },
  { name: 'Recreation', emoji: '🎳', color: teal },
  { name: 'Rent', emoji: '🔑', color: amber },
  { name: 'Restaurants', emoji: '🍔', color: orange },
  { name: 'Shopping', emoji: '🛍️', color: purple },
  { name: 'Sports', emoji: '⚽', color: green },
  { name: 'Subscriptions', emoji: '💳', color: grey },
  { name: 'Transportation', emoji: '🚆', color: teal },
  { name: 'Travel', emoji: '✈️', color: indigo },
  { name: 'Utilities', emoji: '💡', color: yellow },
];
