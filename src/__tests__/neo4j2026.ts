import { googleAI } from "@genkit-ai/googleai";
import { Document, genkit } from "genkit";
import { test, describe, expect, jest } from "@jest/globals";
import { neo4j, neo4jIndexerRef, neo4jRetrieverRef } from "..";
import { mockEmbedder } from "../dummyEmbedder";
import { setupNeo4jTestEnvironment } from "../test-utils";
import { MatchSearchClauseStrategy } from "../search-strategy";

/**
 * This file contains integration tests for the Genkit Neo4j plugin using
 * using @testcontainers/neo4j with 2026.01.x and related features
 */
jest.setTimeout(30000);

describe("Neo4j 2026.01+ Syntax Plugin Integration", () => {
  // Initialize the before / after / beforeAll / afterAll
  const setupCtx = setupNeo4jTestEnvironment();

  test("should index and retrieve successfully without filterMetadata", async () => {
    const customIdx = `match-strategy-no-filter-${Date.now()}`;
    const uniqueId = `doc-${Date.now()}`;

    // given
    setupCtx.ai = genkit({
      plugins: [
        googleAI(),
        neo4j([
          {
            indexId: customIdx,
            embedder: mockEmbedder,
            clientParams: setupCtx.clientParams,
            searchStrategy: new MatchSearchClauseStrategy(),
          },
        ]),
      ],
    });

    const newDocument = new Document({
      content: [{ text: "Document without filter metadata configuration." }],
      metadata: { uniqueId, color: "red" },
    });

    const indexerRef = neo4jIndexerRef({ indexId: customIdx });
    const retrieverRef = neo4jRetrieverRef({ indexId: customIdx });

    // when
    await setupCtx.ai.index({ indexer: indexerRef, documents: [newDocument] });

    // then
    const result = await setupCtx.session.run(
      `MATCH (n:\`${customIdx}\` {uniqueId: $uniqueId}) RETURN n`,
      { uniqueId },
    );
    expect(result.records).toHaveLength(1);
    const props = result.records[0].get("n").properties;
    expect(props.uniqueId).toBe(uniqueId);
    expect(props.color).toBe("red");

    const docs = await setupCtx.ai.retrieve({
      retriever: retrieverRef,
      query: "test query",
      options: { k: 10 },
    });

    expect(docs).toHaveLength(1);
    expect(docs[0].content[0].text).toContain(
      "without filter metadata configuration",
    );
  });

  test("should index and retrieve successfully with explicitly empty filterMetadata", async () => {
    const customIdx = `match-strategy-empty-filter-${Date.now()}`;
    const uniqueId = `doc-${Date.now()}`;

    // given
    setupCtx.ai = genkit({
      plugins: [
        googleAI(),
        neo4j([
          {
            indexId: customIdx,
            embedder: mockEmbedder,
            clientParams: setupCtx.clientParams,
            searchStrategy: new MatchSearchClauseStrategy(),
            filterMetadata: [],
          },
        ]),
      ],
    });

    const newDocument = new Document({
      content: [{ text: "Document with empty filter metadata configuration." }],
      metadata: { uniqueId, shape: "circle" },
    });

    const indexerRef = neo4jIndexerRef({ indexId: customIdx });
    const retrieverRef = neo4jRetrieverRef({ indexId: customIdx });

    // when
    await setupCtx.ai.index({ indexer: indexerRef, documents: [newDocument] });

    // then
    const result = await setupCtx.session.run(
      `MATCH (n:\`${customIdx}\` {uniqueId: $uniqueId}) RETURN n`,
      { uniqueId },
    );
    expect(result.records).toHaveLength(1);

    const docs = await setupCtx.ai.retrieve({
      retriever: retrieverRef,
      query: "test query",
      options: { k: 10 },
    });

    expect(docs).toHaveLength(1);
    expect(docs[0].content[0].text).toContain(
      "empty filter metadata configuration",
    );
  });

  test("should index and retrieve successfully with populated filterMetadata and apply query filters", async () => {
    const customIdx = `match-strategy-populated-filter-${Date.now()}`;

    // given
    setupCtx.ai = genkit({
      plugins: [
        googleAI(),
        neo4j([
          {
            indexId: customIdx,
            embedder: mockEmbedder,
            clientParams: setupCtx.clientParams,
            searchStrategy: new MatchSearchClauseStrategy(),
            // Configure the index to optimize filtering on these specific metadata properties
            filterMetadata: ["department", "status"],
          },
        ]),
      ],
    });

    const docsToInsert = [
      new Document({
        content: [{ text: "Active document in IT." }],
        metadata: { department: "IT", status: "active", author: "Alice" },
      }),
      new Document({
        content: [{ text: "Archived document in IT." }],
        metadata: { department: "IT", status: "archived", author: "Bob" },
      }),
      new Document({
        content: [{ text: "Active document in HR." }],
        metadata: { department: "HR", status: "active", author: "Charlie" },
      }),
    ];

    const indexerRef = neo4jIndexerRef({ indexId: customIdx });
    const retrieverRef = neo4jRetrieverRef({ indexId: customIdx });

    // when
    await setupCtx.ai.index({ indexer: indexerRef, documents: docsToInsert });

    // then
    const result = await setupCtx.session.run(
      `MATCH (n:\`${customIdx}\`) RETURN n`,
    );
    expect(result.records).toHaveLength(3);

    const docs = await setupCtx.ai.retrieve({
      retriever: retrieverRef,
      query: "Find active documents",
      options: {
        k: 10,
        filter: { department: "IT", status: "active" },
      },
    });

    // 4. Retrieval Verification: Should only return the single matching document
    expect(docs).toHaveLength(1);
    expect(docs[0].content[0].text).toBe("Active document in IT.");
    expect(docs[0].metadata?.author).toBe("Alice");
  });
});
