# AI Agent Architecture

## The core pattern: orchestrator + specialist agents + synthesis

It would be tempting to send one giant prompt to one AI model: "here's a website, write me a full growth report." We deliberately don't do that, for reasons that matter a lot once real money and thousands of users are involved:

1. **Accuracy.** Some categories (performance, technical SEO, accessibility) have objectively correct answers computable from real data (Google's PageSpeed API, parsed HTML). Asking an LLM to "guess" a Core Web Vitals score from a screenshot produces plausible-sounding nonsense. We only use AI for the categories that genuinely require judgment (copywriting quality, trust signal detection, competitor narrative) and use deterministic code + real APIs everywhere else.
2. **Cost.** A single mega-prompt with the entire site's HTML plus 15 categories of instructions is enormous (expensive) and gets worse (and more expensive) as the site grows. Small, focused agents send only the data each specific task needs.
3. **Debuggability.** When a report says something wrong, we need to know exactly which of the 16 categories produced it and re-run just that one — not re-run and re-pay for the whole analysis.
4. **Reliability.** If one category's data source is down (e.g., a SERP API outage), the other 15 still succeed and the report ships with one category flagged "temporarily unavailable" instead of the whole scan failing.

So the architecture is three layers:

```
                    ┌─────────────────────────┐
                    │   Scan Orchestrator      │   (Inngest function, run-scan.ts)
                    │  1. Crawl target site    │
                    │  2. Fan out to 16 agents │
                    │  3. Wait for all         │
                    │  4. Run Synthesis Agent  │
                    │  5. Save report + PDF    │
                    └───────────┬──────────────┘
                                │ parallel fan-out
        ┌───────────┬───────────┼───────────┬───────────┐
        ▼           ▼           ▼           ▼           ▼
  Performance   Technical   ...(13 more)  AI Search    Social
    Agent      SEO Agent      Agents        Agent      Agent
        │           │           │           │           │
        └───────────┴───────────┼───────────┴───────────┘
                                ▼
                     Each returns: { score, findings[] }
                                │
                                ▼
                    ┌─────────────────────────┐
                    │    Synthesis Agent        │  (1 LLM call, sees ALL agent outputs)
                    │  - overall score/grade    │
                    │  - executive summary      │
                    │  - prioritized checklist  │
                    │  - lost-lead estimate     │
                    │  - monthly action plan    │
                    └─────────────────────────┘
```

## The shared agent contract

Every agent in `agents/` (see `04-folder-structure.md`) implements the same interface, so the orchestrator can run them uniformly and adding a 17th category later doesn't require touching orchestration code:

```ts
// agents/types.ts
type AgentContext = {
  scanId: string;
  businessId: string;
  websiteUrl: string;
  crawledPages: CrawledPage[];   // pre-fetched HTML, shared across agents so we crawl once, not 16 times
  industry: string;
  location: { city: string; state: string };
};

type Finding = {
  category: string;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  description: string;
  recommendation: string;
  effortLevel: "low" | "medium" | "high";
  beforeExample?: string;
  afterExample?: string;
};

type AgentResult = {
  score: number;        // 0-100
  findings: Finding[];
  raw: Record<string, unknown>;  // full detail for debugging/re-synthesis
};

type Agent = {
  type: string;
  run: (ctx: AgentContext) => Promise<AgentResult>;
};
```

**Why crawl once, not 16 times:** The orchestrator's first step fetches the target site's key pages (home, contact, service pages found via sitemap/nav — capped at ~10 pages) a single time and passes the parsed HTML/text to every agent that needs it via `AgentContext.crawledPages`. This alone is a major cost and speed optimization: we don't want 16 agents each independently re-downloading the same site.

## Agent-by-agent breakdown

| Agent | Type | Primary data source | Uses an LLM? |
|---|---|---|---|
| Performance | Deterministic | Google PageSpeed Insights API | No |
| Technical SEO | Deterministic + light AI | Parsed HTML (meta tags, headings, sitemap.xml, robots.txt) | Only to phrase recommendations |
| Local SEO | Deterministic + light AI | Parsed HTML + NAP (name/address/phone) consistency check against Google listing | Only to phrase recommendations |
| Mobile | Deterministic | PageSpeed mobile category + viewport/tap-target checks | No |
| Google Business Profile | Deterministic | SERP data provider (Google Maps listing data) | Only to phrase recommendations |
| Accessibility | Deterministic | `axe-core` automated ruleset run against crawled pages | No |
| Conversion optimization | AI-assisted | Parsed HTML (forms, phone CTAs, booking widgets) | Yes — judgment on friction |
| Copywriting | AI | Extracted page text | Yes — the core task |
| Calls to action | AI-assisted | Parsed HTML + extracted text | Yes — judgment on clarity/placement |
| Trust signals | AI-assisted | Extracted page text (licenses, guarantees, years in business) | Yes — pattern recognition in free text |
| Reviews | Deterministic | SERP/reviews data provider (Google rating, count, recency) | Only to phrase recommendations |
| Competitor comparison | Deterministic + AI | SERP data provider (auto-identify 2–3 local competitors), re-run a lightweight scoring pass on each | Yes — narrative comparison |
| AI Search optimization | AI (the data source *is* AI) | Live prompts to OpenAI, Claude, and Gemini asking real local-intent questions ("best plumber in [city]") and checking if/how the business appears | Yes — this category tests AI models directly |
| Social presence | Deterministic | Parsed HTML (linked profiles) + lightweight profile activity check | Only to phrase recommendations |
| Missing pages | Deterministic | Sitemap/nav crawl vs. expected page checklist for the industry | Only to phrase recommendations |
| Lead generation opportunities | AI-assisted | Parsed HTML + all above findings | Yes — cross-category judgment |

"Only to phrase recommendations" means: the underlying finding is computed deterministically (fast, cheap, 100% consistent), and a lightweight LLM call (GPT-4o-mini) turns the raw fact into a plain-English sentence a non-technical business owner understands. This keeps most of the report's *substance* deterministic and trustworthy while still reading as if written by a smart human.

## Model selection strategy (cost control)

| Task | Model | Why |
|---|---|---|
| Phrasing a deterministic finding into plain English | GPT-4o-mini | Cheap, fast, the task is simple templating-with-judgment |
| Copywriting/CTA/trust-signal judgment on real page text | GPT-4o-mini, escalate to GPT-4o if confidence is low | Balances cost with the need for real reading comprehension |
| AI Search optimization checks | Live calls to GPT-4o, Claude Sonnet, and Gemini (the product literally must ask each one) | This is the one category where using multiple real models is the point, not a cost tradeoff |
| Synthesis Agent (executive summary, prioritization, action plan) | Claude Sonnet | This is the highest-stakes single output in the whole report — the part a business owner reads first — so it gets our best writing model, run once per scan (not 16 times), keeping the cost of using a stronger model negligible |

Every AI call is wrapped with: a token/cost logger (written to `agent_runs.cost_usd`), a timeout, and a retry-once-then-degrade-gracefully policy (if an agent ultimately fails, its category shows "temporarily unavailable" in the report rather than failing the whole scan — per NFR reliability requirement in the SRD).

## The Synthesis Agent, specifically

Input: the structured `AgentResult` (score + findings) from all 16 agents — not raw HTML, keeping this final, most-expensive call small and focused.

Output (validated against a Zod schema before saving — we never trust raw LLM JSON blindly):
```ts
{
  overallScore: number,
  letterGrade: "A" | "B" | "C" | "D" | "F",
  executiveSummary: string,
  estimatedLostLeads: { min: number, max: number },
  prioritizedChecklist: Array<{ findingRef: string, priorityRank: number }>,
  monthlyActionPlan: { month1: string[], month2: string[], month3: string[] }
}
```

The **overall score** itself is *not* left to the LLM to invent — it's computed deterministically as a weighted average of category scores (weights tuned per industry, e.g., "local SEO" weighs more for a plumber than "social presence"), defined in `lib/scoring/calculate-overall-score.ts`. The LLM's job is narrative and prioritization, not arithmetic — this guarantees two scans of a similar-quality site produce comparable scores, which matters enormously for user trust and for the score-history trend feature.

## Cost & reliability guardrails

- Every scan's total cost (sum of `agent_runs.cost_usd`) is logged and visible in the admin dashboard (FR-26) so margin is never a mystery.
- Google PageSpeed and SERP-provider results are cached (Upstash Redis, ~6-hour TTL) since re-scanning the same site minutes apart shouldn't re-pay for external API calls.
- A per-IP and per-account rate limit on anonymous scans (Upstash) prevents the free teaser flow from being used to run unlimited free AI workloads.
- Agents run with a hard timeout (e.g., 20s each); a slow/failing external API degrades that one category instead of blocking the entire report.
