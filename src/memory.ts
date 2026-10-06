import { Genkit } from "genkit";
import { Neo4jParams } from ".";
import { getDefaultConfig } from "./config";
import { z } from "zod";

export async function configureNeo4jAgentMemoryTools<
  EmbedderCustomOptions extends z.ZodTypeAny,
>(ai: Genkit, params: Neo4jParams<EmbedderCustomOptions>) {
  let MemoryClient: any;

  // Dynamic import with fallback
  try {
    // @ts-ignore: Ignore missing module error for dynamic import
    const agentMemory = await import("@neo4j-labs/agent-memory");
    MemoryClient = agentMemory.MemoryClient;
  } catch (err: any) {
    console.error("DYNAMIC IMPORT ERROR:", err);
    throw new Error(
      `You must install '@neo4j-labs/agent-memory' to use the agent memory tools. \n` +
        `Internal Error Detail: ${err.message}`,
    );
  }

  const { indexId } = params;
  const neo4jConfig = params.clientParams ?? getDefaultConfig();

  const defaultMemoryEndpoint = "http://localhost:3001";
  let memoryEndpoint = neo4jConfig.url || defaultMemoryEndpoint;
  if (
    memoryEndpoint.startsWith("bolt://") ||
    memoryEndpoint.startsWith("neo4j://")
  ) {
    // If the user passed the DB url by mistake, default to the local Python server
    memoryEndpoint = defaultMemoryEndpoint;
  }

  const memoryClient = new MemoryClient({
    endpoint: memoryEndpoint,
    username: neo4jConfig.username,
    password: neo4jConfig.password,
  });

  /**
   * Helper to resolve a name or ID to a valid UUID.
   * If the input is not a UUID, it attempts to find an entity with that name.
   */
  const resolveId = async (idOrName: string): Promise<string> => {
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(idOrName)) {
      return idOrName;
    }
    try {
      const entity = await memoryClient.longTerm.getEntityByName(idOrName);
      if (entity && entity.id) {
        return entity.id;
      }
    } catch (err) {
      // If resolution fails, we pass the original string and let the backend handle the validation error
    }
    return idOrName;
  };

  // Optional: Validate connection once at startup
  try {
    await memoryClient.connect();
  } catch (err) {
    console.warn(
      `[Genkit Neo4j] Warning: Could not connect to memory endpoint at ${memoryEndpoint}. Tools might fail.`,
    );
  }

  // TIER BRONZE: SHORT-TERM MEMORY TOOLS ---

  ai.defineTool(
    {
      name: `neo4j/${indexId}/addMemoryMessage`,
      description: "Save a message to the current conversation session.",
      inputSchema: z.object({
        sessionId: z.string().describe("The ID of the chat session"),
        role: z
          .enum(["user", "assistant", "system"])
          .describe("The role of the message sender"),
        content: z.string().describe("The text content of the message"),
        metadata: z
          .record(z.any())
          .optional()
          .describe("Optional metadata to attach to the message"),
      }),
    },
    async (input) => {
      const msg = await memoryClient.shortTerm.addMessage(
        input.sessionId,
        input.role as any,
        input.content,
        { metadata: input.metadata },
      );
      return {
        id: msg.id,
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp,
      };
    },
  );

  ai.defineTool(
    {
      name: `neo4j/${indexId}/getMemoryConversation`,
      description: "Retrieve the full history of a conversation session.",
      inputSchema: z.object({
        sessionId: z.string().describe("The ID of the chat session"),
        limit: z
          .number()
          .optional()
          .describe("Maximum number of messages to retrieve"),
      }),
    },
    async (input) => {
      const conv = await memoryClient.shortTerm.getConversation(
        input.sessionId,
        {
          limit: input.limit,
        },
      );
      return conv;
    },
  );

  ai.defineTool(
    {
      name: `neo4j/${indexId}/listMemorySessions`,
      description: "List all active memory sessions.",
      inputSchema: z.object({
        limit: z
          .number()
          .optional()
          .describe("Maximum number of sessions to list"),
      }),
    },
    async (input) => {
      return await memoryClient.shortTerm.listSessions({
        limit: input.limit,
      });
    },
  );

  ai.defineTool(
    {
      name: `neo4j/${indexId}/clearMemorySession`,
      description: "Delete all messages associated with a session.",
      inputSchema: z.object({
        sessionId: z.string().describe("The ID of the chat session to clear"),
      }),
    },
    async (input) => {
      await memoryClient.shortTerm.clearSession(input.sessionId);
      return `Session ${input.sessionId} cleared.`;
    },
  );

  // TIER BRONZE / SILVER: LONG-TERM MEMORY TOOLS ---

  ai.defineTool(
    {
      name: `neo4j/${indexId}/addMemoryEntity`,
      description:
        "Save a person, organization, place, or important concept into long-term memory.",
      inputSchema: z.object({
        name: z
          .string()
          .describe(
            "Name of the entity (e.g. 'John Doe', 'React', 'Acme Corp')",
          ),
        entityType: z
          .string()
          .describe(
            "Type of entity (e.g. 'PERSON', 'TECHNOLOGY', 'ORGANIZATION')",
          ),
        description: z
          .string()
          .optional()
          .describe("Optional description or context of the entity"),
      }),
    },
    async (input) => {
      const entity = await memoryClient.longTerm.addEntity(
        input.name,
        input.entityType,
        { description: input.description },
      );
      return `Entity '${input.name}' saved successfully to memory. ID: ${entity.id}`;
    },
  );

  ai.defineTool(
    {
      name: `neo4j/${indexId}/addMemoryFact`,
      description:
        "Save a factual statement about a subject into long-term memory.",
      inputSchema: z.object({
        subject: z
          .string()
          .describe("The subject of the fact (e.g. 'The Eiffel Tower')"),
        predicate: z
          .string()
          .describe("The relationship/property (e.g. 'is located in')"),
        object: z
          .string()
          .describe("The object/value of the fact (e.g. 'Paris')"),
      }),
    },
    async (input) => {
      const fact = await memoryClient.longTerm.addFact(
        input.subject,
        input.predicate,
        input.object,
      );
      return `Fact saved: ${fact.subject} ${fact.predicate} ${fact.object}`;
    },
  );

  ai.defineTool(
    {
      name: `neo4j/${indexId}/addMemoryPreference`,
      description:
        "Save a user preference or personal detail into long-term memory.",
      inputSchema: z.object({
        category: z
          .string()
          .describe(
            "Category of the preference (e.g. 'dietary', 'language', 'style')",
          ),
        preference: z
          .string()
          .describe("The preference value (e.g. 'prefers dark mode')"),
        context: z
          .string()
          .optional()
          .describe("Optional context when this preference applies"),
      }),
    },
    async (input) => {
      await memoryClient.longTerm.addPreference(
        input.category,
        input.preference,
        { context: input.context },
      );
      return `Preference saved under category '${input.category}'.`;
    },
  );

  ai.defineTool(
    {
      name: `neo4j/${indexId}/addMemoryRelationship`,
      description:
        "Create a semantic relationship between two entities in the Knowledge Graph.",
      inputSchema: z.object({
        sourceId: z.string().describe("The ID or name of the source entity"),
        targetId: z.string().describe("The ID or name of the target entity"),
        type: z
          .string()
          .describe(
            "The type of relationship (e.g. 'WORKS_FOR', 'FRIEND_OF'). Use UPPER_SNAKE_CASE.",
          ),
        properties: z
          .record(z.any())
          .optional()
          .describe("Optional properties/metadata for the relationship"),
      }),
    },
    async (input) => {
      const sourceId = await resolveId(input.sourceId);
      const targetId = await resolveId(input.targetId);
      await memoryClient.longTerm.addRelationship(
        sourceId,
        targetId,
        input.type,
        { properties: input.properties },
      );
      return `Relationship '${input.type}' created between '${input.sourceId}' and '${input.targetId}'.`;
    },
  );

  ai.defineTool(
    {
      name: `neo4j/${indexId}/searchMemoryEntities`,
      description:
        "Search for previously saved entities, facts, or preferences using semantic search.",
      inputSchema: z.object({
        query: z
          .string()
          .describe("Natural language query to search in memory"),
        limit: z.number().optional().describe("Maximum results to return"),
      }),
    },
    async (input) => {
      const results = await memoryClient.longTerm.searchEntities(input.query, {
        limit: input.limit,
      });
      return results;
    },
  );

  ai.defineTool(
    {
      name: `neo4j/${indexId}/getRelatedMemoryEntities`,
      description:
        "Retrieve entities related to a specific entity by traversing the Knowledge Graph.",
      inputSchema: z.object({
        entityId: z.string().describe("The ID of the starting entity"),
        relationshipType: z
          .string()
          .optional()
          .describe("Optional filter by relationship type"),
        depth: z.number().optional().describe("Traversal depth (default: 1)"),
      }),
    },
    async (input) => {
      const entityId = await resolveId(input.entityId);
      return await memoryClient.longTerm.getRelatedEntities(entityId, {
        relationshipType: input.relationshipType,
        depth: input.depth,
      });
    },
  );

  ai.defineTool(
    {
      name: `neo4j/${indexId}/mergeDuplicateMemoryEntities`,
      description:
        "Merge two entities that represent the same real-world concept.",
      inputSchema: z.object({
        sourceId: z
          .string()
          .describe("The ID of the duplicate entity to be removed"),
        targetId: z.string().describe("The ID of the primary entity to keep"),
        canonicalName: z
          .string()
          .optional()
          .describe("Optional new canonical name for the merged entity"),
      }),
    },
    async (input) => {
      const sourceId = await resolveId(input.sourceId);
      const targetId = await resolveId(input.targetId);
      const merged = await memoryClient.longTerm.mergeDuplicateEntities(
        sourceId,
        targetId,
        { canonicalName: input.canonicalName },
      );
      return `Entities merged into '${merged.name}' (${merged.id}).`;
    },
  );

  // TIER SILVER: REASONING MEMORY TOOLS ---

  ai.defineTool(
    {
      name: `neo4j/${indexId}/startReasoningTrace`,
      description:
        "Start a reasoning trace for a complex task to document your multi-step logic.",
      inputSchema: z.object({
        sessionId: z.string().describe("The ID of the current chat session"),
        task: z
          .string()
          .describe("The task or question you are trying to resolve"),
      }),
    },
    async (input) => {
      const trace = await memoryClient.reasoning.startTrace(
        input.sessionId,
        input.task,
      );
      return {
        message: `Trace started. Use traceId for subsequent steps.`,
        traceId: trace.id,
      };
    },
  );

  ai.defineTool(
    {
      name: `neo4j/${indexId}/addReasoningStep`,
      description: "Add a logical step to an existing reasoning trace.",
      inputSchema: z.object({
        traceId: z.string().describe("The trace ID from startReasoningTrace"),
        thought: z
          .string()
          .describe("Your internal logical reasoning for this step"),
        action: z.string().describe("The action you are taking"),
        observation: z
          .string()
          .optional()
          .describe("Optional observation or result from the action"),
      }),
    },
    async (input) => {
      const step = await memoryClient.reasoning.addStep(input.traceId, {
        thought: input.thought,
        action: input.action,
        observation: input.observation,
      });
      return {
        message: `Step recorded.`,
        stepId: step.id,
      };
    },
  );

  ai.defineTool(
    {
      name: `neo4j/${indexId}/recordMemoryToolCall`,
      description: "Log an external tool call within a reasoning step.",
      inputSchema: z.object({
        stepId: z.string().describe("The ID of the reasoning step"),
        toolName: z.string().describe("The name of the tool called"),
        arguments: z
          .record(z.any())
          .describe("The arguments passed to the tool"),
        result: z.any().optional().describe("The result returned by the tool"),
        status: z
          .enum(["success", "error"])
          .optional()
          .describe("The outcome status"),
        error: z
          .string()
          .optional()
          .describe("The error message if status is 'error'"),
      }),
    },
    async (input) => {
      const tc = await memoryClient.reasoning.recordToolCall(
        input.stepId,
        input.toolName,
        input.arguments,
        {
          result: input.result,
          status: input.status as any,
          error: input.error,
        },
      );
      return {
        message: `Tool call recorded.`,
        toolCallId: tc.id,
      };
    },
  );

  ai.defineTool(
    {
      name: `neo4j/${indexId}/completeReasoningTrace`,
      description: "Complete a reasoning trace with a final outcome.",
      inputSchema: z.object({
        traceId: z.string().describe("The ID of the trace to complete"),
        outcome: z.string().describe("A summary of the final result"),
        success: z
          .boolean()
          .describe("Whether the task was successfully resolved"),
      }),
    },
    async (input) => {
      await memoryClient.reasoning.completeTrace(input.traceId, {
        outcome: input.outcome,
        success: input.success,
      });
      return `Trace ${input.traceId} completed.`;
    },
  );
}
