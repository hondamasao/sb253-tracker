# User Flow

Two primary personas walk through the product differently at first, then converge into the same dashboard experience. Both flows are described end-to-end below.

## Flow A — New visitor (the growth engine)

This is the most important flow in the whole product: it's how strangers become paying customers, so every step is designed to reduce friction until the moment value has already been proven.

```
1. Land on marketing homepage
   → Sees hero: "Find out why you're losing customers online" + URL input
   → No signup required to start

2. Enter website URL, click "Get my free report"
   → Client-side validation (looks like a URL)
   → Redirect to /report/[scanId] (a "scan in progress" state)

3. Scan-in-progress screen
   → Live-updating progress ("Checking mobile speed... Analyzing Google Business Profile...")
   → Builds anticipation instead of a blank spinner; sets expectation (~60-90s)
   → Optional: capture email here ("we'll notify you if this takes a minute") — soft capture, not required

4. Teaser report appears (same URL, auto-updates when scan completes)
   → Overall score + letter grade, fully visible (this is the "wow" moment — bold, large, shareable)
   → Top 2-3 most severe findings, fully visible
   → Remaining findings, category breakdown, competitor comparison, PDF: blurred/locked
   → Clear CTA: "Create a free account to unlock your full report"

5. Signup (email/password or Google OAuth)
   → On success: the anonymous scan's `businesses` row is attached to the new organization
   → No credit card required at this step

6. Full report unlocked
   → All 16 categories, prioritized checklist, before/after examples, monthly action plan
   → "Download PDF" button
   → Secondary CTA throughout: "Set up weekly monitoring" → leads to plan selection (this is the paid conversion moment)

7. Dashboard (empty state prompts: "Add another business" or "Upgrade to track this one over time")
```

**Why this order:** value (the score + top findings) is shown *before* any signup wall, and signup is asked for *before* payment. Two separate, small commitments convert far better than asking for a credit card up front. This mirrors how Linear/Notion/Vercel-style products let you feel the product before asking for anything.

## Flow B — Returning / paying user

```
1. Log in → Dashboard
   → Grid/list of all businesses in the org: name, current score, grade, trend arrow, last scan date

2. Click a business → Business detail page
   → Score history chart (line graph over time)
   → List of past reports (each downloadable as PDF)
   → "Run new scan now" button (manual re-scan, subject to plan's scan-frequency allowance)
   → Monitoring schedule toggle (weekly/monthly) — plan-gated

3. Click a report → Full report view (same component as the unlocked teaser report in Flow A)

4. Settings
   → Organization: rename org, invite teammates (role: admin/member), remove members
   → Billing: current plan, "Manage billing" → Stripe Customer Portal, upgrade/downgrade
   → API Keys (Agency plan only, Phase 4): generate/revoke keys

5. Alerts (passive flow, not a page the user necessarily visits)
   → Email arrives when: scheduled scan completes, score drops significantly, or a new critical issue appears
   → Email links directly back into the relevant report
```

## Flow C — Agency/team member (Phase 4)

```
1. Receives "You've been invited to [Org Name] on GrowthOS" email
2. Clicks link → if no account, signup; if existing account, accept-invite confirmation
3. Lands directly in the org's dashboard with role-appropriate permissions
   (member: view/run scans; admin: + manage businesses/billing; owner: + manage members/delete org)
```

## Error / edge-case paths (must be designed, not an afterthought)

- **Invalid or unreachable URL** at step 2 of Flow A: inline error before a scan is even queued — never silently "start" a scan doomed to fail.
- **Scan fails** (site blocks crawlers, server error, timeout after retries): user sees a clear explanation and a "try again" button, not a stuck spinner — and is never charged/counted against their scan quota for a failed scan.
- **Anonymous user closes the tab mid-scan**: scan still completes server-side (it's a durable background job, not tied to the browser tab); if they gave an email, they get a "your report is ready" link.
- **Free/teaser report abandoned without signup**: safe to simply expire from prominent storage after some period; no dark patterns (no fake urgency countdowns) — this is a trust-first product for small business owners, and we protect that trust deliberately.
- **Plan limit hit** (e.g., tries to add a 4th business on a 3-business plan): blocked at the API level with a clear upgrade prompt, not a confusing failure.
