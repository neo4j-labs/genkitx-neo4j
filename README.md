# genkitx-neo4j - Neo4j plugin for Genkit

> This is an experimental Neo4j Labs project and not part of Neo4j's supported product lineup. See the [Neo4j Labs disclaimer](./LABS_DISCLAIMER.txt).

This is a Neo4j plugin for Genkit, providing vector indexing and retrieval capabilities.

## Installation

```bash
npm i --save genkitx-neo4j
```

## Environment variables

Configure your Neo4j connection:

```bash
NEO4J_URI=bolt://localhost:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=password
```

## Usage

```ts
import { genkit } from "genkit";
import { neo4j, neo4jRetrieverRef, neo4jIndexerRef } from "genkitx-neo4j";

const ai = genkit({
  plugins: [
    neo4j([
      {
        indexId: "bob-facts",
        embedder: textEmbedding004,
      },
    ]),
  ],
});

export const bobFactsIndexer = neo4jIndexerRef({
  indexId: "bob-facts",
});

await ai.index({ indexer: bobFactsIndexer, documents });

export const bobFactsRetriever = neo4jRetrieverRef({
  indexId: "bob-facts",
});

let docs = await ai.retrieve({
  retriever: bobFactsRetriever,
  query,
});
```

## Documentation

Full reference available in Genkit documentation:
[https://firebase.google.com/docs/genkit](https://firebase.google.com/docs/genkit)

## Neo4j Agent Memory

`genkitx-neo4j` supports Neo4j Agent Memory for short-term, long-term,
and reasoning memory capabilities.

For setup, hosted NAMS support, available tools, and optional TCK/Bridge
conformance testing, see:

[TCK.md](./TCK.md)

### Generate middleware

The opt-in `neo4jAgentMemoryMiddleware` automatically retrieves relevant
historical messages from Neo4j Agent Memory before generation and persists
successful text user/assistant turns after generation.

Retrieval uses semantic message search and supports two memory scopes:

- `conversation` (default): searches only the active conversation.
- `user`: searches across conversations associated with the configured
  `userId`.

Install `@neo4j-labs/agent-memory` and configure the service endpoint and
credentials as described in [TCK.md](./TCK.md).

#### Conversation-scoped memory

Conversation scope is the default and keeps memory retrieval isolated to the
active conversation.

```ts
import { genkit } from "genkit";
import { neo4jAgentMemoryMiddleware } from "genkitx-neo4j";

const ai = genkit();

const response = await ai.generate({
  model: "googleai/gemini-2.5-flash",
  prompt: "What do I usually prefer?",
  use: [
    neo4jAgentMemoryMiddleware({
      conversationId: "conversation-456",
    }),
  ],
});
```

`sessionId` remains a compatibility alias for `conversationId`.

If neither `conversationId` nor `sessionId` is supplied, the middleware creates
a conversation on the first generation.

#### User-scoped memory

Set `memoryScope: "user"` to retrieve relevant messages across conversations
associated with the same user.

```ts
const response = await ai.generate({
  model: "googleai/gemini-2.5-flash",
  prompt: "What did I tell you in an earlier conversation?",
  use: [
    neo4jAgentMemoryMiddleware({
      conversationId: "conversation-456",
      userId: "user-123",
      memoryScope: "user",
    }),
  ],
});
```

`userId` is required when `memoryScope` is `"user"`. User-scoped retrieval
searches historical messages by `userId`, while new user and assistant turns
are still persisted to the active conversation.

The middleware retrieves up to 20 semantic search candidates, removes duplicate
and already-present messages, ranks the remaining candidates by relevance,
source, and recency, and injects up to 5 relevant historical messages.

`maxContextChars` limits the total injected memory context. Middleware options
can override `endpoint`, `apiKey`, and `workspaceId`; otherwise the corresponding
`MEMORY_*` environment variables are used.

Memory failures are logged and generation continues by default. Set
`failOnError: true` to make memory failures fail generation instead.

Retrieved memory is treated as untrusted reference data and cannot override
system instructions or the current user request. Retrieval and injection happen
once per generate call rather than once per model turn in a tool loop.

The middleware is separate from `enableAgentMemoryTools`, which registers
model-callable Agent Memory tools. Historical message retrieval through the
middleware does not require those read tools.
