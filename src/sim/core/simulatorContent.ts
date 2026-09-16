import { loadContentBundle } from "../../content/loader/contentLoader.ts";
import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";

let bundledContent: ContentBundle | undefined;

/**
 * Keeps direct SimCore/CommandProcessor construction source-compatible while ensuring that every
 * authoritative GameState is interpreted against validated content. Production callers continue
 * to inject their already validated bundle explicitly.
 */
export function resolveSimulatorContent(content: ContentBundle | undefined): ContentBundle {
  if (content !== undefined) return content;
  bundledContent ??= loadContentBundle();
  return bundledContent;
}
