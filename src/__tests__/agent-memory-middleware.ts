import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { GenerateMiddlewareDef, GenerateResponseData } from "genkit";

const mockMemoryClient = {
  connect: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  shortTerm: {
    createConversation: jest
      .fn<(options: { userId: string }) => Promise<{ id: string }>>()
      .mockResolvedValue({ id: "created-conversation" }),
    addMessage: jest
      .fn<
        (
          conversationId: string,
          role: "user" | "assistant",
          content: string,
        ) => Promise<unknown>
      >()
      .mockResolvedValue({}),
  },
};

const mockMemoryClientConstructor = jest.fn(
  (_options: { endpoint: string; apiKey?: string; workspaceId?: string }) =>
    mockMemoryClient,
);

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Unavailable",
    json: async () => body,
  } as Response;
}

async function loadMiddleware() {
  // @ts-expect-error NodeNext requires an extension for dynamic imports.
  return import("../agent-memory-middleware");
}

describe("Neo4j Agent Memory generate middleware", () => {
  beforeEach(() => {
    jest.resetModules();
    mockMemoryClient.connect.mockReset().mockResolvedValue(undefined);
    mockMemoryClient.shortTerm.createConversation
      .mockReset()
      .mockResolvedValue({ id: "created-conversation" });
    mockMemoryClient.shortTerm.addMessage.mockReset().mockResolvedValue({});
    mockMemoryClientConstructor.mockReset();
    mockMemoryClientConstructor.mockImplementation(() => mockMemoryClient);
    jest.unstable_mockModule("@neo4j-labs/agent-memory", () => ({
      MemoryClient: mockMemoryClientConstructor,
    }));
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ messages: [] }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("searches messages, filters and ranks results, and persists the text exchange", async () => {
    const fetchMock = jest.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue(
      jsonResponse({
        messages: [
          {
            id: "current-question-1",
            role: "user",
            content: " WHAT do I prefer? ",
            score: 1,
          },
          {
            id: "current-question-2",
            role: "user",
            content: "What do I prefer?",
            score: 1,
          },
          {
            id: "fact-user",
            role: "user",
            content: "I prefer concise answers.",
            score: 0.9,
            timestamp: "2026-11-01T10:00:00.000Z",
          },
          {
            id: "fact-assistant",
            role: "assistant",
            content: "You prefer concise answers.",
            score: 0.91,
            timestamp: "2026-11-01T10:00:00.000Z",
          },
          {
            id: "newer",
            role: "user",
            content: "Newer preference evidence",
            score: 0.8,
            timestamp: "2026-11-03T10:00:00.000Z",
          },
          {
            id: "older",
            role: "user",
            content: "Older preference evidence",
            score: 0.8,
            timestamp: "2026-11-01T10:00:00.000Z",
          },
          {
            id: "duplicate-content-1",
            role: "user",
            content: "Use TypeScript",
            score: 0.75,
          },
          {
            id: "duplicate-content-2",
            role: "assistant",
            content: "  use   typescript ",
            score: 0.95,
          },
          {
            id: "duplicate-id",
            role: "user",
            content: "First ID value",
            score: 0.7,
          },
          {
            id: "duplicate-id",
            role: "assistant",
            content: "Second ID value",
            score: 0.99,
          },
        ],
      }),
    );

    const { neo4jAgentMemoryMiddleware } = await loadMiddleware();
    const middleware = neo4jAgentMemoryMiddleware.instantiate({
      config: {
        conversationId: "conversation-1",
        userId: "user-123",
        endpoint: "https://memory.test/v1/",
        apiKey: "test-key",
        workspaceId: "workspace-1",
      },
      pluginConfig: undefined,
      ai: {} as never,
    });
    const response = {
      message: { role: "model", content: [{ text: "Hello from memory." }] },
    } as GenerateResponseData;
    let requestMessages:
      | Parameters<
          NonNullable<GenerateMiddlewareDef["generate"]>
        >[0]["request"]["messages"]
      | undefined;
    const next = jest.fn(
      async (
        envelope: Parameters<NonNullable<GenerateMiddlewareDef["generate"]>>[0],
      ) => {
        requestMessages = envelope.request.messages;
        return response;
      },
    );

    await middleware.generate!(
      {
        request: {
          messages: [
            { role: "user", content: [{ text: "What do I prefer?" }] },
          ],
        },
        currentTurn: 0,
        messageIndex: 0,
      },
      {} as never,
      next,
    );

    expect(mockMemoryClientConstructor).toHaveBeenCalledWith({
      endpoint: "https://memory.test/v1/",
      apiKey: "test-key",
      workspaceId: "workspace-1",
    });
    expect(mockMemoryClient.connect).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://memory.test/v1/messages/search",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer test-key",
          "X-Workspace-Id": "workspace-1",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: "What do I prefer?",
          conversationId: "conversation-1",
          limit: 20,
        }),
      }),
    );

    const searchBody = JSON.parse(
      fetchMock.mock.calls[0]?.[1]?.body as string,
    ) as Record<string, unknown>;
    expect(searchBody).not.toHaveProperty("threshold");
    expect(
      mockMemoryClient.shortTerm.createConversation,
    ).not.toHaveBeenCalled();

    expect(requestMessages?.[0].role).toBe("system");
    const injectedText = requestMessages?.[0].content
      .map((part) => ("text" in part ? part.text : ""))
      .join("\n");
    expect(injectedText).toContain("- [user] I prefer concise answers.");

    expect(injectedText).toContain("- [assistant] You prefer concise answers.");

    expect(injectedText).toContain("- [user] Newer preference evidence");

    expect(injectedText).not.toContain("WHAT do I prefer?");

    expect(injectedText).not.toContain("[user] What do I prefer?");

    expect(next).toHaveBeenCalledTimes(1);
    expect(mockMemoryClient.shortTerm.addMessage).toHaveBeenNthCalledWith(
      1,
      "conversation-1",
      "user",
      "What do I prefer?",
    );
    expect(mockMemoryClient.shortTerm.addMessage).toHaveBeenNthCalledWith(
      2,
      "conversation-1",
      "assistant",
      "Hello from memory.",
    );
  });

  test("limits injected context to complete messages and merges it into system messages", async () => {
    jest.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse({
        messages: [
          {
            id: "first",
            role: "user",
            content: "First complete message",
            score: 1,
          },
          {
            id: "second",
            role: "user",
            content: "Second message that must not be truncated",
            score: 0.9,
          },
        ],
      }),
    );
    const firstLine = "- [user] First complete message";
    const { neo4jAgentMemoryMiddleware } = await loadMiddleware();
    const middleware = neo4jAgentMemoryMiddleware.instantiate({
      config: {
        conversationId: "conversation-1",
        userId: "user-123",
        endpoint: "https://memory.test/v1",
        maxContextChars:
          "Relevant historical messages:\n".length + firstLine.length,
      },
      pluginConfig: undefined,
      ai: {} as never,
    });
    let requestMessages:
      | Parameters<
          NonNullable<GenerateMiddlewareDef["generate"]>
        >[0]["request"]["messages"]
      | undefined;
    const next = jest.fn(
      async (
        envelope: Parameters<NonNullable<GenerateMiddlewareDef["generate"]>>[0],
      ) => {
        requestMessages = envelope.request.messages;
        return {} as GenerateResponseData;
      },
    );

    await middleware.generate!(
      {
        request: {
          messages: [
            {
              role: "system",
              content: [{ text: "Existing system instruction." }],
            },
            { role: "user", content: [{ text: "Question?" }] },
          ],
        },
        currentTurn: 0,
        messageIndex: 0,
      },
      {} as never,
      next,
    );

    const systemMessages =
      requestMessages?.filter((message) => message.role === "system") ?? [];
    expect(systemMessages).toHaveLength(1);
    expect(
      systemMessages[0].content
        .map((part) => ("text" in part ? part.text : ""))
        .join("\n"),
    ).toContain("Existing system instruction.");
    const injectedText = systemMessages[0].content
      .map((part) => ("text" in part ? part.text : ""))
      .join("\n");
    expect(injectedText).toContain(firstLine);
    expect(injectedText).not.toContain("Second message");
  });

  test("creates a conversation and uses it for search and both writes", async () => {
    const { neo4jAgentMemoryMiddleware } = await loadMiddleware();
    const middleware = neo4jAgentMemoryMiddleware.instantiate({
      config: {
        endpoint: "https://memory.test/v1",
        userId: "user-123",
      },
      pluginConfig: undefined,
      ai: {} as never,
    });

    await middleware.generate!(
      {
        request: {
          messages: [{ role: "user", content: [{ text: "Hello" }] }],
        },
        currentTurn: 0,
        messageIndex: 0,
      },
      {} as never,
      jest
        .fn<Parameters<NonNullable<GenerateMiddlewareDef["generate"]>>[2]>()
        .mockResolvedValue({
          message: { role: "model", content: [{ text: "Hi there." }] },
        } as GenerateResponseData),
    );

    expect(mockMemoryClient.shortTerm.createConversation).toHaveBeenCalledWith({
      userId: "user-123",
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://memory.test/v1/messages/search",
      expect.objectContaining({
        body: JSON.stringify({
          query: "Hello",
          conversationId: "created-conversation",
          limit: 20,
        }),
      }),
    );
    expect(mockMemoryClient.shortTerm.addMessage).toHaveBeenNthCalledWith(
      1,
      "created-conversation",
      "user",
      "Hello",
    );
    expect(mockMemoryClient.shortTerm.addMessage).toHaveBeenNthCalledWith(
      2,
      "created-conversation",
      "assistant",
      "Hi there.",
    );
  });

  test("continues when conversation creation fails by default", async () => {
    const warning = jest.spyOn(console, "warn").mockImplementation(() => {});

    mockMemoryClient.shortTerm.createConversation.mockRejectedValueOnce(
      new Error("creation unavailable"),
    );

    const { neo4jAgentMemoryMiddleware } = await loadMiddleware();

    const middleware = neo4jAgentMemoryMiddleware.instantiate({
      config: {
        endpoint: "https://memory.test/v1",
      },
      pluginConfig: undefined,
      ai: {} as never,
    });

    const response = {} as GenerateResponseData;

    const next = jest
      .fn<Parameters<NonNullable<GenerateMiddlewareDef["generate"]>>[2]>()
      .mockResolvedValue(response);

    await expect(
      middleware.generate!(
        {
          request: {
            messages: [
              {
                role: "user",
                content: [{ text: "Hello" }],
              },
            ],
          },
          currentTurn: 0,
          messageIndex: 0,
        },
        {} as never,
        next,
      ),
    ).resolves.toBe(response);

    expect(next).toHaveBeenCalledTimes(1);

    expect(globalThis.fetch).not.toHaveBeenCalled();

    expect(mockMemoryClient.shortTerm.addMessage).not.toHaveBeenCalled();

    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("resolve the conversation"),
      expect.any(Error),
    );
  });
  test("fails when conversation creation fails and failOnError is true", async () => {
    mockMemoryClient.shortTerm.createConversation.mockRejectedValueOnce(
      new Error("creation unavailable"),
    );

    const { neo4jAgentMemoryMiddleware } = await loadMiddleware();

    const middleware = neo4jAgentMemoryMiddleware.instantiate({
      config: {
        endpoint: "https://memory.test/v1",
        failOnError: true,
      },
      pluginConfig: undefined,
      ai: {} as never,
    });

    const next = jest.fn();

    await expect(
      middleware.generate!(
        {
          request: {
            messages: [
              {
                role: "user",
                content: [{ text: "Hello" }],
              },
            ],
          },
          currentTurn: 0,
          messageIndex: 0,
        },
        {} as never,
        next,
      ),
    ).rejects.toThrow("creation unavailable");

    expect(next).not.toHaveBeenCalled();

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test("uses sessionId as the legacy conversation ID alias", async () => {
    const { neo4jAgentMemoryMiddleware } = await loadMiddleware();
    const middleware = neo4jAgentMemoryMiddleware.instantiate({
      config: {
        sessionId: "legacy-session",
        userId: "user-123",
        endpoint: "https://memory.test/v1",
      },
      pluginConfig: undefined,
      ai: {} as never,
    });

    await middleware.generate!(
      {
        request: {
          messages: [{ role: "user", content: [{ text: "Hello" }] }],
        },
        currentTurn: 0,
        messageIndex: 0,
      },
      {} as never,
      jest
        .fn<Parameters<NonNullable<GenerateMiddlewareDef["generate"]>>[2]>()
        .mockResolvedValue({} as GenerateResponseData),
    );

    expect(
      mockMemoryClient.shortTerm.createConversation,
    ).not.toHaveBeenCalled();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://memory.test/v1/messages/search",
      expect.objectContaining({
        body: JSON.stringify({
          query: "Hello",
          conversationId: "legacy-session",
          limit: 20,
        }),
      }),
    );
    expect(mockMemoryClient.shortTerm.addMessage).toHaveBeenCalledWith(
      "legacy-session",
      "user",
      "Hello",
    );
  });

  test("searches across conversations for an explicitly user-scoped memory search", async () => {
    const { neo4jAgentMemoryMiddleware } = await loadMiddleware();
    const middleware = neo4jAgentMemoryMiddleware.instantiate({
      config: {
        conversationId: "active-conversation",
        userId: "user-123",
        memoryScope: "user",
        endpoint: "https://memory.test/v1",
      },
      pluginConfig: undefined,
      ai: {} as never,
    });

    await middleware.generate!(
      {
        request: {
          messages: [{ role: "user", content: [{ text: "Question?" }] }],
        },
        currentTurn: 0,
        messageIndex: 0,
      },
      {} as never,
      jest
        .fn<Parameters<NonNullable<GenerateMiddlewareDef["generate"]>>[2]>()
        .mockResolvedValue({} as GenerateResponseData),
    );

    const searchBody = JSON.parse(
      jest.mocked(globalThis.fetch).mock.calls[0]?.[1]?.body as string,
    ) as Record<string, unknown>;
    expect(searchBody).toEqual({
      query: "Question?",
      userId: "user-123",
      limit: 20,
    });
    expect(searchBody).not.toHaveProperty("conversationId");
    expect(mockMemoryClient.shortTerm.addMessage).toHaveBeenCalledWith(
      "active-conversation",
      "user",
      "Question?",
    );
  });

  test("requires an explicit userId for user-scoped memory search", async () => {
    const { neo4jAgentMemoryMiddleware } = await loadMiddleware();

    expect(() =>
      neo4jAgentMemoryMiddleware.instantiate({
        config: {
          memoryScope: "user",
          endpoint: "https://memory.test/v1",
        },
        pluginConfig: undefined,
        ai: {} as never,
      }),
    ).toThrow("userId is required when memoryScope is 'user'.");
  });

  test("does not inject stored messages already present in the request", async () => {
    jest.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse({
        messages: [
          {
            id: "present",
            role: "user",
            content: "Remember my preference",
          },
          {
            id: "current",
            role: "user",
            content: "What do I prefer?",
          },
        ],
      }),
    );
    const { neo4jAgentMemoryMiddleware } = await loadMiddleware();
    const middleware = neo4jAgentMemoryMiddleware.instantiate({
      config: {
        conversationId: "conversation-1",
        endpoint: "https://memory.test/v1",
      },
      pluginConfig: undefined,
      ai: {} as never,
    });
    const request = [
      { role: "user" as const, content: [{ text: "Remember my preference" }] },
      {
        role: "model" as const,
        content: [{ text: "You prefer concise answers." }],
      },
      { role: "user" as const, content: [{ text: "What do I prefer?" }] },
    ];
    let requestMessages:
      | Parameters<
          NonNullable<GenerateMiddlewareDef["generate"]>
        >[0]["request"]["messages"]
      | undefined;
    const next = jest.fn(
      async (
        envelope: Parameters<NonNullable<GenerateMiddlewareDef["generate"]>>[0],
      ) => {
        requestMessages = envelope.request.messages;
        return {} as GenerateResponseData;
      },
    );

    await middleware.generate!(
      {
        request: { messages: request },
        currentTurn: 0,
        messageIndex: 0,
      },
      {} as never,
      next,
    );

    expect(requestMessages).toEqual(request);
  });

  test("skips memory work on later turns", async () => {
    const { neo4jAgentMemoryMiddleware } = await loadMiddleware();
    const middleware = neo4jAgentMemoryMiddleware.instantiate({
      config: {
        conversationId: "conversation-1",
        endpoint: "https://memory.test/v1",
      },
      pluginConfig: undefined,
      ai: {} as never,
    });
    const next = jest
      .fn<Parameters<NonNullable<GenerateMiddlewareDef["generate"]>>[2]>()
      .mockResolvedValue({} as GenerateResponseData);

    await middleware.generate!(
      {
        request: {
          messages: [{ role: "user", content: [{ text: "Question?" }] }],
        },
        currentTurn: 1,
        messageIndex: 1,
      },
      {} as never,
      next,
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(mockMemoryClient.connect).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(mockMemoryClient.shortTerm.addMessage).not.toHaveBeenCalled();
  });

  test("retries client initialization after a connection failure", async () => {
    const warning = jest.spyOn(console, "warn").mockImplementation(() => {});
    mockMemoryClient.connect
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce(undefined);
    const { neo4jAgentMemoryMiddleware } = await loadMiddleware();
    const middleware = neo4jAgentMemoryMiddleware.instantiate({
      config: {
        conversationId: "conversation-1",
        endpoint: "https://memory.test/v1",
      },
      pluginConfig: undefined,
      ai: {} as never,
    });
    const next = jest
      .fn<Parameters<NonNullable<GenerateMiddlewareDef["generate"]>>[2]>()
      .mockResolvedValue({} as GenerateResponseData);

    for (let turn = 0; turn < 2; turn++) {
      await middleware.generate!(
        {
          request: {
            messages: [{ role: "user", content: [{ text: "Question?" }] }],
          },
          currentTurn: 0,
          messageIndex: 0,
        },
        {} as never,
        next,
      );
    }

    expect(mockMemoryClient.connect).toHaveBeenCalledTimes(2);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("generation will continue"),
      expect.any(Error),
    );
  });

  test("continues after search errors by default and fails when failOnError is true", async () => {
    const warning = jest.spyOn(console, "warn").mockImplementation(() => {});
    jest
      .mocked(globalThis.fetch)
      .mockResolvedValue(jsonResponse({ error: "search unavailable" }, 503));
    const { neo4jAgentMemoryMiddleware } = await loadMiddleware();
    const middleware = neo4jAgentMemoryMiddleware.instantiate({
      config: {
        conversationId: "conversation-1",
        endpoint: "https://memory.test/v1",
      },
      pluginConfig: undefined,
      ai: {} as never,
    });
    const response = {} as GenerateResponseData;
    const next = jest
      .fn<Parameters<NonNullable<GenerateMiddlewareDef["generate"]>>[2]>()
      .mockResolvedValue(response);

    await expect(
      middleware.generate!(
        {
          request: {
            messages: [{ role: "user", content: [{ text: "Question?" }] }],
          },
          currentTurn: 0,
          messageIndex: 0,
        },
        {} as never,
        next,
      ),
    ).resolves.toBe(response);
    expect(next).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("search historical messages"),
      expect.any(Error),
    );

    jest
      .mocked(globalThis.fetch)
      .mockResolvedValue(jsonResponse({ error: "search unavailable" }, 503));
    const strictMiddleware = neo4jAgentMemoryMiddleware.instantiate({
      config: {
        conversationId: "conversation-1",
        endpoint: "https://memory.test/v1",
        failOnError: true,
      },
      pluginConfig: undefined,
      ai: {} as never,
    });
    const strictNext = jest
      .fn<Parameters<NonNullable<GenerateMiddlewareDef["generate"]>>[2]>()
      .mockResolvedValue(response);

    await expect(
      strictMiddleware.generate!(
        {
          request: {
            messages: [{ role: "user", content: [{ text: "Question?" }] }],
          },
          currentTurn: 0,
          messageIndex: 0,
        },
        {} as never,
        strictNext,
      ),
    ).rejects.toThrow("HTTP 503: search unavailable");
    expect(strictNext).not.toHaveBeenCalled();
  });

  test("rejects non-HTTP endpoints", async () => {
    const { neo4jAgentMemoryMiddleware } = await loadMiddleware();

    expect(() =>
      neo4jAgentMemoryMiddleware.instantiate({
        config: {
          endpoint: "bolt://localhost:7687",
        },
        pluginConfig: undefined,
        ai: {} as never,
      }),
    ).toThrow("requires an HTTP or HTTPS service endpoint");
  });
});
