# Publish a Brainjuice Onboarding Demo Post

This is the repeatable path for publishing a final demo artifact into Brainjuice local, staging, and prod, then inserting the post ID into the live onboarding PostHog flag.

There are two supported artifact types:

- Rendered MP4 video: use `/Users/mark/hivemind/hyperframes-playground/scripts/publish-rome-industrial-revolution-demo.ts` or `/Users/mark/hivemind/hyperframes-playground/scripts/publish-manim-completing-square-demo.ts` as the template.
- HTML slideshow package: use `/Users/mark/hivemind/hyperframes-playground/scripts/publish-alesia-demo.ts` as the template.

The publisher is intentionally idempotent. It uploads the artifact, upserts the database rows, creates or updates comments, and replaces one PostHog onboarding slot without shifting the rest of the list.

## Targets

| Target | Database connection | Firebase service account | Bucket | PostHog project |
| --- | --- | --- | --- | --- |
| local | `DATABASE_URL` from `/Users/mark/hivemind/hivemind-hono/.env.brainjuice.local` | `FIREBASE_CONFIG` from `/Users/mark/hivemind/hivemind-hono/.env.brainjuice.local` | `brainjuice-dev.firebasestorage.app` | Brainjuice Dev `131639` |
| staging | `DATABASE_URL` from `/Users/mark/hivemind/hyperframes-playground/.env.staging` | `FIREBASE_CONFIG` from `/Users/mark/hivemind/hyperframes-playground/.env.staging` | `brainjuice-staging.firebasestorage.app` | Brainjuice Staging `131638` |
| prod | `DATABASE_URL` from `/Users/mark/hivemind/hyperframes-playground/.env.prod` | `FIREBASE_CONFIG` from `/Users/mark/hivemind/hyperframes-playground/.env.prod` | `brainjuice-prod.firebasestorage.app` | Brainjuice Prod `131637` |

PostHog credentials come from:

- `POSTHOG_HOST` in `/Users/mark/hivemind/hivemind-hono/.env.local`
- `POSTHOG_PERSONAL_API_KEY` in `/Users/mark/hivemind/hivemind-hono/.env.local`

Prod Postgres requires SSL. The Alesia publisher uses `ssl: { rejectUnauthorized: false }` for prod unless `DB_SSL_REJECT_UNAUTHORIZED=true` is explicitly present.

## PostHog Flag

Flag key:

```text
onboarding-brainjuice-demo-post-ids
```

Payload shape:

```json
{
  "postIds": ["post-id-1", "post-id-2"],
  "postTagMap": {
    "post-id-1": ["history"]
  }
}
```

The onboarding order is zero-based. Replacing index `9` means the post becomes the 10th card. Do not insert-and-shift unless the product decision explicitly says to change later indices.

If a Brainjuice PostHog project does not have the flag yet, create it as active with 100 percent rollout and the same payload shape. For prod, fall back to the app's built-in `SAMPLE_POST_IDS` list, then replace the requested index.

## Rendered MP4 Layout

For a rendered MP4 artifact, upload one file:

```text
brainjuice/generated/<POST_ID>/rendered.mp4
```

The final local MP4 should live in:

```text
/Users/mark/hivemind/FINAL DEMO VIDEOS/<filename>.mp4
```

Recommended compression for onboarding MP4s:

```bash
ffmpeg -y \
  -i "/path/to/source.mp4" \
  -c:v libx264 -preset slow \
  -b:v 2100k -maxrate 2400k -bufsize 4800k \
  -pix_fmt yuv420p -movflags +faststart \
  -c:a aac -b:a 96k \
  "/Users/mark/hivemind/FINAL DEMO VIDEOS/<slug>-compressed-under-30mb.mp4"
```

This keeps broad compatibility while usually landing a 100 second 392x768 video below 30 MB. For substantially longer or higher-resolution videos, recompute the target bitrate:

```text
target_total_kbps = target_size_megabytes * 8000 / duration_seconds
target_video_kbps = target_total_kbps - audio_kbps - container_margin
```

Use `renderer = "hyperframes"` for rendered MP4s, even if the source video was made by Manim or another renderer. The app path expects a rendered video artifact.

Root post `contents` for a rendered MP4:

```json
{
  "description": "<description>",
  "shortTitle": "<title>",
  "videoDescription": "<description>",
  "videoData": {
    "durationSeconds": 103,
    "props": {},
    "recompiledAt": "<ISO timestamp>",
    "renderedOnly": true,
    "renderer": "hyperframes",
    "templateId": "<StableRenderedOnlyArtifactName>"
  }
}
```

Root post `origin_info` for a rendered MP4:

```json
{
  "firebaseStoragePath": "brainjuice/generated/<POST_ID>/rendered.mp4",
  "source": "<source-label>",
  "viewerUrl": "https://firebasestorage.googleapis.com/v0/b/<bucket>/o/brainjuice%2Fgenerated%2F<POST_ID>%2Frendered.mp4?alt=media"
}
```

## HTML Slideshow Layout

For an `html-slideshow` artifact, upload the final HTML and its root assets like this:

```text
brainjuice/generated/<POST_ID>/slide-01.webp
brainjuice/generated/<POST_ID>/slide-02.webp
...
brainjuice/generated/<POST_ID>/artifact/index.html
```

Do not upload `player.html` for `html-slideshow`. The Brainjuice app loads `artifact/index.html` directly through `BrainjuiceHtmlSlideshowWebViewPlayer`.

Before uploading `index.html`:

1. Rewrite root image references like `slide-01.webp` to Firebase media URLs for that target bucket.
2. Rewrite static runtime/font URLs from `brainjuice-dev.firebasestorage.app` to the target bucket.
3. Inject the no-text-selection CSS if it is not already present.
4. Upload HTML with gzip metadata and binary assets as `image/webp`.

Root post `contents` for an HTML slideshow:

```json
{
  "description": "<description>",
  "shortTitle": "<title>",
  "videoDescription": "<description>",
  "videoData": {
    "durationSeconds": 90,
    "props": {},
    "recompiledAt": "<ISO timestamp>",
    "renderer": "html-slideshow",
    "templateId": "POVSlideshowTemplate"
  }
}
```

Root post `origin_info` for an HTML slideshow:

```json
{
  "firebaseStoragePath": "brainjuice/generated/<POST_ID>/artifact/index.html",
  "source": "<source-label>",
  "viewerUrl": "https://firebasestorage.googleapis.com/v0/b/<bucket>/o/brainjuice%2Fgenerated%2F<POST_ID>%2Fartifact%2Findex.html?alt=media"
}
```

## Database Rows

The publisher upserts:

- `user`: `DEMO`
- `feed`: `f_brainjuice-onboarding-dev-rendered-demo`
- `chapter`: `ch_brainjuice-onboarding-dev-rendered-demo`
- demo `synthuser` and `profile` rows for the host and commenters
- root `post`
- comment `post` rows with `display_style = 'COMMENT'`

Root post fields to set:

```text
id = <POST_ID>
chapter_id = ch_brainjuice-onboarding-dev-rendered-demo
display_style = BASIC
origin_type = USER
poster_profile_id = prof_brainjuice-onboarding-dev-rendered-demo
sort_order = <POSTHOG_INDEX>
text = <title>
```

Comment IDs should be stable and derived from the post ID:

```text
<POST_ID>_c01
<POST_ID>_c02
...
<POST_ID>_c12
```

Write comments that fit the topic and teach the viewer what to notice. Avoid generic praise. Twelve comments is the current onboarding convention.

## Repeat Procedure: Rendered MP4

1. Put the final video in `FINAL DEMO VIDEOS`.

   Example:

   ```text
   /Users/mark/hivemind/FINAL DEMO VIDEOS/9-rome-industrial-revolution-scenario-compressed-under-30mb.mp4
   ```

2. Copy a rendered-video publisher.

   ```bash
   cd /Users/mark/hivemind/hyperframes-playground
   cp scripts/publish-rome-industrial-revolution-demo.ts scripts/publish-<slug>-demo.ts
   ```

3. Edit these constants in the copied script:

   ```text
   FINAL_VIDEO_PATH
   POST_ID
   REPLACE_INDEX
   TAG_IDS
   SOURCE_LABEL
   POST_TITLE
   POST_DESCRIPTION
   DURATION_SECONDS
   COMMENTS
   appName in initFirebaseForTarget()
   videoData.templateId
   console log prefix in main()
   ```

4. Keep the rendered MP4 settings:

   ```text
   Firebase artifact = rendered.mp4
   contents.videoData.renderer = hyperframes
   contents.videoData.renderedOnly = true
   origin_info.firebaseStoragePath = brainjuice/generated/<POST_ID>/rendered.mp4
   ```

5. Run a dry run.

   ```bash
   bun run scripts/publish-<slug>-demo.ts --dry-run
   ```

   Check:

   ```text
   posthogIndex = <REPLACE_INDEX> for local, staging, and prod
   posthogPostCount looks plausible
   postTagMap[POST_ID] = TAG_IDS
   prod fallback did not collapse to a one-post payload
   ```

6. Publish live.

   ```bash
   bun run scripts/publish-<slug>-demo.ts
   ```

   To retry only one environment:

   ```bash
   bun run scripts/publish-<slug>-demo.ts --targets prod
   bun run scripts/publish-<slug>-demo.ts --targets staging
   bun run scripts/publish-<slug>-demo.ts --targets local
   ```

7. Verify the script summary.

   Expected per target:

   ```text
   DB row exists
   text = <title>
   sort_order = <REPLACE_INDEX>
   renderer = hyperframes
   comments = 12
   posthogIndex = <REPLACE_INDEX>
   uploadedFileCount = 1
   ```

8. Verify Firebase metadata.

   ```bash
   for bucket in brainjuice-dev.firebasestorage.app brainjuice-staging.firebasestorage.app brainjuice-prod.firebasestorage.app; do
     curl -s "https://firebasestorage.googleapis.com/v0/b/${bucket}/o/brainjuice%2Fgenerated%2F<POST_ID>%2Frendered.mp4" \
       | node -e 'let s=""; process.stdin.on("data", d => s += d); process.stdin.on("end", () => { const j = JSON.parse(s); console.log(JSON.stringify({ bucket: process.argv[1], contentType: j.contentType, size: j.size, md5Hash: j.md5Hash }, null, 2)); })' "$bucket"
   done
   ```

   Expected:

   ```text
   contentType = video/mp4
   size is identical across all three targets
   md5Hash is identical across all three targets
   ```

9. Verify the media URL returns `200`.

   ```bash
   curl -sI "https://firebasestorage.googleapis.com/v0/b/brainjuice-prod.firebasestorage.app/o/brainjuice%2Fgenerated%2F<POST_ID>%2Frendered.mp4?alt=media" | head
   ```

## Repeat Procedure: HTML Slideshow

1. Put the final package in `FINAL DEMO VIDEOS`.

   Expected minimum package for a slideshow:

   ```text
   index.html
   hyperframes.json
   slide-01.webp
   slide-02.webp
   ...
   ```

2. Copy the Alesia publisher.

   ```bash
   cd /Users/mark/hivemind/hyperframes-playground
   cp scripts/publish-alesia-demo.ts scripts/publish-<slug>-demo.ts
   ```

3. Edit these constants in the copied script:

   ```text
   FINAL_PACKAGE_DIR
   POST_ID
   INSERT_INDEX
   TAG_IDS
   SOURCE_LABEL
   POST_TITLE
   POST_DESCRIPTION
   DURATION_SECONDS
   COMMENTS
   slideFilenames()
   ```

4. For an HTML slideshow, keep:

   ```text
   renderer = html-slideshow
   templateId = POVSlideshowTemplate
   Firebase artifact = artifact/index.html
   no player.html
   ```

5. Run a dry run.

   ```bash
   bun run scripts/publish-<slug>-demo.ts --dry-run
   ```

   Check that each target reports the new post at the intended `posthogIndex`. Also check prod carefully: if the prod flag does not exist, the dry run should show the fallback sample IDs plus the new post, not a one-post payload.

6. Publish live.

   ```bash
   bun run scripts/publish-<slug>-demo.ts
   ```

   To retry one target only:

   ```bash
   bun run scripts/publish-<slug>-demo.ts --targets prod
   bun run scripts/publish-<slug>-demo.ts --targets staging
   bun run scripts/publish-<slug>-demo.ts --targets local
   ```

7. Verify all targets.

   Expected result per target:

   ```text
   DB post exists
   text = <title>
   sort_order = <INSERT_INDEX>
   contents.videoData.renderer = html-slideshow
   comment count = expected comment count
   Firebase artifact HEAD = 200
   PostHog flag active = true
   PostHog post index = <INSERT_INDEX>
   PostHog postTagMap[POST_ID] = TAG_IDS
   ```

## Rome Industrial Revolution Reference

The Rome post used:

```text
POST_ID = p_brainjuice-onboarding-rome-industrial-revolution
title = Could You Industrialize Ancient Rome?
tags = ["history"]
comments = 12
replace index = 9
renderer = hyperframes
artifact = rendered.mp4
source file = /Users/mark/hivemind/FINAL DEMO VIDEOS/9-rome-industrial-revolution-scenario-compressed-under-30mb.mp4
uploaded size = 27562086 bytes
```

Verified final state:

| Target | DB | Firebase | PostHog |
| --- | --- | --- | --- |
| local | `sort_order=9`, `renderer=hyperframes`, `comments=12` | `rendered.mp4`, `video/mp4`, `27562086` bytes | active, index `9`, tags `["history"]` |
| staging | `sort_order=9`, `renderer=hyperframes`, `comments=12` | `rendered.mp4`, `video/mp4`, `27562086` bytes | active, index `9`, tags `["history"]` |
| prod | `sort_order=9`, `renderer=hyperframes`, `comments=12` | `rendered.mp4`, `video/mp4`, `27562086` bytes | active, index `9`, tags `["history"]` |

## Alesia Reference

The Alesia post used:

```text
POST_ID = p_brainjuice-onboarding-alesia-pov
title = Inside Caesar's Siege of Alesia
tags = ["history"]
comments = 12
insert index = 8
renderer = html-slideshow
```

Verified final state:

| Target | DB | Firebase | PostHog |
| --- | --- | --- | --- |
| local | `sort_order=8`, `renderer=html-slideshow`, `comments=12` | `artifact/index.html` returns `200` | active, index `8`, tags `["history"]` |
| staging | `sort_order=8`, `renderer=html-slideshow`, `comments=12` | `artifact/index.html` returns `200` | active, index `8`, tags `["history"]` |
| prod | `sort_order=8`, `renderer=html-slideshow`, `comments=12` | `artifact/index.html` returns `200` | active, index `8`, tags `["history"]` |
