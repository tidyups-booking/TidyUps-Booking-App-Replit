---
name: Cleaner App Auth
description: Clerk v4 Expo auth patterns — which import paths to use for useSignIn/useSignUp vs the new signals API
---

# Clerk v4 Expo Auth Patterns

## The Rule
`@clerk/expo` (v4+) exports `useSignIn` / `useSignUp` from `@clerk/react` (the new signals-based API). These return `SignInSignalValue` / `SignUpSignalValue` — they do **not** have `setActive` or `isLoaded`.

To use the classic `{ signIn, setActive, isLoaded }` API, import from the legacy sub-path:

```tsx
import { useSignIn } from '@clerk/expo/legacy';
import { useSignUp } from '@clerk/expo/legacy';
```

`useSSO` and `useAuth` are fine from `@clerk/expo` directly — they haven't changed.

**Why:** Clerk v4 introduced a signals-based reactive API as the default. The legacy sub-package re-exports from `@clerk/react/legacy` and preserves the imperative `signIn.create()` / `setActive()` / `signUp.attemptEmailAddressVerification()` flow.

**How to apply:** Any new Expo screen needing email+password sign-in or sign-up must use `@clerk/expo/legacy` for those two hooks. SSO via `useSSO` stays on the main `@clerk/expo` import.
