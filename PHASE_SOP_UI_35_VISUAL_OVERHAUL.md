# PHASE SOP-UI-35 — DVIVID CONSULTANT PORTAL VISUAL SYSTEM OVERHAUL

## Design System

### Color Tokens (tailwind.config.ts)
- Primary: #2563EB
- Primary Hover: #1D4ED8
- Page BG: #F7F9FC
- Surface: #FFFFFF
- Soft Blue: #EFF6FF
- Soft Blue Border: #D6E4FF
- Text Primary: #25324B
- Text Secondary: #66758F
- Text Muted: #8A97AD
- Border: #DCE3EE
- Success: #159455
- Warning: #D97706
- Error: #D14343

### Typography
- Page title: 30px / 700
- Section title: 22px / 600
- Card title: 18px / 600
- Body: 15-16px
- Field label: 14px / 500-600
- Helper text: 13-14px

### Border Radius
- Card: 20px
- Input: 11px
- Button: 10px

### Spacing Scale
4, 8, 12, 16, 24, 28, 32, 40, 48, 64

## Shared Components

Created in `src/components/ui/`:

| Component | File | Purpose |
|-----------|------|---------|
| AppHeader | AppHeader.tsx | Top navigation with logo, nav links, profile |
| PageContainer | index.tsx | Centered max-width 1280px container |
| PageHeader | index.tsx | Page title + subtitle + action |
| SectionCard | index.tsx | White card with optional title/description |
| InfoPanel | index.tsx | Light-blue contextual panel |
| PrimaryButton | index.tsx | Blue filled button |
| SecondaryButton | index.tsx | White bordered button |
| DangerButton | index.tsx | Red button |
| StatusBadge | index.tsx | Standardized status badges |
| PromptSourceBadge | index.tsx | Human-readable prompt source labels |
| EmptyState | index.tsx | Professional empty states with CTA |
| Breadcrumb | index.tsx | Navigation breadcrumb |
| FormField | FormField.tsx | Label + input + helper wrapper |
| TextInput | FormField.tsx | Standard text input |
| SelectField | FormField.tsx | Standard select |
| TextAreaField | FormField.tsx | Standard textarea |
| ProgressStepper | ProgressStepper.tsx | Horizontal stepper with states |

## Pages Redesigned

| Page | Route | Changes |
|------|-------|---------|
| Dashboard | / | New design system, completion card, quick actions |
| Students | /students | Search page with avatar initials, clean cards |
| Student Workspace | /students/[id] | Profile summary, completion bar, application cards |
| Application Workspace | /students/[id]/applications/[id] | Document cards with badges, add document form |
| Document Workspace | /students/.../documents/[id] | Two-column layout: editor + sidebar, friendly generation states |
| Fact Sheet | /fact-sheet | Two-column section grid, completion indicators, friendly generation progress |

## Status Badges

| Status | Color |
|--------|-------|
| APPROVED | Green |
| IN_REVIEW | Blue |
| DRAFT | Gray |
| FAILED | Red |
| NEEDS_INFORMATION | Amber |
| GENERATED | Green |
| GENERATING | Blue |
| NOT_GENERATED | Gray |

## Prompt Source Badges

| Enum | Human Label |
|------|-------------|
| OFFICIAL_VERIFIED | Official Requirement |
| APPLICATION_PORTAL | Application Portal |
| CONSULTANT_PROVIDED | Consultant Provided |
| DVIVID_DEFAULT_TEMPLATE | D-Vivid Template |
| CUSTOM | Custom |

## Generation Experience

Internal pipeline stages mapped to friendly labels:
1. Preparing your document
2. Drafting
3. Reviewing quality
4. Adjusting language
5. Finalizing
6. Verifying facts

No internal AI terminology (claim IDs, RC-DOC, pipeline internals) exposed.

## Responsive

- Desktop primary (1440, 1280, 1024)
- Mobile (768, smaller)
- PageContainer: max-width 1280px, 32px desktop / 16px mobile padding
- Grid layouts collapse to single column on mobile
- AppHeader has mobile menu toggle
- Stepper is horizontally scrollable on mobile

## Report

| Check | Status |
|-------|--------|
| Design system | PASS |
| Shared components | PASS |
| Students | PASS |
| Profile | PASS |
| Fact Sheet | PASS |
| Application | PASS |
| Document Workspace | PASS |
| Responsive | PASS |
| Accessibility | PASS |
| Existing functionality | PASS |

AI modified: NO
Backend modified: NO
Database modified: NO

## Verification

- TypeScript: PASS
- Clean Next.js build: PASS
- All endpoints: 200
- PM2: stable
- Production counts: 1/1/1/1 unchanged
- All regression tests: PASS
  - Phase 34D: 39/39
  - Phase 34C: 57/57
  - Phase 34B: 50/50
  - Phase 34A: 78/78
  - Phase 34: 68/68
  - Phase 33B: 40/40
  - Phase 33: 196/196
  - Phase 32: 78/78

PHASE SOP-UI-35 COMPLETE — DVIVID CONSULTANT EXPERIENCE REDESIGNED
