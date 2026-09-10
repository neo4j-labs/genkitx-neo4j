/**
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 *
 * You may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as neo4j_driver from "neo4j-driver";
import { Genkit, z } from "genkit";
import { GenkitPlugin, genkitPlugin } from "genkit/plugin";

import { EmbedderArgument } from "genkit/embedder";
import {
  CommonRetrieverOptionsSchema,
  Document,
  indexerRef,
  retrieverRef,
} from "genkit/retriever";
import { randomUUID } from "crypto";
import { SearchStrategy, VectorFunctionStrategy } from "./search-strategy";
import {
  ParentChildRetriever,
  HypotheticalQuestionRetriever,
  GenericGraphRagRetriever,
  GraphRagConfig,
} from "./rag-utils";
import { safeIdent } from "./filter-utils";

export const FULLTEXT_INDEX_SUFFIX = "__fulltext";
export const errorMetadataAndHybrid =
  "Metadata filtering can't be use in combination with a hybrid search approach.";

const Neo4jRetrieverOptionsSchema = CommonRetrieverOptionsSchema.extend({
  filter: z.record(z.string(), z.any()).optional(),
});

const Neo4jIndexerOptionsSchema = z.object({
  namespace: z.string().optional(),
});

export interface Neo4jGraphConfig {
  url: string;
  username: string;
  password: string;
  database?: string;
}

export const neo4jRetrieverRef = (params: {
  indexId: string;
  displayName?: string;
  retrievalQuery?: string;
}) => {
  return retrieverRef({
    name: `neo4j/${params.indexId}`,
    info: {
      label: params.displayName ?? `Neo4j - ${params.indexId}`,
    },
    configSchema: Neo4jRetrieverOptionsSchema,
  });
};

export const neo4jParentChildRetrieverRef = (params: {
  indexId: string;
  displayName?: string;
}) => {
  return retrieverRef({
    name: `neo4j-parent-child/${params.indexId}`,
    info: {
      label: params.displayName ?? `Neo4j Parent-Child - ${params.indexId}`,
    },
    configSchema: Neo4jRetrieverOptionsSchema,
  });
};

export const neo4jHyDERetrieverRef = (params: {
  indexId: string;
  displayName?: string;
}) => {
  return retrieverRef({
    name: `neo4j-hyde/${params.indexId}`,
    info: { label: params.displayName ?? `Neo4j HyDE - ${params.indexId}` },
    configSchema: Neo4jRetrieverOptionsSchema,
  });
};

export const neo4jCustomRetrieverRef = (params: {
  indexId: string;
  name: string;
  displayName?: string;
}) => {
  return retrieverRef({
    name: `neo4j-custom-${params.name}/${params.indexId}`,
    info: { label: params.displayName ?? `Neo4j Custom - ${params.name}` },
    configSchema: Neo4jRetrieverOptionsSchema,
  });
};

export const neo4jIndexerRef = (params: {
  indexId: string;
  displayName?: string;
  creationQuery?: string;
}) => {
  return indexerRef({
    name: `neo4j/${params.indexId}`,
    info: {
      label: params.displayName ?? `Neo4j - ${params.indexId}`,
    },
  });
};

export interface Neo4jParams<EmbedderCustomOptions extends z.ZodTypeAny> {
  indexId: string;
  embedder: EmbedderArgument<EmbedderCustomOptions>;
  embedderOptions?: z.infer<EmbedderCustomOptions>;
  clientParams?: Neo4jGraphConfig;
  label?: string;
  textProperty?: string;
  embeddingProperty?: string;
  idProperty?: string;
  retrievalQuery?: string;
  creationQuery?: string;
  searchType?: SearchType;
  fullTextRetrievalQuery?: string;
  fullTextIndexName?: string;
  fullTextQuery?: string;
  searchStrategy?: SearchStrategy;
  filterMetadata?: string[];
  ragModel?: any;
  customGraphRagConfigs?: Record<string, GraphRagConfig>;
}

export function neo4j<EmbedderCustomOptions extends z.ZodTypeAny>(
  params: Neo4jParams<EmbedderCustomOptions>[],
): GenkitPlugin {
  return genkitPlugin("neo4j", async (ai: Genkit) => {
    params.map((i) => configureNeo4jRetriever(ai, i));
    params.map((i) => configureNeo4jIndexer(ai, i));

    params.map((i) => configureNeo4jGraphRagRetrievers(ai, i));
    params.map((i) => configureNeo4jGraphRagTools(ai, i));
  });
}

export default neo4j;

export function configureNeo4jGraphRagRetrievers<
  EmbedderCustomOptions extends z.ZodTypeAny,
>(ai: Genkit, params: Neo4jParams<EmbedderCustomOptions>) {
  const { indexId, ragModel, customGraphRagConfigs } = params;
  const neo4jConfig = params.clientParams ?? getDefaultConfig();
  const indexer = neo4jIndexerRef({ indexId });
  const vectorRetriever = neo4jRetrieverRef({ indexId });

  ai.defineRetriever(
    {
      name: `neo4j-parent-child/${indexId}`,
      configSchema: Neo4jRetrieverOptionsSchema,
    },
    async (content, options) => {
      const pcRetriever = new ParentChildRetriever(
        ai,
        neo4jConfig,
        indexer,
        vectorRetriever,
      );
      const documents = await pcRetriever.retrieve(
        content.text ?? "",
        options?.k,
        options?.filter,
      );
      return { documents };
    },
  );

  ai.defineRetriever(
    {
      name: `neo4j-hyde/${indexId}`,
      configSchema: Neo4jRetrieverOptionsSchema,
    },
    async (content, options) => {
      const hydeRetriever = new HypotheticalQuestionRetriever(
        ai,
        neo4jConfig,
        indexer,
        vectorRetriever,
        ragModel,
      );
      const documents = await hydeRetriever.retrieve(
        content.text ?? "",
        options?.k,
        options?.filter,
      );
      return { documents };
    },
  );

  if (customGraphRagConfigs) {
    for (const [name, config] of Object.entries(customGraphRagConfigs)) {
      ai.defineRetriever(
        {
          name: `neo4j-custom-${name}/${indexId}`,
          configSchema: Neo4jRetrieverOptionsSchema,
        },
        async (content, options) => {
          const genericRetriever = new GenericGraphRagRetriever(
            ai,
            neo4jConfig,
            indexer,
            vectorRetriever,
            config,
          );
          const documents = await genericRetriever.retrieve(
            content.text ?? "",
            options?.k,
            options?.filter,
          );
          return { documents };
        },
      );
    }
  }
}

export function configureNeo4jGraphRagTools<
  EmbedderCustomOptions extends z.ZodTypeAny,
>(ai: Genkit, params: Neo4jParams<EmbedderCustomOptions>) {
  const { indexId, ragModel } = params;
  const neo4jConfig = params.clientParams ?? getDefaultConfig();
  const indexer = neo4jIndexerRef({ indexId });
  const vectorRetriever = neo4jRetrieverRef({ indexId });

  ai.defineTool(
    {
      name: `neo4j/${indexId}/parentChildIngestor`,
      description:
        "Ingest documents with parent-child-subchunk structure in Neo4j",
      inputSchema: z.object({
        documents: z
          .array(
            z.object({
              id: z.string().uuid().optional(),
              text: z.string().max(50_000),
              metadata: z.record(z.string(), z.any()).optional(),
            }),
          )
          .max(100),
      }),
    },
    async ({
      documents,
    }: {
      documents: { id?: string; text: string; metadata?: any }[];
    }) => {
      const pcRetriever = new ParentChildRetriever(
        ai,
        neo4jConfig,
        indexer,
        vectorRetriever,
      );
      return await pcRetriever.ingestDocument({ documents });
    },
  );

  ai.defineTool(
    {
      name: `neo4j/${indexId}/hydeIngestor`,
      description: "Ingest documents for HyDE retrieval in Neo4j",
      inputSchema: z.object({
        documents: z
          .array(
            z.object({
              id: z.string().uuid().optional(),
              text: z.string().max(50_000),
              metadata: z.record(z.string(), z.any()).optional(),
            }),
          )
          .max(100),
      }),
    },
    async ({
      documents,
    }: {
      documents: { id?: string; text: string; metadata?: any }[];
    }) => {
      const hydeRetriever = new HypotheticalQuestionRetriever(
        ai,
        neo4jConfig,
        indexer,
        vectorRetriever,
        ragModel,
      );
      return await hydeRetriever.ingestDocument({ documents });
    },
  );
}

export function configureNeo4jRetriever<
  EmbedderCustomOptions extends z.ZodTypeAny,
>(ai: Genkit, params: Neo4jParams<EmbedderCustomOptions>) {
  const { indexId, embedder, embedderOptions, searchStrategy } = { ...params };
  const neo4jConfig = params.clientParams ?? getDefaultConfig();
  const neo4j_instance = neo4j_driver.driver(
    neo4jConfig.url,
    neo4j_driver.auth.basic(neo4jConfig.username, neo4jConfig.password),
  );

  const strategy = searchStrategy || new VectorFunctionStrategy();

  return ai.defineRetriever(
    {
      name: `neo4j/${params.indexId}`,
      configSchema: Neo4jRetrieverOptionsSchema,
    },
    async (content, options) => {
      const queryEmbeddings = await ai.embed({
        embedder,
        content,
        options: embedderOptions,
      });

      const retriever_query = strategy.generateQuery(
        options,
        params,
        content?.text ?? "",
      );

      const response = await neo4j_instance.executeQuery(
        retriever_query.query,
        {
          k: options.k,
          embedding: queryEmbeddings[0].embedding,
          index: indexId,
          ...retriever_query.additionalParams,
        },
        { database: neo4jConfig.database },
      );

      const documents = response.records.map((el) => {
        return Document.fromText(
          el.get("text"),
          Object.fromEntries(
            Object.entries(el.get("metadata")).filter(
              ([_, value]) => value !== null,
            ),
          ),
        );
      });

      neo4j_instance.close();
      return { documents };
    },
  );
}

export function configureNeo4jIndexer<
  EmbedderCustomOptions extends z.ZodTypeAny,
>(ai: Genkit, params: Neo4jParams<EmbedderCustomOptions>) {
  const {
    indexId,
    embedder,
    embedderOptions,
    embeddingProperty = "embedding",
    idProperty = "id",
    label,
    textProperty = "text",
    searchType = "vector",
    fullTextIndexName = indexId + FULLTEXT_INDEX_SUFFIX,
    fullTextQuery,
    searchStrategy,
    filterMetadata = [],
  } = {
    ...params,
  };
  const neo4jConfig = params.clientParams ?? getDefaultConfig();
  const neo4j_instance = neo4j_driver.driver(
    neo4jConfig.url,
    neo4j_driver.auth.basic(neo4jConfig.username, neo4jConfig.password),
  );

  const strategy = searchStrategy || new VectorFunctionStrategy();
  const cypherPrefix = strategy.cypherPrefix();

  return ai.defineIndexer(
    {
      name: `neo4j/${params.indexId}`,
    },
    async (docs, options) => {
      const embeddings = await Promise.all(
        docs.map((doc) =>
          ai.embed({
            embedder,
            content: doc,
            options: embedderOptions,
          }),
        ),
      );

      const BATCH_SIZE = 1000;
      const safeTextProperty = safeIdent(textProperty);
      const safeLabelName = safeIdent(label || indexId);
      const safeIdProperty = safeIdent(idProperty);

      for (let i = 0; i < docs.length; i += BATCH_SIZE) {
        const batchDocs = docs.slice(i, i + BATCH_SIZE);
        const batchEmbeddings = embeddings.slice(i, i + BATCH_SIZE);

        const batchParams = batchDocs.map((el, j) => {
          return {
            text: el.content[0]["text"],
            metadata: el.metadata ?? {},
            embedding: batchEmbeddings[j][0]["embedding"],
            id: el.content[0]["id"] || randomUUID(),
          };
        });

        const createOrMerge = `MERGE (t:\`${safeLabelName}\` {${safeIdProperty}: row.id})`;

        const creationQuery =
          params?.creationQuery ??
          `
          UNWIND $data AS row
          ${createOrMerge}
          SET t.${safeTextProperty} = row.text,
              t += row.metadata
          WITH t, row.embedding AS embedding
          CALL db.create.setNodeVectorProperty(t, $embedding, embedding)
          `;

        await neo4j_instance.executeQuery(
          creationQuery,
          { data: batchParams, embedding: embeddingProperty },
          { database: neo4jConfig.database },
        );
      }

      let withMetadataClause = "";
      if (filterMetadata.length > 0) {
        const metadataProps = filterMetadata
          .map((key) => `n.\`${safeIdent(key)}\``)
          .join(", ");
        withMetadataClause = ` WITH [${metadataProps}]`;
      }

      const createVectorIndexQuery = `
      ${cypherPrefix}CREATE VECTOR INDEX $indexName IF NOT EXISTS
      FOR (n:\`${safeLabelName}\`) ON (n.\`${embeddingProperty}\`)${withMetadataClause}
            `.trim();

      await neo4j_instance.executeQuery(
        createVectorIndexQuery,
        { indexName: indexId },
        { database: neo4jConfig.database },
      );

      if (fullTextQuery != undefined) {
        const fullTextIndexQuery = `
          CREATE FULLTEXT INDEX $fullTextIndexName IF NOT EXISTS
          FOR (n:\`${safeLabelName}\`)
          ON EACH [n.\`${safeTextProperty}\`]
          `;
        await neo4j_instance.executeQuery(
          fullTextIndexQuery,
          { fullTextIndexName: fullTextIndexName },
          { database: neo4jConfig.database },
        );
      }

      neo4j_instance.close();
    },
  );
}

function getDefaultConfig() {
  const {
    NEO4J_URI: url,
    NEO4J_USERNAME: username,
    NEO4J_PASSWORD: password,
    NEO4J_DATABASE: database,
  } = process.env;

  if (!url || !username || !password) {
    throw new Error(
      "Please provide Neo4j connection details through environment variables: NEO4J_URI, NEO4J_USERNAME, and NEO4J_PASSWORD are required.\n" +
        "For more details see https://neo4j.com/docs/api/javascript-driver/current/",
    );
  }

  return {
    url,
    username,
    password,
    ...(database && { database }),
  };
}

type SearchType = "vector" | "hybrid";
