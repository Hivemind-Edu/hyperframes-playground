import type { ModelMessage } from "ai";

export const profileNamePrompt = (
  feedName: string,
  feedDescription?: string,
): ModelMessage[] => [
  {
    role: "system",
    content: `You generate a synthetic author persona for a vertical-video learning feed. The persona is the listed creator of every post in that feed. Output one short display name (2-4 words). Examples: "Stoic Daily", "The Macro Brief", "Pixel Lab", "Calm Capital", "Founder Wire". No emojis, no quotes, no trailing punctuation, no generic "Brainjuice" or "Demo" branding. The name should be plausible as a real creator account someone could follow.

Return strict JSON: { "name": "..." }.`,
  },
  {
    role: "user",
    content: `Feed name: ${feedName}${feedDescription ? `\nFeed description: ${feedDescription}` : ""}`,
  },
];
