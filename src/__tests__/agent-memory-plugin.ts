import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Genkit } from "genkit";
import type { Neo4jParams } from "..";
import type { ZodTypeAny } from "zod";

type TestNeo4jParams = Neo4jParams<ZodTypeAny>;
type ConfigureMemory = (ai: Genkit, params: TestNeo4jParams) => Promise<void>;

const configureMemory = jest.fn<ConfigureMemory>();

async function loadNeo4j() {
  // @ts-expect-error NodeNext requires an extension for dynamic imports.
  return import("../index");
}

async function initializeNeo4j(configurations: TestNeo4jParams[]) {
  const { genkit } = await import("genkit");
  const { neo4j } = await loadNeo4j();
  const ai = genkit({ plugins: [neo4j(configurations)] });

  await ai.registry.lookupAction(
    `/retriever/neo4j/${String(configurations[0].indexId)}`,
  );

  return ai;
}

describe("Neo4j Agent Memory plugin wiring", () => {
  beforeEach(() => {
    jest.resetModules();
    configureMemory.mockReset();
    configureMemory.mockResolvedValue(undefined);
    jest.unstable_mockModule("../memory", () => ({
      configureNeo4jAgentMemoryTools: configureMemory,
    }));
    jest.doMock("../memory", () => ({
      configureNeo4jAgentMemoryTools: configureMemory,
    }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("initializes Agent Memory when enabled", async () => {
    const clientParams = {
      url: "bolt://localhost:7687",
      username: "neo4j",
      password: "secret",
    };
    const configuration = {
      indexId: "memory-enabled",
      embedder: "test-embedder",
      clientParams,
      enableAgentMemoryTools: true,
    };

    const ai = await initializeNeo4j([configuration]);

    expect(configureMemory).toHaveBeenCalledTimes(1);
    expect(configureMemory).toHaveBeenCalledWith(ai, configuration);
  });

  test.each([
    ["false", false],
    ["omitted", undefined],
  ])(
    "does not initialize Agent Memory when the flag is %s",
    async (_label, enabled) => {
      const configuration = {
        indexId: `memory-disabled-${String(enabled)}`,
        embedder: "test-embedder",
        clientParams: {
          url: "bolt://localhost:7687",
          username: "neo4j",
          password: "secret",
        },
        ...(enabled === undefined ? {} : { enableAgentMemoryTools: enabled }),
      };

      await initializeNeo4j([configuration]);

      expect(configureMemory).not.toHaveBeenCalled();
    },
  );

  test("initializes Agent Memory only for enabled configurations", async () => {
    const configurations = [
      {
        indexId: "memory-disabled",
        embedder: "test-embedder",
        clientParams: {
          url: "bolt://localhost:7687",
          username: "neo4j",
          password: "secret",
        },
        enableAgentMemoryTools: false,
      },
      {
        indexId: "memory-enabled-one",
        embedder: "test-embedder",
        clientParams: {
          url: "bolt://localhost:7688",
          username: "user-one",
          password: "password-one",
        },
        enableAgentMemoryTools: true,
      },
      {
        indexId: "memory-enabled-two",
        embedder: "test-embedder",
        clientParams: {
          url: "bolt://localhost:7689",
          username: "user-two",
          password: "password-two",
        },
        enableAgentMemoryTools: true,
      },
    ];

    await initializeNeo4j(configurations);

    expect(configureMemory).toHaveBeenCalledTimes(2);
    expect(configureMemory).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      configurations[1],
    );
    expect(configureMemory).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      configurations[2],
    );
  });

  test("propagates Agent Memory initialization errors", async () => {
    const initializationError = new Error("Agent Memory setup failed");
    configureMemory.mockRejectedValueOnce(initializationError);

    await expect(
      initializeNeo4j([
        {
          indexId: "memory-error",
          embedder: "test-embedder",
          clientParams: {
            url: "bolt://localhost:7687",
            username: "neo4j",
            password: "secret",
          },
          enableAgentMemoryTools: true,
        },
      ]),
    ).rejects.toBe(initializationError);
    expect(configureMemory).toHaveBeenCalledTimes(1);
  });
});
