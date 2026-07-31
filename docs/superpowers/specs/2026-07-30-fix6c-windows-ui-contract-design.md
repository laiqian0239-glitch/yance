# Yance Batch40 FIX6C Windows UI Contract Design

## Goal

Close the Windows UI defects confirmed by the user's real screenshots without weakening any FIX6B source, security, or release gate.

## Scope

The repair covers the shared UI contracts behind:

1. account-center narrow-width clipping;
2. conversation-header overlap and AI-panel reflow;
3. quick-candidate clipping;
4. system/settings label-control separation;
5. compact navigation brand overlap;
6. composer translation-state corruption;
7. text-heavy composer tools and the redundant disabled composer hint;
8. unequal display-settings action buttons.

Production business logic, persistence, platform adapters, AI routing, and authentication are out of scope.

## Architecture

The repair is implemented in the existing shared presentation layers. Responsive behavior belongs to `r32-production-workspace-layout.css` and the conversation/account/system component styles, not page-specific margins. Semantic changes to controls stay in `frontend/index.html` and `frontend/js/r32-ui-runtime.js`; no backend contract changes are required.

## UI Contracts

### Account center

At narrow widths the account center becomes a single-column document. The directory and workbench are both reachable, the platform filters wrap rather than clip, the hero description wraps naturally, and no late `!important` desktop rule may override the narrow breakpoint.

### Conversation shell

The chat column uses `minmax(0, 1fr)` so hiding the AI panel returns all released width to the chat. The header may wrap into two rows before controls overlap. The compact navigation mode reserves a dedicated slot for its mode toggle instead of positioning it over the product mark.

### Composer

The disabled composer has no visible instructional placeholder. The status remains available through `aria-live`, disabled control state, and tooltips. Emoji, GIF, attachment, and sound are icon buttons with accessible names. The translation chip uses stable text/SVG semantics rather than unsupported glyphs.

### System settings

Every setting is one bounded row containing its own copy and control. Rows use a shared readable maximum width and card treatment; the switch remains visually associated with its label at desktop, narrow width, and display scaling. Header metadata is separate from the switch rail.

### Display settings

The two peer actions share the same grid track, height, padding, border-box sizing, and vertical alignment. Primary/secondary emphasis is expressed through color, not dimensions.

## Failure Handling and Accessibility

All controls keep explicit `aria-label`, `title`, focus-visible outlines, and disabled states. No authentication or fail-closed behavior changes. Horizontal clipping is not accepted as a fallback; wrapping or a deliberate scroll affordance must be present.

## Verification

Static contract tests must fail on FIX6B and pass after the repair. The focused UI suite, Batch14/theme contracts, Batch40 focused suite, and complete backend suite must remain green. A new Windows UI UAT package will bind the FIX6C candidate SHA and require the user to repeat the same narrow-window screenshots.
