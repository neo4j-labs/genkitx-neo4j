# Genkitx-neo4j with Neo4j Agent Memory (TCK Integration)

This document explains how to use `genkitx-neo4j` together with the Neo4j Agent Memory TCK (short-term, long-term and reasoning memory).

## Memory Model

The system supports three types of memory:

- Short-term: session-based conversation memory
- Long-term: persistent entities, facts and preferences
- Reasoning: structured reasoning traces for agents

## Important: @neo4j-labs/agent-memory is not publicly available

The official documentation suggests:

```bash
npm install @neo4j-labs/agent-memory
```

This currently does not work because the package is not published.

## Manual installation (required)

Clone the repository:

```bash
git clone https://github.com/neo4j-labs/agent-memory.git
```

Build the TypeScript client:

```bash
cd agent-memory/clients/typescript
npm install
npm run build
```

Link it in your project:

```json
{
  "devDependencies": {
    "@neo4j-labs/agent-memory": "file:../agent-memory/clients/typescript"
  }
}
```

## Future installation

Once the package is published:

```bash
npm install @neo4j-labs/agent-memory
```

## Running the TCK bridge

### Conformance python

In the cloned agent-memory repository folder (not in the project folder):

```bash
export NEO4J_PASSWORD=my_secret_password
make conformance-python
```

### Without LLM

```bash
uv run --python 3.12 \
  --with fastapi \
  --with uvicorn \
  --with "neo4j-agent-memory[sentence-transformers]" \
  uvicorn server-without-llm:app --port 8000
```

### With LLM

```bash
uv run --python 3.12 \
  --with fastapi \
  --with uvicorn \
  --with "neo4j-agent-memory[sentence-transformers]" \
  uvicorn server:app --port 8000
```

## Running tests

### Build TCK client

```bash
npx tsx ../agent-memory/clients/typescript/src/client.ts
```

### Standalone test

```bash
npx tsx test-standalone.ts
```

### Integration test

```bash
npx tsx test-integration.ts
```

## Testing strategies

### Manual tool testing

- Calls tools directly without LLM

```bash
npx tsx comprehensive.ts
```

### Agentic testing

- Basic test uses an LLM to orchestrate tools (with Google Gemini)

```bash
npx tsx test-agent.ts
```

- More comprehensive an LLM to orchestrate tools (with Google Gemini)

```bash
npx test-omni-agentic.ts
```

- Uses an LLM to orchestrate tools (with OpenAI)

```bash
npx test-omni-agentic-openai
```

### End-to-end testing

- Full session and memory integration with [session.ts](./src/session.ts)

```bash
npx test-omni.ts
```

### Test with reasoning memory

```bash
npx test-comprehensive.ts
```

### Multi-index isolation

- Ensures separation between indexes

## Available tools

### Short-term

- addMemoryMessage
- getMemoryConversation
- listMemorySessions
- clearMemorySession

### Long-term

- addMemoryEntity
- addMemoryFact
- addMemoryPreference
- addMemoryRelationship
- searchMemoryEntities
- getRelatedMemoryEntities
- mergeDuplicateMemoryEntities

### Reasoning

- startReasoningTrace
- addReasoningStep
- recordMemoryToolCall
- completeReasoningTrace

## Known issues

### properties vs attributes

There is a naming mismatch:

- TypeScript / TCK uses `properties`
- Python library uses `attributes`

The adapter maps `attributes` to `properties`.

Use `properties` in TypeScript.

## Improvements

- Single connection initialization
- Fixed addRelationship parameter bug
- Default port aligned to 3001
- Improved schemas for LLM usage

## Neo4j configuration

### Python bridge

```bash
export NEO4J_URI=bolt://localhost:7687
export NEO4J_USERNAME=neo4j
export NEO4J_PASSWORD=password
```

### Genkit configuration

```ts
clientParams: {
  url: 'bolt://localhost:7687',
  username: 'neo4j',
  password: 'your_password'
}
```

## Verification

- Short-term memory works
- Long-term memory works
- Reasoning traces work

- Align messageLabel with TCK
- Make long-term memory optional
