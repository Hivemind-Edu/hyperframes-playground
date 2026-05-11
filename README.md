# hyperframes-playground

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.3.13. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

Repo structure:
Feed -> Chapter -> Video

Shared media and reusable compositions live under `shared/` and can be symlinked into individual videos when needed.

## Brainjuice onboarding demo posts

The Brainjuice onboarding taste-test feed normally renders a hardcoded list of curated post IDs from `apps/brainjuice/src/components/onboarding/sampleFeedConstants.ts` (`SAMPLE_POST_IDS`). When iterating on new demo videos rendered from this playground, you can swap that list for your own without shipping a code change via the PostHog feature flag:

**Flag:** `onboarding-brainjuice-demo-post-ids`

- **Type:** JSON payload (the flag boolean itself is ignored — only the payload matters).
- **Payload shape:** a JSON array of post-ID strings, e.g.
  ```json
  ["p_brainjuice-onboarding-philosophy", "p_my-new-demo-post"]
  ```
- **Where it's read:** `FeedSampleScreen` (`apps/brainjuice/src/components/onboarding/FeedSampleScreen.tsx`) via `useFeatureFlagWithPayload`. If the payload is a non-empty array of strings, those IDs replace `SAMPLE_POST_IDS`; otherwise the hardcoded defaults are used.
- **Caveats:**
  - The posts must already exist in the backend (seeded or generated) — the flag only overrides which IDs are requested, not their content.
  - Tag pre-selection on the tag-selection step still uses `SAMPLE_POST_TAG_MAP`, so override IDs won't influence tag recommendations unless they're in that map.
  - Targeting in PostHog: scope this flag to your dev user/cohort so production users keep the default list.

Workflow for testing a new playground-rendered video in onboarding:
1. Render the video in this repo and publish it to a brainjuice post.
2. Set the `onboarding-brainjuice-demo-post-ids` payload in PostHog to an array containing the new post ID (alongside any existing onboarding posts you still want).
3. Re-run the brainjuice onboarding flow on your device — `FeedSampleScreen` will pick up the override on next render.
