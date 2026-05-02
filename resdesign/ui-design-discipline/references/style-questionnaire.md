# Style questionnaire

Use this when the repo has no established UI style or when the user asks to create a new design direction.

Ask no more than 6 questions at once. Offer presets as broad inspiration, not exact copies.

## Opening question

```text
I do not see a stable UI system yet. Do you want to start from a preset direction or define one from scratch? Preset examples: Linear-inspired minimal productivity, Vercel-inspired monochrome developer tool, Stripe-inspired polished SaaS, calm enterprise dashboard, editorial/content-heavy, playful consumer app. I will use these only as broad style directions, not exact copies.
```

## Core questions

1. What kind of product is this: dashboard, devtool, SaaS app, marketing site, internal tool, content site, mobile-first app, or something else?
2. Who uses it most often, and what are they trying to accomplish quickly?
3. What personality should the interface have: calm, premium, technical, playful, editorial, bold, warm, clinical, or minimal?
4. Should the default density be compact, balanced, or spacious?
5. Should the palette be neutral-first, accent-led, colorful, dark-first, or brand-color-heavy?
6. Which components are needed first: navigation, forms, tables, cards, charts, command menu, dialogs, settings, onboarding, marketing sections?

## Follow-up questions

- Is dark mode required now or later?
- Is high contrast mode required?
- Are there accessibility or compliance requirements?
- Should typography use system fonts only, or can the project include font assets/services?
- Should motion be minimal, expressive, or disabled by default?
- Are there existing logos, brand colors, screenshots, or Figma files?
- What package manager and frontend framework should be used?
- Should the system optimize for speed of implementation or long-term design-system rigor?

## Style preset summaries

Use these only as starting points.

### Linear-inspired minimal productivity

- crisp surfaces;
- compact density;
- quiet borders;
- strong keyboard/focus states;
- subtle accents;
- task-first hierarchy.

### Vercel-inspired monochrome developer tool

- black/white/gray foundation;
- restrained accent color;
- high clarity typography;
- sharp cards and panels;
- technical, precise affordances.

### Stripe-inspired polished SaaS

- premium gradients or soft accents;
- spacious marketing surfaces;
- refined cards and illustrations;
- stronger color personality;
- clear conversion hierarchy.

### Calm enterprise dashboard

- balanced density;
- readable tables and forms;
- conservative color use;
- predictable navigation;
- strong empty/loading/error states.

### Editorial/content-heavy

- typography-led hierarchy;
- generous reading width;
- careful spacing rhythm;
- understated controls;
- content-first pages.

### Playful consumer app

- warmer colors;
- rounder radii;
- friendly icons and empty states;
- more expressive motion;
- simpler navigation.

## Deliverable after questions

Create a draft `docs/design-system/ui-contract.md` with:

- brand principles;
- token philosophy;
- initial palette and semantic tokens;
- typography scale;
- spacing and radius scale;
- starter components;
- Storybook plan;
- lint guardrails;
- open decisions.
