/**
 * Gemini-backed LLM helpers used by the build step.
 *
 * Requires `GOOGLE_GENERATIVE_AI_API_KEY` (or `GEMINI_API_KEY`) to be set.
 * The build validates this at startup so missing credentials fail fast.
 */

import { google } from "@ai-sdk/google";
import { generateObject, streamObject, type ModelMessage } from "ai";
import { createFallback } from "ai-fallback";
import { z } from "zod";
import { chooseTagsPrompt } from "../prompts/chooseTagsPrompt";
import { threadPrompt } from "../prompts/threadPrompt";
import { postCopyPrompt } from "../prompts/postCopyPrompt";
import { profileNamePrompt } from "../prompts/profileNamePrompt";
import { renderTagHierarchyForPrompt, resolveTagNameToIds } from "../shared/tagTree";
import type { Comment } from "../shared/manifest";

/**
 * Split a `[{system}, {user}]`-shaped prompt into the `system + messages`
 * form the AI SDK prefers. Avoids the "system messages in messages field"
 * security warning without changing prompt content.
 */
function splitSystem(messages: ModelMessage[]): {
  system: string;
  messages: ModelMessage[];
} {
  let system = "";
  const rest: ModelMessage[] = [];
  for (const message of messages) {
    if (message.role === "system" && typeof message.content === "string" && !system) {
      system = message.content;
    } else {
      rest.push(message);
    }
  }
  return { system, messages: rest };
}

const apiKey =
  process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GEMINI_API_KEY;

export function isLlmConfigured(): boolean {
  return Boolean(apiKey);
}

export function assertLlmConfigured(): void {
  if (!apiKey) {
    throw new Error(
      "Missing Gemini API key. Set GOOGLE_GENERATIVE_AI_API_KEY or GEMINI_API_KEY.",
    );
  }
}

const modelFallbacks = () =>
  createFallback({
    models: [
      google("gemini-3.1-flash-lite"),
      google("gemini-2.5-flash-lite-preview-09-2025"),
      google("gemini-2.5-flash-lite"),
      google("gemini-3-flash-preview"),
      google("gemini-2.5-flash"),
    ],
    onError(error, modelId) {
      console.warn(`[llm] model ${modelId} failed:`, errorMessage(error));
    },
  });

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const postCopySchema = z.object({
  shortTitle: z.string().min(1).max(120),
  videoDescription: z.string().min(1).max(600),
});

export async function generatePostCopy(extractedText: string): Promise<{
  shortTitle: string;
  videoDescription: string;
}> {
  if (!extractedText.trim()) {
    return {
      shortTitle: "Demo Video",
      videoDescription: "A short HyperFrames demo composition.",
    };
  }
  const split = splitSystem(postCopyPrompt(extractedText));
  const result = await generateObject({
    model: modelFallbacks(),
    schema: postCopySchema,
    system: split.system,
    messages: split.messages,
    providerOptions: {
      google: { thinkingConfig: { thinkingBudget: 0 } },
    },
    temperature: 0.2,
  });
  return result.object;
}

const profileNameSchema = z.object({ name: z.string().min(1).max(64) });

export async function generateProfileName(args: {
  feedName: string;
  feedDescription?: string;
}): Promise<string> {
  const split = splitSystem(profileNamePrompt(args.feedName, args.feedDescription));
  const result = await generateObject({
    model: modelFallbacks(),
    schema: profileNameSchema,
    system: split.system,
    messages: split.messages,
    providerOptions: {
      google: { thinkingConfig: { thinkingBudget: 0 } },
    },
    temperature: 0.7,
  });
  return result.object.name;
}

const chooseTagsSchema = z.object({ tags: z.array(z.string()) });

export async function chooseTagsForFeed(args: {
  feedName: string;
  blueprint: string;
}): Promise<string[]> {
  const split = splitSystem(
    chooseTagsPrompt(args.feedName, args.blueprint, renderTagHierarchyForPrompt()),
  );
  const result = await generateObject({
    model: modelFallbacks(),
    schema: chooseTagsSchema,
    system: split.system,
    messages: split.messages,
    providerOptions: {
      google: { thinkingConfig: { thinkingBudget: 0 } },
    },
    temperature: 0,
  });

  const seen = new Set<string>();
  const out: string[] = [];
  for (const tagName of result.object.tags) {
    for (const id of resolveTagNameToIds(tagName)) {
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
  }
  return out;
}

const commentSchema = z.object({
  text: z.string().min(1),
  probability: z.number().min(0).max(1).optional(),
});

export async function generateCommentsForPost(args: {
  shortTitle: string;
  videoDescription: string;
}): Promise<Comment[]> {
  const rootPost = {
    text: args.shortTitle,
    description: args.videoDescription,
    displayStyle: "BASIC" as const,
  };
  const prompt = threadPrompt({
    topic: args.shortTitle,
    parentPost: JSON.stringify(rootPost, null, 2),
    previousPosts: [],
    language: "English",
  });

  const stream = await streamObject({
    model: modelFallbacks(),
    output: "array",
    schema: commentSchema,
    providerOptions: {
      google: { thinkingConfig: { thinkingBudget: 0 } },
    },
    prompt,
    temperature: 0.7,
  });

  const out: Comment[] = [];
  let sortOrder = 0;
  for await (const element of stream.elementStream) {
    out.push({
      text: element.text,
      sortOrder: sortOrder++,
      probability: element.probability,
    });
  }
  return out;
}
