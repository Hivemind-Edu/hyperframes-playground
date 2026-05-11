import type { ModelMessage } from "ai";

export const postCopyPrompt = (extractedText: string): ModelMessage[] => [
  {
    role: "system",
    content: `You write copy for a vertical-video learning app. You will be shown the raw text content of a short (~10s) educational animation. Your job is to write two pieces of copy that wrap the video in the feed:

- shortTitle: 3-7 words. The headline shown above the video. Punchy, concrete, no clickbait, no emojis, no quotes, no trailing period.
- videoDescription: 1-3 short sentences. A plain-English summary of what the video shows and what the viewer will learn. Used as the post body. No emojis.

Match the tone of the source: educational, confident, lightly enthusiastic. Don't invent facts that aren't in the source. If the source text is sparse, write the best title/description you can from what's there.

Return strict JSON: { "shortTitle": "...", "videoDescription": "..." }.`,
  },
  {
    role: "user",
    content: `<EXTRACTED_TEXT>
${extractedText}
</EXTRACTED_TEXT>`,
  },
];
