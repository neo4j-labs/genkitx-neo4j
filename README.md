# genkitx-neo4j - Neo4j plugin for Genkit

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

## TCK Integration (Agent Memory)

To use this plugin together with the Neo4j Agent Memory TCK (short-term, long-term and reasoning memory), see:

[TCK.md](./TCK.md)
