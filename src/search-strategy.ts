import { errorMetadataAndHybrid, FULLTEXT_INDEX_SUFFIX, Neo4jParams } from ".";
import { z } from "genkit";
import { constructMetadataFilter, safeIdent } from "./filter-utils";

export interface SearchStrategy {
  cypherPrefix(): string;
  generateQuery<T extends z.ZodTypeAny>(
    options: { filter?: Record<string, any>; k?: number },
    params: Neo4jParams<T>,
    content: string,
  ): { query: string; additionalParams: Record<string, any> };
}

export class VectorFunctionStrategy implements SearchStrategy {
  cypherPrefix() {
    return "";
  }

  generateQuery<EmbedderCustomOptions extends z.ZodTypeAny>(
    options: { filter?: Record<string, any>; k?: number },
    params: Neo4jParams<EmbedderCustomOptions>,
    content: string,
  ): { query: string; additionalParams: Record<string, any> } {
    const filter = options.filter;
    const {
      indexId,
      label,
      embeddingProperty = "embedding",
      textProperty = "text",
      fullTextIndexName = params.indexId + FULLTEXT_INDEX_SUFFIX,
    } = params;

    const nodeLabel = safeIdent(label || indexId);
    const embeddingPropertyName = safeIdent(embeddingProperty);
    const fullTextIndexNameValue = safeIdent(fullTextIndexName);
    const textPropertyName = safeIdent(textProperty);

    const retrievalQuery =
      params?.retrievalQuery ??
      `RETURN node.${textPropertyName} AS text, node {.*, text: Null, embedding: Null, id: Null } AS metadata`;
    const fullTextRetrievalQuery =
      params?.fullTextRetrievalQuery ?? retrievalQuery;
    const isHybrid = params?.searchType === "hybrid";

    if (
      params?.fullTextQuery == undefined &&
      content == undefined &&
      isHybrid
    ) {
      throw new Error(
        "Neither fullTextQuery nor content is defined for hybrid search.",
      );
    }

    if (filter == null) {
      const hybridQuery = `
          CALL {
              CALL db.index.vector.queryNodes($index, $k * 5, $embedding) YIELD node, score
              WITH collect({node:node, score:score}) AS nodes, max(score) AS max
              UNWIND nodes AS n
              // We use 0 as min
              RETURN n.node AS node, (n.score / max) AS score 
              UNION
              CALL db.index.fulltext.queryNodes("${fullTextIndexNameValue}", $fullTextQuery, {limit: $k}) YIELD node, score
              WITH collect({node: node, score: score}) AS nodes, max(score) AS max
              UNWIND nodes AS n
              RETURN n.node AS node, (n.score / max) AS score
          }
          WITH node, max(score) AS score ORDER BY score DESC LIMIT toInteger($k)
          ${fullTextRetrievalQuery}`;

      const vectorQuery = `
        CALL db.index.vector.queryNodes($index, $k, $embedding) YIELD node, score
        ${retrievalQuery}
      `;

      const query = isHybrid ? hybridQuery : vectorQuery;

      isHybrid && console.log("Generated Query name:", fullTextIndexNameValue);

      const additionalParams = isHybrid
        ? {
            fullTextQuery: params?.fullTextQuery ?? content,
            fullTextIndexName: fullTextIndexNameValue,
          }
        : {};

      return { query, additionalParams };
    }

    if (isHybrid) {
      throw new Error(errorMetadataAndHybrid);
    }

    const baseIndexQuery = `
      CYPHER runtime = parallel parallelRuntimeSupport=all 
      MATCH (n:\`${nodeLabel}\`)
      WHERE n.\`${embeddingPropertyName}\` IS NOT NULL
      AND
    `;

    const baseCosineQuery = `
      WITH n as node, vector.similarity.cosine(
        n.\`${embeddingPropertyName}\`,
        $embedding
      ) AS score ORDER BY score DESC LIMIT toInteger($k)
    `;
    const [fSnippets, fParams] = constructMetadataFilter(filter);

    const indexQuery =
      baseIndexQuery + fSnippets + baseCosineQuery + retrievalQuery;

    return { query: indexQuery, additionalParams: fParams };
  }
}

export class MatchSearchClauseStrategy implements SearchStrategy {
  cypherPrefix() {
    return "CYPHER 25";
  }

  generateQuery<EmbedderCustomOptions extends z.ZodTypeAny>(
    options: { filter?: Record<string, any>; k?: number },
    params: Neo4jParams<EmbedderCustomOptions>,
    content: string,
  ): { query: string; additionalParams: Record<string, any> } {
    const { filter, k } = options;
    const { indexId, textProperty = "text" } = params;
    const indexIdValue = safeIdent(indexId);
    const textPropertyName = safeIdent(textProperty);

    const retrievalQuery =
      params?.retrievalQuery ??
      `RETURN node.${textPropertyName} AS text, node {.*, text: Null, embedding: Null, id: Null } AS metadata`;

    let filterClause = "";
    let additionalParams: Record<string, any> = {};

    if (filter) {
      const [fSnippets, fParams] = constructMetadataFilter(filter);
      // Map 'n.' references from constructMetadataFilter to 'node.' for the SEARCH clause
      filterClause = `WHERE ${fSnippets.replace(/n\./g, "node.")}`;
      additionalParams = fParams;
    }

    const query = `
      CYPHER 25
      MATCH (node)
      SEARCH node IN (
          VECTOR INDEX \`${indexIdValue}\`
          FOR $embedding
          ${filterClause}
          LIMIT toInteger($k)
      ) SCORE AS score
      ${retrievalQuery}
    `.trim();

    return { query, additionalParams };
  }
}
