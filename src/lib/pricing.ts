/**
 * Reference cloud API prices for the Study activity "Cloud comparison".
 *
 * Standard (non-batch, uncached, short-prompt) list prices per 1 million tokens,
 * copied from each provider's official pricing page on the date shown. Prices
 * change: update this list and its dates, never guess. Time-limited rates carry
 * `validFrom` / `validUntil`, and an expired rate gives "Estimate unavailable".
 */
export interface ReferencePrice {
  id: string;
  provider: string;
  model: string;
  currency: "USD";
  inputPerMillion: number;
  outputPerMillion: number;
  pricingDate: string; // when the price was checked
  source: string;
  validFrom?: string;
  validUntil?: string;
}

export const REFERENCE_PRICES: ReferencePrice[] = [
  { id: "anthropic-claude-sonnet-4-6", provider: "Anthropic", model: "Claude Sonnet 4.6", currency: "USD", inputPerMillion: 3, outputPerMillion: 15, pricingDate: "2026-11-24", source: "https://platform.claude.com/docs/en/about-claude/pricing" },
  { id: "anthropic-claude-haiku-4-5", provider: "Anthropic", model: "Claude Haiku 4.5", currency: "USD", inputPerMillion: 1, outputPerMillion: 5, pricingDate: "2026-11-24", source: "https://platform.claude.com/docs/en/about-claude/pricing" },
  { id: "openai-gpt-6-luna", provider: "OpenAI", model: "GPT-6 Luna", currency: "USD", inputPerMillion: 0.1, outputPerMillion: 0.5, pricingDate: "2026-11-24", source: "https://developers.openai.com/api/docs/pricing" },
  { id: "openai-gpt-6-1-terra", provider: "OpenAI", model: "GPT-6.1 Terra", currency: "USD", inputPerMillion: 1, outputPerMillion: 5, pricingDate: "2026-11-24", source: "https://developers.openai.com/api/docs/pricing" },
  { id: "google-gemini-4-argon", provider: "Google", model: "Gemini 4 Argon", currency: "USD", inputPerMillion: 2, outputPerMillion: 10, pricingDate: "2026-11-24", source: "https://ai.google.dev/gemini-api/docs/pricing", validUntil: "2026-11-30" },
  { id: "google-gemini-4-argon", provider: "Google", model: "Gemini 4 Argon", currency: "USD", inputPerMillion: 4, outputPerMillion: 20, pricingDate: "2026-11-24", source: "https://ai.google.dev/gemini-api/docs/pricing", validFrom: "2026-12-01" },
];

/** Reference models to choose from (one entry per model). */
export const REFERENCE_MODELS = [...new Map(REFERENCE_PRICES.map((p) => [p.id, { id: p.id, label: `${p.provider} · ${p.model}` }])).values()];

/** The price that applies on `date` (YYYY-MM-DD), or null if none is known. */
export function priceFor(id: string, date: string): ReferencePrice | null {
  return REFERENCE_PRICES.find((p) => p.id === id && (!p.validFrom || date >= p.validFrom) && (!p.validUntil || date <= p.validUntil)) ?? null;
}

export interface CloudEstimate {
  amount: number;
  price: ReferencePrice;
}

/**
 * Estimated cloud API equivalent: separate input and output rates. Returns null
 * ("Estimate unavailable") when usage or a current reference price is missing.
 * Local token counts are an approximation of what a cloud tokenizer would count.
 */
export function estimateCloudCost(inputTokens: number | null, outputTokens: number | null, priceId: string | null, date: string): CloudEstimate | null {
  if (!priceId || inputTokens === null || outputTokens === null) return null;
  if (inputTokens === 0 && outputTokens === 0) return null;
  const price = priceFor(priceId, date);
  if (!price) return null;
  const amount = (inputTokens / 1e6) * price.inputPerMillion + (outputTokens / 1e6) * price.outputPerMillion;
  return { amount, price };
}

export function formatMoney(amount: number, currency = "USD") {
  const digits = amount > 0 && amount < 0.01 ? 4 : 2;
  return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amount);
}
