import { loadContentBundle } from "../../../src/content/loader/contentLoader.ts";
import type { ContentBundle } from "../../../src/content/schemas/contentSchemas.ts";

export function loadWorkerManualFixtureContent(): ContentBundle {
  const content = structuredClone(loadContentBundle());
  // The fixture funds exactly the first node so the browser trace exercises
  // an accepted Research operation without adding a production debug command.
  return { ...content, era: { ...content.era, startingResearchData: 12 } };
}
