import { ContentValidationError, loadContentBundle } from "../src/content/loader/contentLoader.ts";

try {
  const bundle = loadContentBundle();
  console.log(
    `Content validation passed: ${Object.keys(bundle.modules).length} modules, ` +
      `${Object.keys(bundle.tasks).length} tasks, ${Object.keys(bundle.research).length} research nodes, ` +
      `${bundle.era.benchmarkDefinitions.length} benchmarks, ${Object.keys(bundle.locales).length} locales.`,
  );
} catch (error: unknown) {
  if (error instanceof ContentValidationError) {
    console.error(`Content validation failed:\n${error.message}`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
