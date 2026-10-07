from fastapi import FastAPI, Request
from neo4j_agent_memory import MemoryClient, MemorySettings, Neo4jConfig
from neo4j_agent_memory.config.settings import ExtractionConfig, ExtractorType, MergeStrategy
from contextlib import asynccontextmanager

app = FastAPI()

# SERVER CONFIGURATION
settings = MemorySettings(
    neo4j=Neo4jConfig(
        uri="bolt://localhost:7687",
        username="neo4j",
        password="apoc1234"  # Make sure this matches your DB credentials
    ),
    embedding={
        "provider": "sentence_transformers",
        "model": "all-MiniLM-L6-v2",
        "dimensions": 384
    },
    # LOCAL NER CONFIGURATION (ZERO API, ZERO LLM)
    extraction=ExtractionConfig(
        extractor_type=ExtractorType.PIPELINE,
        enable_spacy=True,          
        enable_gliner=True,         
        enable_llm_fallback=False,  
        merge_strategy=MergeStrategy.CONFIDENCE,
        entity_types=["PERSON", "ORGANIZATION", "LOCATION", "MOVIE", "CHARACTER"]
    )
)

memory_client = MemoryClient(settings)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Executed on server startup
    print("Connecting to Neo4j...")
    await memory_client.connect()
    yield
    # Executed on server shutdown (Ctrl+C)
    print("Closing Neo4j connection...")
    await memory_client.close()

app = FastAPI(lifespan=lifespan)

@app.post("/add_entity")
async def add_entity(request: Request):
    """Used when Genkit/Gemini performs NER and passes the exact data"""
    data = await request.json()
    name = data.get("name")
    entity_type = data.get("entityType")
    description = data.get("description")
    
    entity, _ = await memory_client.long_term.add_entity(
        name,
        entity_type,
        {"description": description} if description else None
    )
    return {"success": True, "id": entity.id}

@app.post("/add_relationship")
async def add_relationship(request: Request):
    """Used when Genkit/Gemini identifies relationships and passes them to the server"""
    data = await request.json()
    source = data.get("source") or data.get("sourceId")
    target = data.get("target") or data.get("targetId")
    rel_type = data.get("type") or data.get("relationshipType")
    description = data.get("description")
    
    # Resolved the TypeError by using positional arguments
    await memory_client.long_term.add_relationship(
        source,
        target,
        rel_type,
        description
    )
    return {"success": True}

@app.post("/search_entities")
async def search_entities(request: Request):
    data = await request.json()
    query = data.get("query")
    results = await memory_client.long_term.search_entities(query)
    
    return [
        {"id": r.id, "name": r.name, "description": r.description} 
        for r in results
    ]

@app.post("/extract_and_save")
async def extract_and_save(request: Request):
    """
    Send raw text here. Python will use spaCy and GLiNER 
    to extract entities and save them into Neo4j, without using Gemini!
    """
    data = await request.json()
    text = data.get("text")
    
    # The Python library will parse the text using local models
    result = await memory_client.long_term.extract_and_save(text)
    
    return {"success": True, "entities_found": len(result)}