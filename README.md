# GrowthOS

AI-powered growth auditing platform for home service businesses (plumbers, HVAC, roofers, electricians, landscapers, pest control, etc.). Enter a website URL, get a professional executive report showing exactly how to get more customers.

## Planning documentation

Before any code is written, the full product/architecture plan lives in [`docs/`](./docs). Start at [`docs/00-overview.md`](./docs/00-overview.md).

Development proceeds one milestone at a time — see [`docs/15-mvp-scope-and-m0-plan.md`](./docs/15-mvp-scope-and-m0-plan.md) for the active build plan (the full long-term roadmap in [`docs/09-milestones.md`](./docs/09-milestones.md) resumes after the MVP has a paying customer).

## Local development

```bash
npm install
cp .env.example .env.local   # fill in real values as each milestone needs them
npm run dev
```

`next build`/`typecheck`/`lint` all succeed with no `.env.local` at all — see `lib/env.ts` for why. Running the app itself does need real values for whatever it's actually touching (e.g. `DATABASE_URL` once a route uses the database).

Background jobs run through [Inngest](https://www.inngest.com/). For local dev, set `INNGEST_DEV=1` (already in `.env.example`) so the app talks to the local Inngest Dev Server instead of assuming production/cloud mode:

```bash
npx inngest-cli dev   # in a separate terminal
```

Useful scripts: `npm run typecheck`, `npm run lint`, `npm run build`, `npm run db:generate` (Drizzle migrations), `npm run db:studio` (browse the database).