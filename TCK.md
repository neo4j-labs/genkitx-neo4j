# Genkitx-neo4j with Neo4j Agent Memory

This document explains how to use `genkitx-neo4j` with Neo4j Agent Memory using the hosted Neo4j Agent Memory Service (NAMS), and how to use the TCK bridge for conformance testing.

## Memory Model

Neo4j Agent Memory provides three memory areas:

- **Short-term:** conversations and messages.
- **Long-term:** reusable entity knowledge, with additional operations such as
  facts and preferences available depending on the selected backend.
- **Reasoning:** recorded agent steps, tool calls, and related execution
  information, with APIs depending on the selected backend.

Backend capabilities differ between hosted NAMS REST and BridgeTransport.

## Installation

Install `genkitx-neo4j` together with the Neo4j Agent Memory TypeScript client:

```bash
npm install genkitx-neo4j @neo4j-labs/agent-memory
```

## TCK / Bridge conformance testing

The TCK bridge is used for Agent Memory conformance testing. It is not required for consumers using the hosted NAMS REST service.

For BridgeTransport setup and conformance testing, refer to the
[Neo4j Agent Memory TCK documentation](https://neo4j-labs.github.io/agent-memory-tck/index.html).

## Tool availability

Tool availability depends on the Agent Memory backend and the Agent Memory SDK/API version being used.

### Hosted NAMS validation

The following tools were successfully validated with the hosted NAMS REST
backend using `@neo4j-labs/agent-memory@0.5.0`.

#### Short-term

- `addMemoryMessage`
- `getMemoryConversation`
- `listMemorySessions`
- `clearMemorySession`

#### Long-term

- `addMemoryEntity`
- `searchMemoryEntities`

### Backend-specific operations

The following tools currently map to Agent Memory SDK methods that are
BridgeTransport-only in `@neo4j-labs/agent-memory@0.5.0`. When used against
hosted NAMS REST, these operations return `NotSupportedError`.

#### Long-term

- `addMemoryFact`
- `addMemoryPreference`
- `getRelatedMemoryEntities`
- `mergeDuplicateMemoryEntities`

#### Reasoning

- `startReasoningTrace`

Because `startReasoningTrace` cannot start a trace through hosted NAMS REST
with the current mapping, the following dependent reasoning tools could not
be exercised as a complete hosted workflow:

- `addReasoningStep`
- `recordMemoryToolCall`
- `completeReasoningTrace`

These limitations apply to the current `genkitx-neo4j` tool mappings and the
hosted/bridge capability split in `@neo4j-labs/agent-memory@0.5.0`.
Future Agent Memory SDK versions may expose different capabilities.

The TCK `BridgeTransport` is intended for conformance testing and is not required for the standard hosted NAMS consumer setup.

### Currently disabled

- `addMemoryRelationship`

`addMemoryRelationship` is currently not registered as a Genkit tool.
The corresponding Agent Memory SDK `addRelationship` compatibility method
is BridgeTransport-only in `@neo4j-labs/agent-memory@0.5.0`.

## Known issues

### properties vs attributes

There is a naming mismatch:

- TypeScript / TCK uses `properties`
- Python library uses `attributes`

The adapter maps `attributes` to `properties`.

Use `properties` in TypeScript.

## Implementation notes

- Single connection initialization
- Improved relationship parameter handling
- Improved schemas for LLM usage

## Configuration

The Neo4j database connection and Agent Memory service connection are configured separately.

### Neo4j database

```bash
export NEO4J_URI=bolt://localhost:7687
export NEO4J_USERNAME=neo4j
export NEO4J_PASSWORD=password
```

```ts
clientParams: {
  url: process.env.NEO4J_URI,
  username: process.env.NEO4J_USERNAME,
  password: process.env.NEO4J_PASSWORD,
}
```

### Hosted NAMS

```bash
export MEMORY_ENDPOINT=https://memory.neo4jlabs.com/v1
export MEMORY_API_KEY=your_api_key
export MEMORY_WORKSPACE_ID=your_workspace_id
```

```ts
agentMemory: {
  endpoint: process.env.MEMORY_ENDPOINT,
  apiKey: process.env.MEMORY_API_KEY,
  workspaceId: process.env.MEMORY_WORKSPACE_ID,
}
```

Enable Agent Memory tools with:

```ts
enableAgentMemoryTools: true;
```

`clientParams` configures the Neo4j database connection, while `agentMemory` configures the Agent Memory HTTP service.

## Verification

The integration has been validated using:

- Package build and automated tests
- Packed npm artifact installed in a separate consumer project
- ESM import from the packed package
- Hosted NAMS short-term memory operations
- Hosted NAMS entity creation and search
- Independent Neo4j database and Agent Memory endpoint configuration

Hosted NAMS validation was performed with
`@neo4j-labs/agent-memory@0.5.0`. Backend-specific operations are documented
in the Tool availability section above.
