# Builder prompt template (one round)

Give this to the agent that changes the screens between critique rounds.
Fill in the `{{…}}` fields.

---

Repository {{repo}}, branch `{{branch}}`. This is round {{N}} of the visual
hill climb on **{{feature}}**. Read these first: root `AGENTS.md`, the
nested `AGENTS.md` files along the paths you change, {{design doc}}, and
the round {{N-1}} critiques in `{{prev_round_dir}}/critiques/`
(`tufte`, `jobs`, `operator`, both `.md` and `.json`), with
`{{prev_round_dir}}/{{direction}}/manifest.json`.

**Scope.** Apply every issue marked `"needs": "static"`. {{or: the listed
issues}}. Do not attempt `interactive` or `real-data` issues. List them as
not done. When critics conflict, decide, then record the decision and the
reason in the manifest's `conflicts` and in {{design doc}}.

**Where to change.** {{For design mocks: the components under …; shared
rendering changes reach every direction. For the real app: the production
components and services; never redraw from screenshots.}} Keep every rule
in {{design doc}}. Keep pure rules in testable functions, and add or extend
a contract test for each rule you change
({{e.g. ui2/src/modules/segmentation/__tests__/designContract.test.tsx}}).

**Capture.**

```sh
cd e2e
SEG_DESIGN_ROUND=round-{{N}} SEG_DESIGN_DIRECTIONS={{direction}} \
SEG_DESIGN_BROWSER=/path/to/chrome-headless-shell \
  node_modules/.bin/playwright test -c playwright.segmentation-design.config.ts
```

This writes `cruft/hillclimb/{{feature}}/round-{{N}}/{{direction}}/<state>.png`
and `manifest.json`. (For the real app, use its harness or capture spec,
with the same file names and viewports.)

**Check your own work before handing over.**

1. Open every PNG and look at it. Fix what you see: overlaps, clipped
   text, marks that do not read, numbers that disagree between screens.
2. Diff against the last round. States you did not mean to change must
   not change. If a fix required a change elsewhere, say so in the
   manifest's `core_states` (or equivalent).
3. Add to the manifest: `changes` (`critic`, `rank`, `states`, `change`),
   `conflicts` (`issue`, `critics`, `decision`, `why`) and `not_done`.
4. Update {{design doc}}: the decisions, the open questions, and the score
   history (filled in after the critics report).
5. Run the targeted tests, lint on the files you touched, and the type
   check.

**Report.** Give the fixes by critic and rank, the conflicts you decided,
what you did not do and why, and the checks you ran with their results.
Commit with the repository's trailers. Do not open a PR unless asked.
