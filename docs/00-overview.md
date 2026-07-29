# GrowthOS — Planning Overview

This `docs/` folder is the single source of truth for how GrowthOS is designed and built. Read documents in order the first time. After that, use this page as an index.

We build in **milestones** (see `09-milestones.md`). We do not start milestone N+1 until milestone N is done, tested, and deployed. This keeps a beginner-friendly, low-risk pace and means you always have a working product, never a half-finished pile of code.

## Reading order

| # | Document | What it answers |
|---|----------|------------------|
| 1 | `01-srd.md` | What are we building and why? (Software Requirements Document) |
| 2 | `02-roadmap.md` | What order do we build things in, at a high level? |
| 3 | `03-database-schema.md` | How is data structured and stored? |
| 4 | `04-folder-structure.md` | Where does every file live? |
| 5 | `05-api-architecture.md` | How do frontend, backend, and background jobs talk to each other? |
| 6 | `06-ai-agent-architecture.md` | How do the AI agents that generate the report actually work? |
| 7 | `07-user-flow.md` | What does a user actually click through, start to finish? |
| 8 | `08-wireframes.md` | What do the screens look like? |
| 9 | `09-milestones.md` | The exact build order, with a "done" checklist for each step |
| 10 | `10-testing-strategy.md` | How do we know it works and stays working? |
| 11 | `11-deployment-strategy.md` | How does code get from your laptop to real users safely? |
| 12 | `12-security-plan.md` | How do we protect user data and the business? |
| 13 | `13-pricing.md` | What do we charge, and why? |
| 14 | `14-future-expansion.md` | What comes after the core product proves itself? |

## Tech stack — final decisions

You proposed a stack; here it is confirmed, with two additions and simple reasons why. You don't need to memorize any of this — it's here so you always know why a tool was chosen if you're ever asked or ever curious.

| Layer | Choice | Why (simple version) |
|---|---|---|
| Framework | **Next.js 14+ (App Router)**, TypeScript, React | One codebase serves the marketing site, the app, and the API. Deploys natively to Vercel. Huge ecosystem, so you'll always find help. |
| Styling / UI kit | **Tailwind CSS + shadcn/ui** (built on Radix primitives) | Tailwind = fast, consistent styling without writing custom CSS files. shadcn/ui gives us pre-built, accessible components (buttons, modals, tables) that we own the code for and can restyle to look like Linear/Stripe/Notion, instead of building every component from scratch. |
| Database + Auth + Storage | **Supabase** (Postgres) | One platform for the database, user login, and file storage (PDFs, logos). Postgres is a proven, relational database — perfect for the structured data we have (users, businesses, scans, reports). Supabase's "Row Level Security" is how we keep one customer's data invisible to another, which matters a lot once we have team accounts. |
| Database access from code | **Drizzle ORM** | An ORM lets our TypeScript code talk to Postgres without writing raw SQL everywhere, while still catching mistakes at compile time. Drizzle is lightweight and fast, and — unlike some alternatives — doesn't need a special background process to run, which matters on serverless hosting like Vercel. |
| Background job engine | **Inngest** *(new — not in your original list)* | Analyzing a website takes 30–90 seconds (crawling pages, calling AI, calling Google's APIs). Vercel's normal request/response functions time out long before that finishes. Inngest lets us run long, multi-step, retry-safe background jobs ("scan this website") that are triggered by the app but run independently. This is the difference between a toy demo and a product that reliably finishes real work. |
| AI models | **OpenAI (GPT-4o / GPT-4o-mini) + Anthropic Claude (Sonnet)** | We use both because (a) part of the product literally tests "how does this business show up when asked about on ChatGPT vs. Claude vs. Gemini," so we need real API access to each, and (b) using a cheaper/faster model for simple extraction tasks and a stronger model for the final written report keeps AI costs low as we scale to thousands of users. |
| PDF generation | **`@react-pdf/renderer`** *(new — not in your original list)* | Turns the report into a polished PDF using React components (so it can share styling logic with the web report). It runs as plain JavaScript with no headless browser required, which is far more reliable and cheaper on serverless hosting than tools like Puppeteer. |
| Payments | **Stripe** (Checkout + Billing + Customer Portal) | Industry standard for SaaS subscriptions. Stripe's hosted Checkout and Customer Portal mean we don't have to build billing UI or store card data ourselves — safer and much faster to ship. |
| Transactional email | **Resend + React Email** | Sends "your report is ready," alerts, and receipts. Built for developers, great deliverability, and lets us write email templates as React components (consistent styling with the app). |
| Hosting | **Vercel** (app) + **Supabase Cloud** (database) + **Inngest Cloud** (jobs) | All three have generous free tiers, scale automatically, and are built to work together with minimal DevOps — important since you're a team of one/few right now. |
| Monitoring / errors | **Sentry** (errors) + **Vercel Analytics / PostHog** (product usage) | We need to know when something breaks (Sentry) and how people actually use the product (PostHog), from day one — not bolted on later. |
| Rate limiting / caching | **Upstash Redis** | Cheap, serverless-friendly Redis used to stop abuse (e.g., someone scripting 10,000 free scans) and to cache expensive API calls (like Google PageSpeed results) for a few hours. |

Everything else you listed (Next.js, TypeScript, React, Tailwind, Supabase, OpenAI/Claude, Vercel, Stripe) is used exactly as you proposed. Inngest, Drizzle, react-pdf, Resend, Sentry/PostHog, and Upstash are the "supporting cast" that make the product actually production-ready instead of a fragile prototype.

## Product name vs. repo name

This repository is currently named `sb253-tracker`, but the product is **GrowthOS**. That mismatch is harmless for now (repo names are just labels), but at some point you'll want to rename the GitHub repo to something like `growthos` for clarity. Not urgent — flagged here so it's a conscious decision, not an accident.
