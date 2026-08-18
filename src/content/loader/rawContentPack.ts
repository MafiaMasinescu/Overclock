import balancing from "../../../content/balancing.json" with { type: "json" };
import en from "../../../content/en/common.json" with { type: "json" };
import era from "../../../content/era.json" with { type: "json" };
import modules from "../../../content/modules.json" with { type: "json" };
import research from "../../../content/research.json" with { type: "json" };
import ro from "../../../content/ro/common.json" with { type: "json" };
import tasks from "../../../content/tasks.json" with { type: "json" };

const suppliedRawContentPack = {
  modules,
  tasks,
  research,
  era,
  balancing,
  locales: { ro, en },
};

export type RawContentPack = typeof suppliedRawContentPack;

export function createRawContentPack(): RawContentPack {
  return structuredClone(suppliedRawContentPack);
}
