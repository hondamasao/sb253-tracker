# Future Expansion Ideas

These are deliberately **not** planned in milestone-level detail (see note at the bottom of `09-milestones.md`) — they're a captured brainstorm so good ideas aren't lost, to be prioritized later using real usage data from M0-M9 instead of guesses. Grouped by the kind of value they add.

## Deepen the core product
- **Google Business Profile OAuth connection**: instead of only reading public GBP data, let the business owner connect their real GBP account. Unlocks first-party data (accurate, private metrics) and, more importantly, lets GrowthOS *act* — auto-post updates, respond to reviews, fix listing errors directly. This turns GrowthOS from purely diagnostic to partially execution-capable, a meaningfully bigger value proposition.
- **Review-response AI**: draft (and optionally auto-post, with approval) responses to new Google/Facebook reviews in the business's voice.
- **Industry benchmark database**: as scan volume grows, we accumulate real comparative data ("you're in the bottom 20% of plumbers in Texas for mobile speed"). This is a durable competitive moat — a new competitor starting today can't replicate years of accumulated benchmark data, and it makes every report more credible and specific over time.
- **"Marketplace of fixers"**: connect a business with vetted freelancers/agencies who can implement the recommended fixes (GrowthOS takes a referral fee or lead-gen fee). Turns the product from advisory into a full loop, and is a strong second revenue line.

## Expand who it serves
- **White-label for agencies**: agencies rebrand GrowthOS reports as their own (custom logo/domain/colors) to use in sales pitches or as an ongoing client deliverable — high-value for the Agency tier and a strong justification for raising that tier's price over time.
- **Multi-location / franchise support**: bulk-scan and roll-up reporting across dozens/hundreds of locations under one brand, with location-level and brand-level dashboards.
- **Expand beyond home services**: once the agent architecture and scoring rubrics are proven, the same engine (with retuned prompts/weights) could serve other local-service verticals (dentists, auto repair, salons, law firms). This is intentionally *not* v1 scope (per the SRD's non-goals) because trying to be generic from day one would make every category shallower and less trustworthy — but the architecture (agents driven by industry-specific config, per `06-ai-agent-architecture.md`) is built so this expansion is a configuration change, not a rewrite.
- **Multi-language support**: for Spanish-speaking-market home service businesses in the US, and eventually international expansion.

## Deepen distribution / stickiness
- **Native integrations**: Zapier, GoHighLevel, HubSpot — many home-service marketing agencies already live in GoHighLevel specifically, so a direct integration could be a significant channel.
- **Native mobile app**: mainly for push alerts (score drops, scan complete) rather than a full mobile experience — a lightweight companion to the web app, not a v1 priority given responsive web already covers the core need.
- **Public "growth score" badge**: an embeddable badge ("GrowthOS Verified — Score: 92") a business can put on their own site once they hit a high score — free viral distribution, similar to trust-badge patterns used by security/reviews products.

## Business model extensions
- **Usage-based add-ons**: extra businesses beyond a plan's limit billed à la carte instead of forcing a full tier upgrade — reduces friction for agencies with an odd number of clients.
- **Annual billing discount**: standard SaaS lever for improving cash flow and reducing churn, straightforward to add once monthly plans are proven (Stripe supports this natively, low engineering cost).

## A guardrail for this list

Every item here should be re-evaluated against real signal before being scheduled: support requests, churn interviews, and the funnel metrics defined in `13-pricing.md`. The temptation with a list like this is to build the exciting stuff (GBP OAuth, marketplace) before the boring stuff (a report that's simply accurate and a checkout flow that works) is fully proven — we explicitly resist that ordering.
