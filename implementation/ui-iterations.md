# UI Iterations Log

## Iteration 1 — Initial Layout (Locked)
- 3-panel Outlook format: Sidebar 20%, List 50%, Detail 30%
- Desktop >=1024px, Mobile <768px
- Status: LOCKED, never change

## Iteration 2 — Button Visibility & Styling (Locked)
- Problem: Buttons invisible, no hover states
- Solution: Padding 8px 16px, border-radius 6px, color-coded, hover/disabled states, loading spinners, dynamic wiring
- Files: style.css, app.js
- Status: LOCKED

## Iteration 3 — Job Tree Accordion (Locked)
- Problem: Flat headings, not collapsible
- Solution: Collapsible Job Tree sections, rotating arrows, counts, sticky bottom button, border highlight
- Files: style.css, app.js, index.html
- Status: LOCKED

## Iteration 4 — Panel Resizing & Compact Cards (Locked)
- Problem: Monolithic layouts restrict user control; drag-and-drop workspace in the middle is cluttered; candidate cards are bulky
- Solution: Resizable flex layout with persistent widths saved to localStorage. A button opens a dedicated file upload modal overlay. Candidate cards redesigned with 32px initials avatar, status dot, and 32px color-coded match score badges.
- Files: index.html, style.css, app.js
- Status: LOCKED

## Iteration 5 — Light Theme Migration (Locked)
- Problem: Legacy Slate dark theme had poor text contrast and looked outdated to HR users.
- Solution: Transitioned application to a premium, high-contrast light theme (slate-50 background, white cards, slate-100 sidebar, blue accents). Refactored footer action buttons to semantic class styling. Corrected gauge charts, speech patterns, and timeline items to match the light background.
- Files: index.html, style.css, app.js
- Status: LOCKED

## Iteration 6 — Empty State Card Redesign (Locked)
- Problem: The empty state in Panel 3 was bare, showing only a raw emoji placeholder `👤` and minimal text.
- Solution: Redesigned empty state into a high-fidelity information card featuring a custom SVG vector outline, refined typography, and a structured hints checklist outlining key workflow stages.
- Files: index.html, style.css
- Status: LOCKED

## Iteration 7 — Resume Upload Zone Redesign (Locked)
- Problem: The resume upload zone in the modal was bare, displaying a simple emoji folder placeholder `📁`.
- Solution: Redesigned the upload zone into a high-fidelity dashed card featuring a custom SVG upload icon, clear file format instructions, and a hover translation/color scale animation.
- Files: index.html, style.css
- Status: LOCKED

## Iteration 8 — Hybrid Pagination & Batch Ingestion UI (Locked)
- Problem: HR users cannot paginate through large candidate tables. Active bulk uploads lack real-time per-file status updates and summary alerts when closing the modal.
- Solution: Added a paginated footer bar with direct page selectors, "Jump to" page inputs, and a "Show All" toggle. Implemented a real-time progress bar and log cards inside the upload modal connected via SSE, and a toast pop-up reporting total ingestion counts when the modal is closed.
- Files: index.html, style.css, app.js
- Status: LOCKED

