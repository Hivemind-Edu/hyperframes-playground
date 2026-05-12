/**
 * Generate a feed thumbnail via fal.ai Flux Schnell, convert to WebP, cache
 * in the build folder. Mirrors hivemind-hono's brainjuice feed-picture
 * generation (same prompt, same WebP quality).
 *
 * Requires `FAL_KEY` or `FAL_API_KEY` to be set. The build validates this at
 * startup so missing credentials fail fast.
 */

import { fal } from "@fal-ai/client";
import sharp from "sharp";
import { writeFileSync } from "node:fs";

const falKey = process.env.FAL_KEY ?? process.env.FAL_API_KEY;
let configured = false;

export function isFalConfigured(): boolean {
  return Boolean(falKey);
}

export function assertFalConfigured(): void {
  if (!falKey) {
    throw new Error("Missing fal.ai API key. Set FAL_KEY or FAL_API_KEY.");
  }
}

function ensureFalConfigured(): void {
  if (configured || !falKey) return;
  fal.config({ credentials: falKey });
  configured = true;
}

const brainjuicePrompt = (topic: string) =>
  `Create an abstract 3D illustration for '${topic}' with no text in the style of an isometric scene with abstract elements and shapes that displays the essence of '${topic}'. Use muted, sophisticated colours with a strong background colour.`;

export async function generateFeedPicture(args: {
  topic: string;
  outputPath: string;
}): Promise<void> {
  if (!falKey) {
    throw new Error("FAL_KEY / FAL_API_KEY is not set");
  }
  ensureFalConfigured();

  const result = await fal.subscribe("fal-ai/flux/schnell", {
    input: {
      prompt: brainjuicePrompt(args.topic),
      image_size: "square_hd",
      num_inference_steps: 4,
      num_images: 1,
      enable_safety_checker: true,
    },
    logs: false,
  });

  const imageUrl = (result.data as { images?: Array<{ url?: string }> }).images?.[0]?.url;
  if (!imageUrl) {
    throw new Error("flux schnell returned no image URL");
  }

  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`failed to download feed image: ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const webp = await sharp(buffer).webp({ quality: 85 }).toBuffer();
  writeFileSync(args.outputPath, webp);
}
