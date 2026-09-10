const COMPARISONS_TO_NATIVE: Record<string, string> = {
  $eq: "=",
  $ne: "<>",
  $lt: "<",
  $lte: "<=",
  $gt: ">",
  $gte: ">=",
};

const COMPARISONS_TO_NATIVE_OPERATORS = new Set(
  Object.keys(COMPARISONS_TO_NATIVE),
);

const TEXT_OPERATORS = new Set(["$like", "$ilike"]);

const LOGICAL_OPERATORS = new Set(["$and", "$or"]);

const SPECIAL_CASED_OPERATORS = new Set(["$in", "$nin", "$between"]);

const SUPPORTED_OPERATORS = new Set([
  ...COMPARISONS_TO_NATIVE_OPERATORS,
  ...TEXT_OPERATORS,
  ...LOGICAL_OPERATORS,
  ...SPECIAL_CASED_OPERATORS,
]);

const IS_IDENTIFIER_REGEX = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;

export function safeIdent(name: string): string {
  if (!IS_IDENTIFIER_REGEX.test(name)) {
    throw new Error(`Unsafe identifier: ${name}`);
  }

  return name;
}

function combineQueries(
  inputQueries: [string, Record<string, any>][],
  operator: string,
): [string, Record<string, any>] {
  let combinedQuery = "";
  const combinedParams: Record<string, any> = {};
  const paramCounter: Record<string, number> = {};

  for (const [query, params] of inputQueries) {
    let newQuery = query;
    for (const [param, value] of Object.entries(params)) {
      if (param in paramCounter) {
        paramCounter[param] += 1;
      } else {
        paramCounter[param] = 1;
      }
      const newParamName = `${param}_${paramCounter[param]}`;

      newQuery = newQuery.replace(`$${param}`, `$${newParamName}`);
      combinedParams[newParamName] = value;
    }

    if (combinedQuery) {
      combinedQuery += ` ${operator} `;
    }
    combinedQuery += `(${newQuery})`;
  }

  return [combinedQuery, combinedParams];
}

function collectParams(
  inputData: [string, Record<string, string>][],
): [string[], Record<string, any>] {
  const queryParts: string[] = [];
  const params: Record<string, any> = {};

  for (const [queryPart, param] of inputData) {
    queryParts.push(queryPart);
    Object.assign(params, param);
  }

  return [queryParts, params];
}

function handleFieldFilter(
  field: string,
  value: any,
  paramNumber = 1,
): [string, Record<string, any>] {
  if (typeof field !== "string") {
    throw new Error(
      `field should be a string but got: ${typeof field} with value: ${field}`,
    );
  }

  if (field.startsWith("$")) {
    throw new Error(
      `Invalid filter condition. Expected a field but got an operator: ${field}`,
    );
  }

  // Allow [a - zA - Z0 -9_], disallow $ for now until we support escape characters
  if (!IS_IDENTIFIER_REGEX.test(field)) {
    throw new Error(
      `Invalid field name: ${field}. Expected a valid identifier.`,
    );
  }

  let operator: string;
  let filterValue: any;

  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const keys = Object.keys(value);

    if (keys.length !== 1) {
      throw new Error(`Invalid filter condition. Expected a value which is a dictionary
        with a single key that corresponds to an operator but got a dictionary
        with ${keys.length} keys. The first few keys are: ${keys
          .slice(0, 3)
          .join(", ")}
      `);
    }

    // eslint-disable-next-line prefer-destructuring
    operator = keys[0];
    filterValue = value[operator];

    if (!SUPPORTED_OPERATORS.has(operator)) {
      throw new Error(
        `Invalid operator: ${operator}. Expected one of ${SUPPORTED_OPERATORS}`,
      );
    }
  } else {
    operator = "$eq";
    filterValue = value;
  }

  if (COMPARISONS_TO_NATIVE_OPERATORS.has(operator)) {
    const native = COMPARISONS_TO_NATIVE[operator];
    const querySnippet = `n.${field} ${native} $param_${paramNumber}`;
    const queryParam = { [`param_${paramNumber}`]: filterValue };

    return [querySnippet, queryParam];
  } else if (operator === "$between") {
    const [low, high] = filterValue;
    const querySnippet = `$param_${paramNumber}_low <= n.${field} <= $param_${paramNumber}_high`;
    const queryParam = {
      [`param_${paramNumber}_low`]: low,
      [`param_${paramNumber}_high`]: high,
    };

    return [querySnippet, queryParam];
  } else if (["$in", "$nin", "$like", "$ilike"].includes(operator)) {
    if (["$in", "$nin"].includes(operator)) {
      filterValue.forEach((val: any) => {
        if (
          typeof val !== "string" &&
          typeof val !== "number" &&
          typeof val !== "boolean"
        ) {
          throw new Error(`Unsupported type: ${typeof val} for value: ${val}`);
        }
      });
    }

    if (operator === "$in") {
      const querySnippet = `n.${field} IN $param_${paramNumber}`;
      const queryParam = { [`param_${paramNumber}`]: filterValue };
      return [querySnippet, queryParam];
    } else if (operator === "$nin") {
      const querySnippet = `NOT n.${field} IN $param_${paramNumber}`;
      const queryParam = { [`param_${paramNumber}`]: filterValue };
      return [querySnippet, queryParam];
    } else if (operator === "$like") {
      const querySnippet = `n.${field} CONTAINS $param_${paramNumber}`;
      const queryParam = { [`param_${paramNumber}`]: filterValue.slice(0, -1) };
      return [querySnippet, queryParam];
    } else if (operator === "$ilike") {
      const querySnippet = `toLower(n.${field}) CONTAINS toLower($param_${paramNumber})`;
      const queryParam = { [`param_${paramNumber}`]: filterValue.slice(0, -1) };
      return [querySnippet, queryParam];
    } else {
      throw new Error("Not Implemented");
    }
  } else {
    throw new Error("Not Implemented");
  }
}

export function constructMetadataFilter(
  filter: Record<string, any>,
): [string, Record<string, any>] {
  if (typeof filter !== "object" || filter === null) {
    throw new Error("Expected a dictionary representing the filter condition.");
  }

  const entries = Object.entries(filter);

  if (entries.length === 1) {
    const [key, value] = entries[0];

    if (key.startsWith("$")) {
      if (!["$and", "$or"].includes(key.toLowerCase())) {
        throw new Error(
          `Invalid filter condition. Expected $and or $or but got: ${key}`,
        );
      }

      if (!Array.isArray(value)) {
        throw new Error(
          `Expected an array for logical conditions, but got ${typeof value} for value: ${value}`,
        );
      }

      const operation = key.toLowerCase() === "$and" ? "AND" : "OR";
      const combinedQueries = combineQueries(
        value.map((v) => constructMetadataFilter(v)),
        operation,
      );

      return combinedQueries;
    } else {
      return handleFieldFilter(key, value);
    }
  } else if (entries.length > 1) {
    for (const [key] of entries) {
      if (key.startsWith("$")) {
        throw new Error(
          `Invalid filter condition. Expected a field but got an operator: ${key}`,
        );
      }
    }

    const and_multiple = collectParams(
      entries.map(([field, val], index) =>
        handleFieldFilter(field, val, index + 1),
      ),
    );

    if (and_multiple.length >= 1) {
      return [and_multiple[0].join(" AND "), and_multiple[1]];
    } else {
      throw Error(
        "Invalid filter condition. Expected a dictionary but got an empty dictionary",
      );
    }
  } else {
    throw new Error("Filter condition contains no entries.");
  }
}
