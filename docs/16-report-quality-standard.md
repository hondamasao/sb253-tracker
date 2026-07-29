# Report Quality Standard

**Purpose of this document:** every other doc in `docs/` explains how the report gets built. This one defines what "built correctly" means — the bar the AI agents' prompts (M1) and the Synthesis Agent must clear before a report is allowed to reach a paying customer. If a finding in the report couldn't pass the checks in this document, it doesn't ship, no matter how technically correct the underlying score is.

This is the single most important document for whether GrowthOS is a real business or a novelty. The architecture in `docs/01-14` and the scope cuts in `15-mvp-scope-and-m0-plan.md` can be exactly right and the product still fails if the report itself reads like generic AI filler. This doc exists so that risk is designed against from the start, not discovered after the first refund request.

## 1. The customer's problem we are solving

A home service business owner does not wake up wanting "an SEO audit." They wake up wanting more calls to ring their phone. Today, they have three bad options:

1. **Do nothing** — because they don't know what's wrong, so there's nothing concrete to act on.
2. **Hire an agency on faith** — pay $500-$3,000/month for a vague retainer with no proof anything is actually broken, and no way to verify the agency's work is worth the money.
3. **Use a marketer's tool** (Ahrefs, SEMrush, generic "website grader" tools) — built for people who already understand SEO/marketing jargon, returns 40 metrics with no indication of which 3 actually matter for a 6-person plumbing company in Ohio.

**The specific problem GrowthOS solves:** turn "something is wrong with my website but I don't know what" into "here are the 5 specific things costing me the most calls, in order, with exactly what to do about each one" — in language a busy business owner with no marketing background can act on in the next 30 minutes, without hiring anyone.

If a report doesn't do that, it doesn't matter how many categories it scored — it hasn't solved the actual problem, and $29 was not well spent.

## 2. What a business owner should understand after reading the report

After reading their report, the owner should be able to answer all five of these, unprompted:

1. **"Is my website actually working for me or against me?"** — a single clear score/grade they can hold in their head.
2. **"What's the single biggest thing wrong?"** — not a list of 20 equally-weighted issues; one clear top problem.
3. **"Why does that actually cost me money?"** — connected to leads/calls/jobs, not abstract metrics like "Core Web Vitals."
4. **"What do I do about it, specifically?"** — concrete enough to either do it themselves in an afternoon or hand verbatim to a $30/hour freelance developer without further explanation.
5. **"Was this actually about MY business, or could I have gotten this from any website checker?"** — every report must feel personally investigated, not templated.

If an owner finishes the report and still has to ask "okay, so what do I actually do Monday morning?" — the report has failed regardless of how accurate its scores were.

## 3. Required report sections

Every delivered report (web view and PDF) contains these sections, in this order. No section is optional; a section with nothing significant to report still appears, explicitly stating that (see Rule 5.6).

1. **Header** — business name, website URL, scan date, overall score, letter grade. This is the "wow, this was made for me" moment; it must be unmistakably about their specific business, front and center.
2. **Executive summary** (3-5 sentences) — plain-English narrative naming the single biggest problem, its estimated cost in leads, and the overall trajectory ("your site is solid on mobile but is actively losing calls because...").
3. **Category score breakdown** — the 7 MVP categories (Performance, Mobile, Accessibility, Technical & Local SEO, Content & Trust, AI Search Optimization, Site Completeness), each with a score and one-line plain-English translation of what that score means.
4. **Estimated lost leads** — a stated range (e.g., "14-22 leads/month"), with a one-line note on how it's estimated (severity of issues × industry benchmark conversion assumptions) and a clear "estimate, not a guarantee" disclaimer, per `01-srd.md` FR-5. **Amendment (M1b):** omitted entirely from the report for now, per explicit instruction — the same treatment this document already gives "Competitor snapshot" below. A number here without real industry-benchmark research behind it would itself be an ungrounded claim, which is exactly what Rules 5.3/5.4 exist to prevent. Revisit once that research exists; see `docs/18-m1b-ai-agent-architecture.md`.
5. **Prioritized checklist** — every finding, ranked by priority (impact vs. effort), numbered 1 to N. This is the single most-used section — an owner should be able to work top-to-bottom and know they're always doing the highest-value thing next.
6. **Findings detail** — the full structured breakdown of each finding (see Section 6), grouped by category.
7. **Before/after example** — at least one real rewrite of actual copy pulled from their site (never a generic example), showing the Content Quality agent's work concretely.
8. **Competitor snapshot** *(if available — see note)* — reserved for post-MVP per `15-mvp-scope-and-m0-plan.md`; omitted entirely from the MVP report rather than shown as a stub or placeholder.
9. **Monthly action plan** — Month 1 / Month 2 / Month 3, each with 2-4 items pulled from the prioritized checklist, so the owner has a pace, not just a pile.
10. **Methodology footer** — what was checked, as of what date, and the standard disclaimer that AI Search results are a snapshot (per `01-srd.md` §8) and that this is diagnostic guidance, not a guarantee of results.

## 4. Weak AI-generated findings vs. strong actionable findings

This is the difference between a report worth $29 and a report that gets a refund request. Weak findings are the default output of a lightly-prompted LLM; strong findings require the finding to be grounded in actual evidence pulled from the specific site (see Section 5's rules for how this is enforced).

| # | ❌ Weak (generic, could apply to any site) | ✅ Strong (specific, provably about this business) |
|---|---|---|
| 1 | "Your website could benefit from improved SEO practices." | "Your homepage title tag is 'Home — Welcome to Our Website.' It doesn't mention 'plumber' or your service area, so Google has no reason to show you for 'plumber near me' searches in Dayton." |
| 2 | "Consider adding more calls to action to improve conversions." | "Your Contact page has a form but no phone number anywhere above the fold. 73% of home service searches are made from mobile, where tapping a phone number converts far better than filling out a form — add a tap-to-call button in your header." |
| 3 | "Your website is not optimized for mobile devices." | "On a mobile phone, your main navigation menu (Services, About, Contact) requires 3 taps to reach the Emergency Service page. Your PageSpeed mobile score is 41/100, largely from a 4.2MB unoptimized hero image on your homepage." |
| 4 | "Build trust signals to reassure potential customers." | "Nowhere on your site does it mention that you're licensed and insured — a make-or-break trust factor for HVAC work inside someone's home. Your competitor [X] displays 'Licensed, Bonded & Insured — TACLA#12345' in their footer on every page." |
| 5 | "Improve your content quality and messaging." | "Your Services page describes what you do ('We install and repair HVAC systems') but never states why a customer should choose you over another HVAC company. Add your specific differentiators: same-day service, 24/7 emergency line, or a satisfaction guarantee, if you offer them." |
| 6 | "Your business may not be well-represented in AI search results." | "When asked 'who is a good roofer in [city]', ChatGPT and Claude did not mention your business by name, but did mention two competitors who have more detailed, keyword-specific service pages (e.g., 'Storm Damage Roof Repair in [city]') than your single generic 'Roofing Services' page." |

**What makes the strong column strong, mechanically:**
- Names a specific element, number, or piece of text found on the actual site.
- Names the actual consequence in terms a business owner cares about (calls, trust, being found), not a technical metric alone.
- Is falsifiable — a human could go check the site and confirm or deny the claim, because it's specific enough to check.

## 5. Rules to prevent generic recommendations

These rules are enforced in agent prompts (M1) and validated at the Synthesis Agent stage before a report is allowed to save as "completed." A finding that fails any of these does not ship.

1. **The "any business" test.** Before a finding is included, it must fail this test: *"If I deleted the business name and URL, could this sentence be copy-pasted unchanged into a report for a completely different business in a different trade?"* If yes, the finding is too generic and must either be made specific (by pulling in an actual quote, number, or element from the crawled site) or dropped.
2. **Evidence must be quotable.** Every finding's "Evidence" field (Section 6) must contain something that was actually observed in `agent_runs.raw_output` for that scan — an actual title tag, an actual PageSpeed number, an actual sentence of copy, an actual missing page. Agents are never permitted to assert something they didn't check. If an agent lacks the data to support a specific claim, it omits the finding rather than writing a vague one.
3. **No unearned superlatives or filler phrases.** Findings and the executive summary may not use stock filler regardless of whether it's technically true — banned phrases include (non-exhaustive, expand this list as it's caught in QA): *"could benefit from," "consider optimizing," "in today's digital age," "it's important to," "may want to look into," "take your business to the next level," "unlock your full potential."* These phrases are a strong signal the model is padding rather than reporting a specific observation.
4. **Numbers must be the business's own numbers.** A finding referencing a load time, a score, a page count, or a review count must use the number this specific scan produced — never an example/placeholder number reused from a template or from another trade's typical benchmark.
5. **Recommendations must be executable, not directional.** "Improve your images" is directional. "Compress `hero.jpg` (currently 2.4MB) using a tool like TinyPNG or Squoosh, and add a `width`/`height` attribute to prevent layout shift" is executable. The test: could a competent freelance developer complete the recommendation from the text alone, with no follow-up question?
6. **A category with nothing significant wrong says so, explicitly and specifically.** "No significant issues found — your site has a clear phone number in the header, a booking widget on your Services page, and live chat enabled" is a valid, valuable finding. Silence, or a fabricated minor nitpick invented just to fill space, is not — inventing a weak finding to avoid an empty section is exactly the kind of padding this document exists to prevent.
7. **Trade-specific context is mandatory, not optional flavor.** A finding about trust signals for a roofer must reference roofing-specific trust factors (licensing, insurance, storm/insurance-claim handling), not generic "credibility" language — see Section 8 for the reference set per trade. The Content Quality, Site Completeness, and Synthesis agents receive the detected `industry` (per `businesses.industry` / MVP's scan input) specifically so recommendations can be trade-aware rather than trade-blind.
8. **Consistency across the report is checked, not assumed.** The Synthesis Agent must not produce an executive summary that contradicts a category finding (e.g., praising "strong calls to action" in the summary while a finding elsewhere flags "no phone number visible"). This is checked as part of Section 7's pre-delivery checklist.

## 6. How each finding is structured

Every finding in `findings` (per `03-database-schema.md` / `15-mvp-scope-and-m0-plan.md`) is generated against this exact 5-part structure. An agent producing a finding that's missing any of these fields has produced an incomplete finding, not a shippable one.

| Field | Requirement | Bad example | Good example |
|---|---|---|---|
| **Problem** | One sentence, plainly stating what's wrong — no jargon without a plain-English translation alongside it. | "Poor LCP score." | "Your homepage takes 5.8 seconds to become usable on a phone — most visitors give up before that." |
| **Why it matters** | Connects the problem to leads/calls/trust/money, in the customer's terms, not ours. | "This affects your Core Web Vitals." | "Every extra second of load time on mobile is a customer who taps back to Google and calls the next plumber on the list instead." |
| **Evidence** | The specific, quotable fact from this scan that proves the problem is real (ties back to Rule 5.2). | "Your site is slow." | "PageSpeed Insights (mobile) measured your homepage's Largest Contentful Paint at 5.8s; Google considers anything over 2.5s poor." |
| **Recommended action** | Specific and executable (ties back to Rule 5.5) — named files, named elements, named tools where relevant. | "Optimize your images." | "Compress and resize the 3.1MB `hero-banner.jpg` on your homepage — a tool like Squoosh.app can typically cut this to under 300KB with no visible quality loss." |
| **Expected impact** | Plain-language, appropriately hedged estimate of what fixing it is worth — tied to the same lost-lead estimation logic as the report-level number in Section 3.4, at the individual-finding level. | "This will help your SEO." | "Faster load time on mobile is one of the most common reasons visitors leave before calling — fixing this is a low-effort, high-impact change." |

This maps directly to the `findings` table's columns (`title`/`description` = Problem, `description` also carries Why it matters, `recommendation` = Recommended action, `estimated_impact`-style content = Expected impact, and the underlying `raw_output` on the parent `agent_runs` row is what Evidence must be traceable back to for auditability).

## 7. Quality checklist before a report can be delivered

This checklist runs (initially by manual human review during early MVP scans — see note below — and progressively automated as patterns solidify) before `reports.is_unlocked` is allowed to flip to `true`. A report failing any item here is not delivered; the scan is either re-run, or a human touches up the specific failing section before send.

- [ ] Business name and URL are correct everywhere they appear (header, PDF filename, email) — no leftover placeholder text, no wrong trade mentioned (e.g., an HVAC company never described using plumbing terminology).
- [ ] Every one of the 7 categories has a score and at least one finding, or an explicit "no significant issues found" statement per Rule 5.6 — never a silently empty category.
- [ ] Every finding has all 5 structure fields from Section 6 populated, and each field meets its individual bar (Evidence is quotable, Recommended action is executable, etc.).
- [ ] No finding or summary sentence uses a banned generic phrase (Rule 5.3) — spot-checked against the running banned-phrase list.
- [ ] Every finding passes the "any business" test (Rule 5.1) — if a QA reviewer can't tell which business a finding is about without the header, it's rejected.
- [ ] The executive summary references at least 3 specific facts that also appear in the findings detail (proves it's a real summary, not a separately-hallucinated paragraph).
- [ ] No contradictions between the executive summary, category scores, and individual findings (Rule 5.8).
- [ ] The overall score and letter grade are consistent with the mix of finding severities (a report with 3 "critical" findings should not carry an "A" grade — checked against the deterministic weighting formula in `06-ai-agent-architecture.md`, not left to the LLM's own arithmetic).
- [ ] The before/after example (Section 3.7) uses real text copied from the actual crawled page, not an invented example.
- [ ] The lost-leads estimate includes its "estimate, not a guarantee" disclaimer. *(N/A for M1b — this section is omitted entirely per the amendment to §3.4 above.)*
- [ ] The prioritized checklist ranking is genuinely ordered by impact-vs-effort, not just by category order.
- [ ] The PDF renders without layout errors, truncated text, or broken characters, and matches the web report's content.
- [ ] Tone throughout is plain-English and professional — no unexplained jargon, no marketing hype, no line a real business owner would need to Google.

**MVP-specific note:** until we've reviewed enough real scans to trust the automated version of this checklist, plan to manually read every report end-to-end before it's sent during the first weeks of M1/M2 testing (per `09-milestones.md` M2's "genuinely useful" bar) — this checklist is exactly what you're checking for during that manual pass, and it's also the seed for the automated eval set described in `10-testing-strategy.md`.

## 8. Trade-specific examples

The same 7-category structure applies to every trade, but what counts as a *strong, specific* finding differs by trade — this is the reference set agent prompts draw from so recommendations are trade-aware (Rule 5.7), not generic.

### Plumbers
- **Trust signals**: Licensing/bonding is table stakes and legally required in most states — a strong finding calls out its absence by name: *"Your site never states a plumbing license number. Most homeowners now expect to see this, and its absence is a common reason people choose a competitor for anything beyond a minor repair."*
- **Content & CTAs**: Emergency availability is a primary purchase driver — *"You offer 24/7 emergency service (per your footer), but it's not mentioned anywhere on your homepage or in your page title. Someone searching '[city] emergency plumber' at 11pm won't know you're an option."*
- **Site completeness**: Service-specific pages convert far better than one generic "Plumbing Services" page — *"You have one page covering drain cleaning, water heater repair, and leak detection. Searches for these are often separate and specific (e.g., 'water heater replacement cost [city]'); a dedicated page per service would let you show up for each of these searches individually."*

### HVAC
- **Trust signals**: Manufacturer certifications carry real weight — *"You mention installing Trane and Carrier systems but don't display their dealer certification badges, which are strong trust signals homeowners specifically look for when comparing HVAC quotes."*
- **Content & CTAs**: Seasonal/maintenance-plan offers are a core HVAC revenue driver, often missing from sites — *"There's no mention of a maintenance plan or seasonal tune-up offer anywhere on your site, despite this typically being a recurring-revenue product for HVAC companies — consider a dedicated page or homepage banner."*
- **AI Search Optimization**: *"When asked about AC repair options in [city], ChatGPT and Claude both cited two competitors who have separate, detailed pages for 'AC Repair,' 'AC Installation,' and 'AC Maintenance Plans' — your single 'Cooling Services' page is less likely to be surfaced for these more specific questions."*

### Roofers
- **Trust signals**: Roofing is a high-ticket, high-trust purchase — insurance/licensing and past work matter more here than almost any other trade — *"There are no project photos or a portfolio anywhere on your site. For a purchase this size, homeowners strongly prefer to see evidence of completed work before requesting a quote."*
- **Content & CTAs**: Storm damage / insurance claim assistance is a major differentiator — *"You don't mention helping with insurance claims for storm damage, which is one of the most common reasons homeowners search for a roofer after a major storm — if you offer this, it should be one of the most visible things on your homepage."*
- **Site completeness**: *"There's no financing information on your site. Roofing jobs commonly run $8,000-$15,000+, and financing availability is frequently a deciding factor — if you offer or partner with a financing option, its absence from your site is a likely lost-lead point."*

### Electricians
- **Trust signals**: Licensing and safety are the primary trust factors — *"Your site doesn't state that you're a licensed master electrician, which is one of the first things homeowners check before letting someone work on their home's electrical system — and it's a strong differentiator most unlicensed handyman competitors can't claim."*
- **Content & CTAs**: Emergency and safety-driven searches convert with urgency — *"'Emergency electrician [city]' is a high-intent search (often literally an active hazard), but your site has no visible emergency phone number or same-day service messaging."*
- **Site completeness**: *"You don't have a dedicated page for EV charger installation, a fast-growing and highly specific search category for electricians. If you offer this service, a dedicated page would let you show up for these increasingly common searches instead of only your general 'Electrical Services' page."*

These examples are the calibration set for prompt-writing in M1 — when an agent's actual output during testing reads more like the "weak" column in Section 4 than these trade-specific examples, that's the signal the prompt needs more work before the report ships.
