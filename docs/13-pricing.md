# Pricing Recommendations

## Pricing philosophy

Three principles drive these numbers:
1. **Anchor to the cost of the problem, not the cost of AI tokens.** A single missed lead is often worth $200-$2,000+ in lifetime value to a plumber or roofer. Pricing at $49-$399/month is trivially justified by preventing *one* lost job a month — we price against value delivered, not against our compute cost (though we still track compute cost closely, per `06-ai-agent-architecture.md`, to protect margin).
2. **Low-friction entry, expensive exit.** The free teaser report removes all risk from trying the product. Once someone is in the dashboard watching their score trend over weeks, canceling feels like losing visibility into their own business — that stickiness is the real retention driver, not contract lock-in.
3. **A one-time option for the price-sensitive, a subscription for the serious.** Home service owners are used to one-time payments (a report, an audit) more than SaaS subscriptions. Offering both meets people where they are and creates a natural upgrade path.

## Recommended tiers

| | **Free** | **Starter** | **Growth** | **Agency** |
|---|---|---|---|---|
| Price | $0 | $49/mo | $149/mo | $399/mo |
| Businesses tracked | 1 (teaser only) | 3 | 10 | 50 |
| Scan frequency | One-time | Monthly | Weekly | Weekly |
| Full report + PDF | ✗ (locked) | ✓ | ✓ | ✓ |
| Score history/trends | ✗ | ✓ | ✓ | ✓ |
| Email alerts | ✗ | ✓ | ✓ | ✓ |
| Competitor comparison | Teaser only | ✓ | ✓ | ✓ |
| Team seats | 1 | 1 | 3 | Unlimited |
| API access | ✗ | ✗ | ✗ | ✓ |
| White-label PDF branding | ✗ | ✗ | ✓ | ✓ |
| Support | — | Email | Email, priority | Priority + onboarding call |

**One-time option:** "Single Report" — $29 one-time for a full unlocked report + PDF on one business, no subscription. This exists specifically to capture the visitor who wants one answer right now and isn't ready to commit monthly — a common pattern for a very-online-averse audience like contractors. It also functions as a natural upsell moment ("upgrade to Growth for ongoing monitoring, only $120 more than 4 one-time reports").

## Why these specific numbers

- **$49 Starter** sits below what a single lead is typically worth, making it a "why not" purchase for a solo owner-operator.
- **$149 Growth** is the expected center of gravity — priced for a business running real marketing spend (they're already paying $500-$3,000/mo on ads or an agency retainer; $149 for ongoing visibility into whether that spend is working is easy to justify) and where weekly monitoring (vs. monthly) meaningfully matters.
- **$399 Agency** targets marketing agencies and franchise/multi-location operators managing many businesses at once — priced per the value of *their* client relationships, not per our cost, and gated by the features (API, white-label, seats) that specifically matter to that buyer, not the home service owner.
- Free tier's entire job is top-of-funnel lead generation for Starter/Growth — it should never feel crippled or fake, just *incomplete* (a real, correct score and grade, a real top issue or two) so trust is established before the paywall.

## Metrics to watch once live (feed back into pricing over time)

- Free → paid conversion rate (target to calibrate against once we have data; industry SaaS benchmarks for this kind of freemium motion are typically 2-5%).
- Starter → Growth upgrade rate (a strong signal the value ladder is working).
- Churn by tier — if Starter churns fast, the monthly-only scan frequency may be too thin a value prop; that's a signal to revisit, not guess about upfront.
- One-time-report → subscription conversion rate, to judge whether the $29 tier is a funnel or a leak.

Pricing is a hypothesis, not a permanent decision — we ship these numbers, watch the metrics above starting at M6, and adjust deliberately rather than guessing twice.
