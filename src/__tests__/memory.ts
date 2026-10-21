import {
  describe,
  expect,
  jest,
  test,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { Genkit } from "genkit";
import { Neo4jParams } from "..";

type ToolHandler = (input: Record<string, unknown>) => Promise<unknown>;
type AsyncMock = (...args: unknown[]) => Promise<unknown>;

const asyncMock = (value: unknown) =>
  jest.fn<AsyncMock>().mockResolvedValue(value);

async function loadMemoryModule() {
  // Jest resolves the TypeScript source from this extensionless specifier.
  // @ts-expect-error NodeNext requires an extension for dynamic imports.
  return import("../memory");
}

const toolNames = [
  "addMemoryMessage",
  "getMemoryConversation",
  "listMemorySessions",
  "clearMemorySession",
  "addMemoryEntity",
  "addMemoryFact",
  "addMemoryPreference",
  "searchMemoryEntities",
  "getRelatedMemoryEntities",
  "mergeDuplicateMemoryEntities",
  "startReasoningTrace",
  "addReasoningStep",
  "recordMemoryToolCall",
  "completeReasoningTrace",
];

const uuid = "123e4567-e89b-12d3-a456-426614174000";

function createMockMemoryClient() {
  return {
    connect: asyncMock(undefined),
    shortTerm: {
      addMessage: asyncMock({
        id: "message-1",
        role: "user",
        content: "Hello",
        timestamp: "2026-01-01T00:00:00.000Z",
      }),
      getConversation: asyncMock([{ id: "message-1" }]),
      listSessions: asyncMock([{ id: "session-1" }]),
      clearSession: asyncMock(undefined),
    },
    longTerm: {
      addEntity: asyncMock({ id: "entity-1" }),
      addFact: asyncMock({
        subject: "Neo4j",
        predicate: "is",
        object: "a graph database",
      }),
      addPreference: asyncMock(undefined),
      getEntityByName: asyncMock(undefined),
      searchEntities: asyncMock([{ id: "entity-1" }]),
      getRelatedEntities: asyncMock([{ id: "related-1" }]),
      mergeDuplicateEntities: asyncMock({ id: "entity-1", name: "Neo4j" }),
    },
    reasoning: {
      startTrace: asyncMock({ id: "trace-1" }),
      addStep: asyncMock({ id: "step-1" }),
      recordToolCall: asyncMock({ id: "tool-call-1" }),
      completeTrace: asyncMock(undefined),
    },
  };
}

let mockMemoryClient = createMockMemoryClient();
const mockMemoryClientConstructor = jest.fn();

interface RegisteredTool {
  handler: ToolHandler;
  inputSchema: {
    safeParse: (input: unknown) => { success: boolean };
  };
}

async function configureMemory(
  agentMemory: {
    endpoint?: string;
    apiKey?: string;
    workspaceId?: string;
  } = {
    endpoint: "https://memory.test/v1",
    apiKey: "memory-api-key",
    workspaceId: "memory-workspace",
  },
  clientParams: Record<string, string> = {
    url: "bolt://neo4j.test:7687",
    username: "neo4j",
    password: "neo4j-password",
  },
) {
  const tools = new Map<string, RegisteredTool>();

  const defineTool = jest.fn((definition: any, handler: ToolHandler) => {
    tools.set(definition.name, {
      handler,
      inputSchema: definition.inputSchema,
    });
  });
  const ai = { defineTool } as unknown as Genkit;
  const params = {
    indexId: "test-index",
    clientParams,
    agentMemory,
  } as unknown as Neo4jParams<any>;

  const { configureNeo4jAgentMemoryTools } = await loadMemoryModule();
  await configureNeo4jAgentMemoryTools(ai, params);

  return { tools, defineTool };
}

function getTool(
  tools: Map<string, RegisteredTool>,
  shortName: string,
): RegisteredTool {
  const tool = tools.get(`neo4j/test-index/${shortName}`);
  if (!tool) {
    throw new Error(`Tool ${shortName} was not registered`);
  }
  return tool;
}

describe("Neo4j Agent Memory tools", () => {
  let originalEnvironment: NodeJS.ProcessEnv;

  beforeEach(() => {
    jest.resetModules();
    mockMemoryClient = createMockMemoryClient();
    mockMemoryClientConstructor.mockReset();
    mockMemoryClientConstructor.mockImplementation(() => mockMemoryClient);
    jest.unstable_mockModule("@neo4j-labs/agent-memory", () => ({
      MemoryClient: mockMemoryClientConstructor,
    }));
    originalEnvironment = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnvironment;
    jest.restoreAllMocks();
  });

  test("dynamically imports Agent Memory and registers all enabled tools", async () => {
    const { tools, defineTool } = await configureMemory();

    expect(defineTool).toHaveBeenCalledTimes(toolNames.length);
    expect([...tools.keys()]).toEqual(
      toolNames.map((name) => `neo4j/test-index/${name}`),
    );
    expect(tools.has("neo4j/test-index/addMemoryRelationship")).toBe(false);
    expect(mockMemoryClientConstructor).toHaveBeenCalledWith({
      endpoint: "https://memory.test/v1",
      apiKey: "memory-api-key",
      workspaceId: "memory-workspace",
    });
    expect(mockMemoryClient.connect).toHaveBeenCalledTimes(1);
  });

  test("uses MEMORY_ENDPOINT when agentMemory.endpoint is not configured", async () => {
    process.env.MEMORY_ENDPOINT = "https://env-memory.test/v1";

    await configureMemory({
      apiKey: "memory-api-key",
      workspaceId: "memory-workspace",
    });

    expect(mockMemoryClientConstructor).toHaveBeenCalledWith({
      endpoint: "https://env-memory.test/v1",
      apiKey: "memory-api-key",
      workspaceId: "memory-workspace",
    });
  });

  test("prefers agentMemory.endpoint over MEMORY_ENDPOINT", async () => {
    process.env.MEMORY_ENDPOINT = "https://env-memory.test/v1";

    await configureMemory({
      endpoint: "https://configured-memory.test/v1",
    });

    expect(mockMemoryClientConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "https://configured-memory.test/v1",
      }),
    );
  });

  test("does not use clientParams.url as the Agent Memory endpoint", async () => {
    delete process.env.MEMORY_ENDPOINT;

    const { configureNeo4jAgentMemoryTools } = await loadMemoryModule();

    await expect(
      configureNeo4jAgentMemoryTools(
        { defineTool: jest.fn() } as unknown as Genkit,
        {
          indexId: "test-index",
          clientParams: {
            url: "neo4j+s://database.neo4j.io",
            username: "neo4j",
            password: "password",
          },
        } as unknown as Neo4jParams<any>,
      ),
    ).rejects.toThrow("Agent Memory endpoint is required");

    expect(mockMemoryClientConstructor).not.toHaveBeenCalled();
  });

  test.each([
    "bolt://localhost:7687",
    "neo4j://localhost:7687",
    "neo4j+s://database.neo4j.io",
  ])("rejects %s as an Agent Memory endpoint", async (endpoint) => {
    await expect(
      configureMemory({
        endpoint,
      }),
    ).rejects.toThrow(
      "Agent Memory requires an HTTP or HTTPS service endpoint",
    );

    expect(mockMemoryClientConstructor).not.toHaveBeenCalled();
  });

  test("rejects an invalid Agent Memory endpoint", async () => {
    await expect(
      configureMemory({
        endpoint: "not-a-url",
      }),
    ).rejects.toThrow("Invalid Agent Memory endpoint");

    expect(mockMemoryClientConstructor).not.toHaveBeenCalled();
  });

  test("warns but still registers tools if the connection cannot be initialized", async () => {
    const warning = jest.spyOn(console, "warn").mockImplementation(() => {});
    mockMemoryClient.connect.mockRejectedValueOnce(new Error("unavailable"));

    const { tools } = await configureMemory();

    expect(warning).toHaveBeenCalledWith(
      "[Genkit Neo4j] Warning: Could not connect to memory endpoint at https://memory.test/v1. Tools might fail.",
    );
    expect(tools.size).toBe(toolNames.length);
  });

  test("reports a clear error if Agent Memory cannot be dynamically imported", async () => {
    const importError = new Error("Cannot find module");
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    jest.resetModules();
    jest.unstable_mockModule("@neo4j-labs/agent-memory", () => {
      throw importError;
    });

    const { configureNeo4jAgentMemoryTools } = await loadMemoryModule();

    await expect(
      configureNeo4jAgentMemoryTools(
        { defineTool: jest.fn() } as unknown as Genkit,
        {
          indexId: "test-index",
          clientParams: {
            url: "bolt://neo4j.test:7687",
            username: "neo4j",
            password: "password",
          },
          agentMemory: {
            endpoint: "https://memory.test/v1",
          },
        },
      ),
    ).rejects.toThrow(
      "You must install '@neo4j-labs/agent-memory' to use the agent memory tools. \n" +
        "Internal Error Detail: Cannot find module",
    );
    expect(error).toHaveBeenCalledWith("DYNAMIC IMPORT ERROR:", importError);
    expect(mockMemoryClientConstructor).not.toHaveBeenCalled();
  });

  test("passes through addMemoryMessage arguments and returns the saved message", async () => {
    const metadata = { source: "test" };
    const { tools } = await configureMemory();

    await expect(
      getTool(tools, "addMemoryMessage").handler({
        sessionId: "session-1",
        role: "user",
        content: "Hello",
        metadata,
      }),
    ).resolves.toEqual({
      id: "message-1",
      role: "user",
      content: "Hello",
      timestamp: "2026-01-01T00:00:00.000Z",
    });
    expect(mockMemoryClient.shortTerm.addMessage).toHaveBeenCalledWith(
      "session-1",
      "user",
      "Hello",
      { metadata },
    );
  });

  test("gets a conversation with the requested limit", async () => {
    const { tools } = await configureMemory();

    await expect(
      getTool(tools, "getMemoryConversation").handler({
        sessionId: "session-1",
        limit: 20,
      }),
    ).resolves.toEqual([{ id: "message-1" }]);
    expect(mockMemoryClient.shortTerm.getConversation).toHaveBeenCalledWith(
      "session-1",
      { limit: 20 },
    );
  });

  test("lists sessions with the requested limit", async () => {
    const { tools } = await configureMemory();

    await expect(
      getTool(tools, "listMemorySessions").handler({ limit: 5 }),
    ).resolves.toEqual([{ id: "session-1" }]);
    expect(mockMemoryClient.shortTerm.listSessions).toHaveBeenCalledWith({
      limit: 5,
    });
  });

  test("clears a session and returns the confirmation", async () => {
    const { tools } = await configureMemory();

    await expect(
      getTool(tools, "clearMemorySession").handler({ sessionId: "session-1" }),
    ).resolves.toBe("Session session-1 cleared.");
    expect(mockMemoryClient.shortTerm.clearSession).toHaveBeenCalledWith(
      "session-1",
    );
  });

  test("adds an entity with its optional description", async () => {
    const { tools } = await configureMemory();

    await expect(
      getTool(tools, "addMemoryEntity").handler({
        name: "Neo4j",
        entityType: "TECHNOLOGY",
        description: "A graph database",
      }),
    ).resolves.toBe(
      "Entity 'Neo4j' saved successfully to memory. ID: entity-1",
    );
    expect(mockMemoryClient.longTerm.addEntity).toHaveBeenCalledWith(
      "Neo4j",
      "TECHNOLOGY",
      { description: "A graph database" },
    );
  });

  test("adds a fact", async () => {
    const { tools } = await configureMemory();

    await expect(
      getTool(tools, "addMemoryFact").handler({
        subject: "Neo4j",
        predicate: "is",
        object: "a graph database",
      }),
    ).resolves.toBe("Fact saved: Neo4j is a graph database");
    expect(mockMemoryClient.longTerm.addFact).toHaveBeenCalledWith(
      "Neo4j",
      "is",
      "a graph database",
    );
  });

  test("adds a preference with optional context", async () => {
    const { tools } = await configureMemory();

    await expect(
      getTool(tools, "addMemoryPreference").handler({
        category: "style",
        preference: "concise",
        context: "technical responses",
      }),
    ).resolves.toBe("Preference saved under category 'style'.");
    expect(mockMemoryClient.longTerm.addPreference).toHaveBeenCalledWith(
      "style",
      "concise",
      { context: "technical responses" },
    );
  });

  test("searches entities with the requested limit", async () => {
    const { tools } = await configureMemory();

    await expect(
      getTool(tools, "searchMemoryEntities").handler({
        query: "graph databases",
        limit: 3,
      }),
    ).resolves.toEqual([{ id: "entity-1" }]);
    expect(mockMemoryClient.longTerm.searchEntities).toHaveBeenCalledWith(
      "graph databases",
      { limit: 3 },
    );
  });

  test("resolves a name to its entity UUID before fetching related entities", async () => {
    mockMemoryClient.longTerm.getEntityByName.mockResolvedValueOnce({
      id: uuid,
    });
    const { tools } = await configureMemory();

    await expect(
      getTool(tools, "getRelatedMemoryEntities").handler({
        entityId: "Neo4j",
        relationshipType: "USES",
        depth: 2,
      }),
    ).resolves.toEqual([{ id: "related-1" }]);
    expect(mockMemoryClient.longTerm.getEntityByName).toHaveBeenCalledWith(
      "Neo4j",
    );
    expect(mockMemoryClient.longTerm.getRelatedEntities).toHaveBeenCalledWith(
      uuid,
      { relationshipType: "USES", depth: 2 },
    );
  });

  test("does not look up an entity when getRelatedMemoryEntities receives a UUID", async () => {
    const { tools } = await configureMemory();

    await getTool(tools, "getRelatedMemoryEntities").handler({
      entityId: uuid,
    });

    expect(mockMemoryClient.longTerm.getEntityByName).not.toHaveBeenCalled();
    expect(mockMemoryClient.longTerm.getRelatedEntities).toHaveBeenCalledWith(
      uuid,
      { relationshipType: undefined, depth: undefined },
    );
  });

  test.each([
    [
      "lookup throws",
      async () => {
        mockMemoryClient.longTerm.getEntityByName.mockRejectedValueOnce(
          new Error("lookup failed"),
        );
      },
    ],
    [
      "entity is not found",
      async () => {
        mockMemoryClient.longTerm.getEntityByName.mockResolvedValueOnce(null);
      },
    ],
    [
      "entity has no id",
      async () => {
        mockMemoryClient.longTerm.getEntityByName.mockResolvedValueOnce({});
      },
    ],
  ])("falls back to the original entity name when %s", async (_case, setup) => {
    await setup();
    const { tools } = await configureMemory();

    await getTool(tools, "getRelatedMemoryEntities").handler({
      entityId: "missing entity",
    });

    expect(mockMemoryClient.longTerm.getRelatedEntities).toHaveBeenCalledWith(
      "missing entity",
      { relationshipType: undefined, depth: undefined },
    );
  });

  test("resolves both entity names before merging duplicates", async () => {
    mockMemoryClient.longTerm.getEntityByName
      .mockResolvedValueOnce({ id: "source-uuid" })
      .mockResolvedValueOnce({ id: "target-uuid" });
    const { tools } = await configureMemory();

    await expect(
      getTool(tools, "mergeDuplicateMemoryEntities").handler({
        sourceId: "Neo4j DB",
        targetId: "Neo4j",
        canonicalName: "Neo4j",
      }),
    ).resolves.toBe("Entities merged into 'Neo4j' (entity-1).");
    expect(
      mockMemoryClient.longTerm.mergeDuplicateEntities,
    ).toHaveBeenCalledWith("source-uuid", "target-uuid", {
      canonicalName: "Neo4j",
    });
  });

  test("adds UUID values directly when merging duplicate entities", async () => {
    const { tools } = await configureMemory();

    await getTool(tools, "mergeDuplicateMemoryEntities").handler({
      sourceId: uuid,
      targetId: uuid,
    });

    expect(mockMemoryClient.longTerm.getEntityByName).not.toHaveBeenCalled();
    expect(
      mockMemoryClient.longTerm.mergeDuplicateEntities,
    ).toHaveBeenCalledWith(uuid, uuid, { canonicalName: undefined });
  });

  test("starts a reasoning trace", async () => {
    const { tools } = await configureMemory();

    await expect(
      getTool(tools, "startReasoningTrace").handler({
        sessionId: "session-1",
        task: "Find a route",
      }),
    ).resolves.toEqual({
      message: "Trace started. Use traceId for subsequent steps.",
      traceId: "trace-1",
    });
    expect(mockMemoryClient.reasoning.startTrace).toHaveBeenCalledWith(
      "session-1",
      "Find a route",
    );
  });

  test("adds a reasoning step", async () => {
    const { tools } = await configureMemory();
    const input = {
      traceId: "trace-1",
      thought: "Check the map",
      action: "query route service",
      observation: "Two routes found",
    };

    await expect(
      getTool(tools, "addReasoningStep").handler(input),
    ).resolves.toEqual({ message: "Step recorded.", stepId: "step-1" });
    expect(mockMemoryClient.reasoning.addStep).toHaveBeenCalledWith("trace-1", {
      thought: "Check the map",
      action: "query route service",
      observation: "Two routes found",
    });
  });

  test("records a successful tool call with its result", async () => {
    const { tools } = await configureMemory();
    const args = { query: "route" };

    await expect(
      getTool(tools, "recordMemoryToolCall").handler({
        stepId: "step-1",
        toolName: "route-search",
        arguments: args,
        result: ["route-a"],
        status: "success",
      }),
    ).resolves.toEqual({
      message: "Tool call recorded.",
      toolCallId: "tool-call-1",
    });
    expect(mockMemoryClient.reasoning.recordToolCall).toHaveBeenCalledWith(
      "step-1",
      "route-search",
      args,
      { result: ["route-a"], status: "success", error: undefined },
    );
  });

  test("records failed tool calls and their error detail", async () => {
    const { tools } = await configureMemory();

    await getTool(tools, "recordMemoryToolCall").handler({
      stepId: "step-1",
      toolName: "route-search",
      arguments: {},
      status: "error",
      error: "service unavailable",
    });

    expect(mockMemoryClient.reasoning.recordToolCall).toHaveBeenCalledWith(
      "step-1",
      "route-search",
      {},
      { result: undefined, status: "error", error: "service unavailable" },
    );
  });

  test("completes a reasoning trace", async () => {
    const { tools } = await configureMemory();

    await expect(
      getTool(tools, "completeReasoningTrace").handler({
        traceId: "trace-1",
        outcome: "Route found",
        success: true,
      }),
    ).resolves.toBe("Trace trace-1 completed.");
    expect(mockMemoryClient.reasoning.completeTrace).toHaveBeenCalledWith(
      "trace-1",
      { outcome: "Route found", success: true },
    );
  });

  test("validates tool inputs through their registered schemas", async () => {
    const { tools } = await configureMemory();

    expect(
      getTool(tools, "addMemoryMessage").inputSchema.safeParse({
        sessionId: "session-1",
        role: "user",
        content: "Hello",
      }).success,
    ).toBe(true);
    expect(
      getTool(tools, "addMemoryMessage").inputSchema.safeParse({
        sessionId: "session-1",
        role: "tool",
        content: "Hello",
      }).success,
    ).toBe(false);
  });

  test.each([
    [
      "addMemoryMessage",
      "addMessage",
      { sessionId: "session-1", role: "user", content: "Hello" },
    ],
    ["getMemoryConversation", "getConversation", { sessionId: "session-1" }],
    ["listMemorySessions", "listSessions", {}],
    ["clearMemorySession", "clearSession", { sessionId: "session-1" }],
    [
      "addMemoryEntity",
      "addEntity",
      { name: "Neo4j", entityType: "TECHNOLOGY" },
    ],
    [
      "addMemoryFact",
      "addFact",
      { subject: "Neo4j", predicate: "is", object: "a database" },
    ],
    [
      "addMemoryPreference",
      "addPreference",
      { category: "style", preference: "concise" },
    ],
    ["searchMemoryEntities", "searchEntities", { query: "graph" }],
    ["getRelatedMemoryEntities", "getRelatedEntities", { entityId: uuid }],
    [
      "mergeDuplicateMemoryEntities",
      "mergeDuplicateEntities",
      { sourceId: uuid, targetId: uuid },
    ],
    [
      "startReasoningTrace",
      "startTrace",
      { sessionId: "session-1", task: "Find a route" },
    ],
    [
      "addReasoningStep",
      "addStep",
      { traceId: "trace-1", thought: "Check", action: "search" },
    ],
    [
      "recordMemoryToolCall",
      "recordToolCall",
      { stepId: "step-1", toolName: "search", arguments: {} },
    ],
    [
      "completeReasoningTrace",
      "completeTrace",
      { traceId: "trace-1", outcome: "done", success: false },
    ],
  ])("%s propagates SDK failures", async (toolName, methodName, input) => {
    const failedMethod =
      toolName === "addMemoryMessage" ||
      toolName === "getMemoryConversation" ||
      toolName === "listMemorySessions" ||
      toolName === "clearMemorySession"
        ? mockMemoryClient.shortTerm[
            methodName as keyof typeof mockMemoryClient.shortTerm
          ]
        : toolName === "addMemoryEntity" ||
            toolName === "addMemoryFact" ||
            toolName === "addMemoryPreference" ||
            toolName === "searchMemoryEntities" ||
            toolName === "getRelatedMemoryEntities" ||
            toolName === "mergeDuplicateMemoryEntities"
          ? mockMemoryClient.longTerm[
              methodName as keyof typeof mockMemoryClient.longTerm
            ]
          : mockMemoryClient.reasoning[
              methodName as keyof typeof mockMemoryClient.reasoning
            ];
    const sdkError = new Error(`${methodName} failed`);
    failedMethod.mockRejectedValueOnce(sdkError);
    const { tools } = await configureMemory();

    await expect(getTool(tools, toolName).handler(input)).rejects.toBe(
      sdkError,
    );
  });
});
