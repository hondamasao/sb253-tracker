# Wireframes (ASCII)

Low-fidelity layout sketches — the goal here is structure and hierarchy, not pixels. Visual design (colors, type, spacing) follows the Linear/Stripe/Notion/Vercel-inspired direction: lots of whitespace, one accent color, restrained shadows, large confident numbers for scores.

## 1. Landing page

```
┌──────────────────────────────────────────────────────────────┐
│  GrowthOS                              Pricing   Log in  [Sign up]│
├──────────────────────────────────────────────────────────────┤
│                                                                │
│              Find out why you're losing customers             │
│                        online — in 90 seconds                 │
│                                                                │
│     ┌──────────────────────────────────────┐  ┌───────────┐  │
│     │  yourbusiness.com                     │  │ Get Report │  │
│     └──────────────────────────────────────┘  └───────────┘  │
│           No credit card required · Free instant report        │
│                                                                │
│     [ preview image: report card with big "82  B+" score ]     │
│                                                                │
├──────────────────────────────────────────────────────────────┤
│   How it works                                                │
│   1. Enter your website   2. AI analyzes 16 factors   3. Get  │
│      your action plan                                          │
├──────────────────────────────────────────────────────────────┤
│   What we check: [Performance] [SEO] [Mobile] [GBP]           │
│   [Accessibility] [Conversion] [Reviews] [AI Search] ...       │
├──────────────────────────────────────────────────────────────┤
│   Trusted by 1,200+ home service businesses   [logos/quotes]   │
└──────────────────────────────────────────────────────────────┘
```

## 2. Scan-in-progress

```
┌──────────────────────────────────────────────────────────────┐
│                     Analyzing yourbusiness.com                │
│                                                                │
│                     ●●●●●●●●○○○○○○  62%                       │
│                                                                │
│   ✓ Crawling your website                                     │
│   ✓ Checking page speed & mobile performance                  │
│   ✓ Reviewing Google Business Profile                          │
│   ⟳ Analyzing copywriting & calls to action                    │
│   ○ Checking AI search visibility (ChatGPT, Gemini, Claude)     │
│   ○ Finding local competitors                                  │
│                                                                │
│           This usually takes about a minute.                  │
│      [ optional: email me the link  _______________ ]          │
└──────────────────────────────────────────────────────────────┘
```

## 3. Teaser report (pre-signup)

```
┌──────────────────────────────────────────────────────────────┐
│  yourbusiness.com                                              │
│                                                                │
│        ┌────────────┐                                          │
│        │    82      │   Grade: B+                              │
│        │  / 100     │   You're losing an estimated              │
│        └────────────┘   14-22 leads/month                      │
│                                                                │
│  Top issues found:                                              │
│  🔴 Critical  No phone number visible above the fold             │
│  🟠 High      Missing 6 core service pages                       │
│  🟠 High      Google Business Profile missing photos              │
│                                                                │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
│  ░░  13 more findings, full checklist, competitor        ░░░  │
│  ░░  comparison & downloadable PDF — blurred              ░░░  │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
│                                                                │
│              [ Create free account to unlock report ]          │
└──────────────────────────────────────────────────────────────┘
```

## 4. Full report (unlocked)

```
┌──────────────────────────────────────────────────────────────┐
│  ← Dashboard      yourbusiness.com          [Download PDF]     │
├──────────────────────────────────────────────────────────────┤
│  Overall: 82/100  B+     Est. lost leads: 14-22/mo             │
│                                                                │
│  Category breakdown                                            │
│  Performance      ████████░░ 78     Local SEO      █████░░░ 54 │
│  Technical SEO    ███████░░░ 71     Mobile         █████████ 91│
│  Accessibility    ██████░░░░ 62     Trust Signals   ████░░░░ 45│
│  ...                                                            │
│                                                                │
│  Prioritized checklist                                          │
│  1. [Critical][Low effort]  Add phone number to header          │
│      Before: (no phone visible)  →  After: "Call (555) 123-4567"│
│  2. [High][Medium effort]   Create 6 missing service pages       │
│  3. [High][Low effort]      Add 10 photos to Google Business    │
│  ...                                                             │
│                                                                │
│  Competitor comparison                                          │
│  ┌────────────────┬──────┬──────┬──────┐                        │
│  │                │ You  │ Comp A│ Comp B│                       │
│  │ Overall score  │ 82   │ 91    │ 68    │                       │
│  │ Reviews        │ 4.6★ │ 4.9★  │ 4.1★  │                       │
│  └────────────────┴──────┴──────┴──────┘                        │
│                                                                  │
│  Monthly action plan                                             │
│  Month 1: [ ] Fix critical issues   Month 2: [ ] ...              │
└──────────────────────────────────────────────────────────────┘
```

## 5. Dashboard

```
┌──────────────────────────────────────────────────────────────┐
│  GrowthOS   Dashboard  Businesses  Settings        [+ New scan]│
├──────────────────────────────────────────────────────────────┤
│  Your businesses                                                │
│  ┌────────────────────────┐  ┌────────────────────────┐        │
│  │ Acme Plumbing           │  │ Acme HVAC                │        │
│  │  82  B+   ▲ +4 this mo  │  │  61  D   ▼ -6 this mo    │        │
│  │  Last scan: 2 days ago  │  │  Last scan: 9 days ago    │        │
│  └────────────────────────┘  └────────────────────────┘        │
│                                                                  │
│  Recent activity                                                 │
│  • Weekly scan completed for Acme Plumbing — score up 4 pts     │
│  • ⚠ Score dropped for Acme HVAC — GBP reviews declined           │
└──────────────────────────────────────────────────────────────┘
```

## 6. Business detail (trend view)

```
┌──────────────────────────────────────────────────────────────┐
│  Acme Plumbing                    [Run scan now]  [Weekly ▾]   │
│                                                                  │
│  Score over time                                                 │
│  100│                                              ●             │
│   80│                     ●──────●──────●─────────●             │
│   60│         ●──────●───                                        │
│   40│                                                              │
│      └────────────────────────────────────────────────────       │
│       Jan     Feb     Mar     Apr     May     Jun     Jul         │
│                                                                    │
│  Report history                                                    │
│  Jul 28, 2026   82  B+   [View]  [PDF]                             │
│  Jul 21, 2026   78  B    [View]  [PDF]                             │
│  Jul 14, 2026   76  B-   [View]  [PDF]                             │
└──────────────────────────────────────────────────────────────┘
```

## 7. Pricing page

```
┌──────────────────────────────────────────────────────────────┐
│                     Simple, transparent pricing                 │
│  ┌───────────┐   ┌───────────┐   ┌───────────┐                  │
│  │  Starter  │   │  Growth   │   │  Agency   │                  │
│  │   $49/mo  │   │  $149/mo  │   │  $399/mo  │                  │
│  │ 3 businesses│  │10 businesses││50 businesses│                 │
│  │ Monthly scan│  │Weekly scan  │ │Weekly scan │                  │
│  │            │   │ + 2 seats  │   │+ Unlimited │                  │
│  │            │   │            │   │  seats +API│                  │
│  │ [Choose]   │   │ [Choose]   │   │ [Choose]   │                  │
│  └───────────┘   └───────────┘   └───────────┘                  │
└──────────────────────────────────────────────────────────────┘
```

## 8. Settings — Organization / Billing

```
┌──────────────────────────────────────────────────────────────┐
│  Settings   [Organization] [Billing] [API Keys]                 │
│                                                                  │
│  Organization                     Team members                  │
│  Name: [Acme Marketing        ]   you@acme.com      Owner        │
│  Slug: acme-marketing              sam@acme.com      Admin        │
│                                    [+ Invite teammate]             │
│                                                                    │
│  Billing                                                          │
│  Current plan: Growth ($149/mo)     Next invoice: Aug 12, 2026     │
│  [ Manage billing (Stripe) ]                                       │
└──────────────────────────────────────────────────────────────┘
```
