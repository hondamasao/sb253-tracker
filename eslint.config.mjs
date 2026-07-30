import nextConfig from "eslint-config-next";

const eslintConfig = [
  ...nextConfig,
  {
    ignores: ["drizzle/**", ".next/**", "node_modules/**"],
  },
  {
    // JUDGE ISOLATION (docs/19-m1c-security-and-evaluation.md §3).
    //
    // The judge must never see the prompts that generated the report it
    // is grading — otherwise it grades against the generator's own
    // stated intentions instead of against the evidence, and the
    // independence that makes its verdict worth anything is gone.
    //
    // Enforced here rather than by convention so that wiring a generating
    // prompt into the judge is a build failure someone has to
    // deliberately override, not a code-review miss. `evals/judge/`
    // therefore declares its own input types (evals/types.ts) instead of
    // importing the pipeline's.
    files: ["evals/judge/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/agents", "@/agents/*", "../../agents/*", "**/agents/shared/prompt*"],
              message:
                "evals/judge must not import from agents/ — the judge is required to be blind to the prompts that generated the report it grades. Pass plain data in via evals/types.ts instead.",
            },
            {
              group: ["@/lib/pipeline/*", "@/lib/report/*"],
              message:
                "evals/judge must not import pipeline internals — it receives only the finished report and the raw evidence bundle.",
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
