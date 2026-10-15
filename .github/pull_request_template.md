## Summary

<!-- What does this change, and why? One or two sentences is fine for small PRs. -->

## Related issues

<!-- e.g. Closes #12. Delete this section if there is no issue. -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor (no behaviour change)
- [ ] Documentation
- [ ] Build / CI / tooling
- [ ] Breaking change

## Verification

<!--
State what you actually ran. "Should work" is not a verification. Paste the
commands and their results, or link the CI run.
-->

- [ ] `npm run typecheck` — clean
- [ ] `npm test` — server suite passes
- [ ] `npm run test:ui` — frontend suite passes
- [ ] `npm run test:e2e` — end-to-end passes (or explain why it does not apply)
- [ ] `cd ui && npm run build` — produces `ui/dist/`

## Manual testing

<!--
Required for anything touching the interface. This product is phone-first, so a
desktop-only check is not sufficient — state the viewport or device used.
-->

- Device or viewport: <!-- e.g. Pixel 7 / DevTools at 390x844 / desktop 1280 -->
- What I did:
- What I saw:

## Project-specific checks

<!-- Tick what applies; leave the rest alone. -->

- [ ] **Brand mark changed** — updated both `ui/src/components/Brand.tsx` and `ui/public/pocketd-icon.svg`, then ran `npm run icons` (`npm test` asserts the two share one geometry)
- [ ] **Visuals changed** — used existing design tokens from `ui/src/index.css` rather than hard-coded colours or sizes
- [ ] **Terminal or file behaviour changed** — verified against the POSIX-shell-first resolution (ADR-003) and the path sandbox
- [ ] **New dependency added** — stated the bundle or install cost in the description
- [ ] **Approval or permission logic touched** — described the security impact below
- [ ] **Docs updated** — README (all three languages when user-facing), `docs/ARCHITECTURE.md`, or a new ADR in `docs/adr/`

## Security impact

<!--
Does this touch authentication, the token gate, the path sandbox, the approval
policy, the hard-deny list, or anything that executes commands? Say so explicitly,
including "no security impact" when that is the honest answer.
-->

## Notes for reviewers

<!-- Trade-offs taken, alternatives rejected, follow-up work. -->
