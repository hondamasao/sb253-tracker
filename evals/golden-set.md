# Golden set

Ten real small-business sites spanning trades and quality tiers, used to measure report quality over time.

**Why the reasoning is committed alongside the URLs.** A golden set that can be quietly re-chosen is not a measurement instrument — it's a way to make a number go up. If a site can be swapped out because it scores badly, the aggregate stops meaning anything and the whole harness becomes theatre. So each row records *why* that site is in the set, and the rule is: **a site may only be removed if the recorded reason has stopped being true** (it went offline, it was rebuilt, it stopped being representative of its tier). Removing a site because the score is inconvenient is the failure mode this file exists to prevent. Any change to this table should be a reviewable commit that says which reason expired.

## Status: URLs not yet chosen

The table below is a **specification of what the set must contain**, not a filled-in list. The sites have not been selected, because the environment this milestone was built in cannot reach arbitrary external hosts (see the "unverified" section of `docs/19-m1c-security-and-evaluation.md`). Choosing ten real URLs without being able to load them would mean inventing plausible-looking domains — a fabricated golden set is worse than an empty one, because it looks finished.

Fill the URL column in on a machine with network access, then:

```bash
npm run capture -- <url> --out fixtures/golden/<slug>.json   # once per site
npm run evals -- --dir fixtures/golden --label baseline
```

## Required composition

Ten sites, meeting all of these constraints simultaneously:

| # | Trade | Quality tier | What this row is here to catch |
|---|-------|--------------|--------------------------------|
| 1 | Plumbing | **Deliberately bad** | The floor case. Expect no HTTPS or a broken certificate, a placeholder title, no meta description, no visible phone number. If the report cannot produce specific, severe, correct findings here, nothing else in the set matters. |
| 2 | Plumbing | Mid | The modal customer: a competent template site with real content and unforced errors. Most paying users will look like this row, so it carries the most weight on "would you pay $29". |
| 3 | HVAC | **Genuinely good** | The ceiling case, and the most important guard against false positives. A site doing nearly everything right must produce *few* findings and say so plainly (docs/16 Rule 5.6). A report that invents problems here is failing in the most damaging possible way — it destroys trust with the customers most likely to notice. |
| 4 | HVAC | Mid | Cross-checks that trade-specific framing (manufacturer certifications, maintenance plans) actually differs from the plumbing rows rather than being generic advice with a noun swapped. |
| 5 | Roofing | Low-mid | High-ticket trade where trust signals and proof of past work dominate. Catches a Trust & Credibility agent that treats every trade identically. |
| 6 | Roofing | Mid-high | Pairs with #5 to show the score actually separates two sites in the same trade — if these land within a point of each other, the scoring is not discriminating. |
| 7 | Electrical | Mid | Licensing is the dominant trust factor. Checks that the report reaches for the right trade-specific lever. |
| 8 | Any trade | **Single-page site** | Structural edge case. Most crawl signal comes from having several pages; a one-page site must still yield a useful report rather than five findings that all say "you only have one page". |
| 9 | Any trade | **JS-heavy / builder platform** (Wix, Squarespace, or similar) | The crawler sees server-rendered HTML only. This row makes visible how much a client-rendered site degrades evidence quality — and whether the report honestly reports less rather than confidently reporting wrong. |
| 10 | Any trade | Mid, **non-English or heavily regional** | Guards against a report whose "specificity" is really just pattern-matching American English marketing copy. |

## Selection rules

- **Real, currently-operating small businesses.** Not agency showcase sites, not templates, not our own fixtures.
- **Independent operators**, not national franchises — franchise sites are professionally built and unrepresentative of the customer.
- **Check `robots.txt` first.** The crawler honours a disallow and will refuse the scan; a site that blocks us cannot be in the set.
- **Record the capture date.** Sites change. A scorecard is only comparable to another scorecard captured from the same bundles, which is why bundles are committed rather than re-crawled per run.
- **No site the prompts were tuned against.** If a site was used while iterating, it is a training example, not a test case, and it must not count toward the reported score.

## Tier definitions

Assigned at selection time from what is visible, **before** any report is generated — otherwise the tier is just an echo of the score and proves nothing.

- **Deliberately bad** — missing or broken HTTPS, placeholder/default titles, no meta descriptions, no visible phone number, effectively no structured data.
- **Low-mid** — real content, but several obvious gaps (missing meta descriptions, no schema, weak or absent CTAs).
- **Mid** — a competent template site: titles and descriptions present, phone number visible, some trust signals, unremarkable speed.
- **Mid-high** — the above plus structured data, a fast mobile score, and clear service-specific pages.
- **Genuinely good** — fast, fully marked up, explicit licensing/insurance, strong CTAs, service-specific pages. Should score in the 80s or 90s and yield few findings.
