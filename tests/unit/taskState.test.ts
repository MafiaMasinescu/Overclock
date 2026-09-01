import { describe, expect, test } from "vitest";

import { validateContent } from "../../src/content/loader/contentLoader.ts";
import { createRawContentPack } from "../../src/content/loader/rawContentPack.ts";
import { SimCore } from "../../src/sim/core/simCore.ts";
import {
  secondsToTaskTicks,
  validateContentAwareTaskState,
  validateStoredTaskState,
} from "../../src/sim/tasks/taskState.ts";
import {
  createTaskInstanceFixture,
  createTaskStateFixture,
  taskContent,
} from "../helpers/taskStateFixture.ts";

describe("Task lifecycle stored state", () => {
  test("is enforced at initial SimCore construction without consuming RNG", () => {
    const state = createTaskStateFixture();
    const rngState = state.rngState;

    expect(() => new SimCore({ initialState: state })).not.toThrow();
    expect(state.rngState).toBe(rngState);
  });

  test.each(["accepted", "active", "hold", "completed", "failed", "abandoned"] as const)(
    "accepts a structurally valid %s instance",
    (status) => {
      expect(validateStoredTaskState(createTaskStateFixture(status))).toEqual([]);
    },
  );

  test.each([
    {
      name: "instance ID that disagrees with its key",
      mutate: (state: ReturnType<typeof createTaskStateFixture>) => {
        const instance = createTaskInstanceFixture();
        state.tasks.instances = { wrong: instance };
      },
      path: "tasks.instances.wrong.id",
    },
    {
      name: "noncanonical generated task ID",
      mutate: (state: ReturnType<typeof createTaskStateFixture>) => {
        const instance = createTaskInstanceFixture();
        instance.id = "task-instance-1";
        state.tasks.instances = { [instance.id]: instance };
      },
      path: "tasks.instances.task-instance-1.id",
    },
    {
      name: "nonpositive task instance sequence",
      mutate: (state: ReturnType<typeof createTaskStateFixture>) => {
        state.tasks.nextTaskInstanceSequence = 0;
      },
      path: "tasks.nextTaskInstanceSequence",
    },
    {
      name: "reused task instance sequence",
      mutate: (state: ReturnType<typeof createTaskStateFixture>) => {
        state.tasks.nextTaskInstanceSequence = 1;
      },
      path: "tasks.nextTaskInstanceSequence",
    },
    {
      name: "negative completed operations",
      mutate: (state: ReturnType<typeof createTaskStateFixture>) => {
        const instance = createTaskInstanceFixture();
        instance.totalCompletedOperations = -1;
        state.tasks.instances = { [instance.id]: instance };
      },
      path: "tasks.instances.task-instance-00000001.totalCompletedOperations",
    },
    {
      name: "empty allocation cluster",
      mutate: (state: ReturnType<typeof createTaskStateFixture>) => {
        const instance = createTaskInstanceFixture();
        if (instance.allocation === null) throw new Error("Expected allocation fixture.");
        instance.allocation.clusterModuleIds = [];
        state.tasks.instances = { [instance.id]: instance };
      },
      path: "tasks.instances.task-instance-00000001.allocation.clusterModuleIds",
    },
    {
      name: "slot capacity overrun",
      mutate: (state: ReturnType<typeof createTaskStateFixture>) => {
        const first = createTaskInstanceFixture("accepted");
        const second = {
          ...createTaskInstanceFixture("active"),
          id: "task-instance-00000002",
          definitionId: "task-wiring-layout-study",
        };
        const third = {
          ...createTaskInstanceFixture("hold"),
          id: "task-instance-00000003",
          definitionId: "task-reactor-diffusion-study",
        };
        state.tasks.instances = { [first.id]: first, [second.id]: second, [third.id]: third };
      },
      path: "tasks.activeSlotCount",
    },
    {
      name: "active module share overrun",
      mutate: (state: ReturnType<typeof createTaskStateFixture>) => {
        const first = createTaskInstanceFixture();
        const second = {
          ...createTaskInstanceFixture(),
          id: "task-instance-00000002",
          definitionId: "task-wiring-layout-study",
        };
        state.tasks.instances = { [first.id]: first, [second.id]: second };
      },
      path: "tasks.activeShares.module-instance-00000001",
    },
    {
      name: "service compliance on a non-service definition",
      mutate: (state: ReturnType<typeof createTaskStateFixture>) => {
        const instance = createTaskInstanceFixture();
        instance.serviceWindowCompliant = true;
        state.tasks.instances = { [instance.id]: instance };
      },
      path: "tasks.instances.task-instance-00000001.serviceWindowCompliant",
    },
  ])("rejects $name", ({ mutate, path }) => {
    const state = createTaskStateFixture();
    mutate(state);

    expect(
      (path.endsWith("serviceWindowCompliant") || path.endsWith("task-instance-1.id")
        ? validateContentAwareTaskState(state, taskContent)
        : validateStoredTaskState(state)
      ).some((issue) => issue.path === path),
    ).toBe(true);
  });

  test("rejects invalid Task state replacement without changing authoritative state", () => {
    const core = new SimCore({ initialState: createTaskStateFixture() });
    const before = core.getStateForSave();
    const replacement = structuredClone(before);
    replacement.tasks.nextTaskInstanceSequence = 1;

    expect(() => {
      core.replaceState(replacement);
    }).toThrow("must exceed every generated");
    expect(core.getStateForSave()).toEqual(before);
  });
});

describe("Task lifecycle content contracts", () => {
  test("validates service shape and content-aware phase bounds", () => {
    const state = createTaskStateFixture("accepted");
    const service = createTaskInstanceFixture("accepted");
    service.id = "task-instance-00000002";
    service.definitionId = "task-census-tabulation-service";
    service.deadlineTick = null;
    service.serviceWindowCompliant = true;
    state.tasks.offers = [];
    state.tasks.nextTaskInstanceSequence = 3;
    const project = state.tasks.instances["task-instance-00000001"];
    if (project === undefined) throw new Error("Expected project fixture.");
    state.tasks.instances = {
      [project.id]: project,
      [service.id]: service,
    };

    expect(validateContentAwareTaskState(state, taskContent)).toEqual([]);
  });

  test.each([
    { field: "deadlineSeconds", value: 0.15, path: "tasks.tasks[0].deadlineSeconds" },
    { field: "periodicPayoutSeconds", value: 0.15, path: "tasks.tasks[1].periodicPayoutSeconds" },
  ])("rejects $field values that cannot map exactly to ticks", ({ field, value, path }) => {
    const pack = createRawContentPack();
    const project = pack.tasks.tasks[0];
    const service = pack.tasks.tasks[1];
    if (project === undefined || service === undefined)
      throw new Error("Expected Task content fixtures.");
    if (field === "deadlineSeconds") project.deadlineSeconds = value;
    else service.periodicPayoutSeconds = value;

    expect(() => validateContent(pack)).toThrow(path);
  });

  test("converts whole seconds to exact 100 ms task ticks", () => {
    expect(secondsToTaskTicks(210, "deadline")).toBe(2_100);
    expect(() => secondsToTaskTicks(0.15, "deadline")).toThrow(
      "exact positive safe integer tick count",
    );
  });
});
