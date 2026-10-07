from fastapi import FastAPI, Request
from neo4j_agent_memory import MemoryClient, MemorySettings, Neo4jConfig

app = FastAPI()

# Connection to your Docker database
settings = MemorySettings(
    neo4j=Neo4jConfig(
        uri="bolt://localhost:7687",
        username="neo4j",
        password="apoc1234"
    ),
    embedding={
        "provider": "sentence_transformers",
        "model": "all-MiniLM-L6-v2",
        "dimension": 384,
        "dimensions": 384,
    },
    long_term={
        "embedding_dimension": 384,
        "index_name": "entity_embedding_idx"
    }
)
memory_client = MemoryClient(settings)

@app.on_event("startup")
async def startup():
    await memory_client.connect()

@app.post("/setup")
async def setup():
    return {"status": "ok"}

@app.post("/add_entity")
async def add_entity(request: Request):
    data = await request.json()
    # Supports both camelCase (TS) and snake_case
    entity_type = data.get("entity_type") or data.get("entityType")
    
    entity, _ = await memory_client.long_term.add_entity(
        name=data["name"],
        entity_type=entity_type,
        description=data.get("description")
    )
    return {"id": str(entity.id), "success": True}

@app.post("/search_entities")
async def search_entities(request: Request):
    data = await request.json()
    results = await memory_client.long_term.search_entities(data["query"])
    return [{"name": r.name, "description": r.description} for r in results]


@app.post("/add_relationship")
async def add_relationship(request: Request):
    data = await request.json()
    
    source = data.get("source") or data.get("sourceId")
    target = data.get("target") or data.get("targetId")
    rel_type = data.get("type") or data.get("relationshipType")
    description = data.get("description")

    # Use positional arguments to avoid "unexpected keyword argument" error
    await memory_client.long_term.add_relationship(
        source,
        target,
        rel_type,
        description
    )
    return {"success": True}