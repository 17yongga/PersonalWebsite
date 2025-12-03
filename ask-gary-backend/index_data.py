import os
import json
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

from config import (
    DATA_DIR,
    EMBEDDINGS_MODEL,
    CHUNK_SIZE,
    CHUNK_OVERLAP,
)

# Load env vars
load_dotenv()

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


def chunk_text(text, chunk_size=CHUNK_SIZE, overlap=CHUNK_OVERLAP):
    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        chunk = text[start:end]
        chunks.append(chunk)
        start += chunk_size - overlap
    return chunks


def embed_text(text):
    resp = client.embeddings.create(
        model=EMBEDDINGS_MODEL,
        input=text,
    )
    return resp.data[0].embedding


def index_files():
    data_path = Path(DATA_DIR)
    if not data_path.exists():
        print(f"Error: {DATA_DIR} directory not found!")
        return

    txt_files = list(data_path.glob("*.txt")) + list(data_path.glob("*.md"))
    if not txt_files:
        print(f"No .txt or .md files found in {DATA_DIR}/")
        return

    print(f"Found {len(txt_files)} files to index")

    all_chunks = []
    chunk_id = 0

    for file_path in txt_files:
        print(f"\nIndexing: {file_path.name}")
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                text = f.read()

            chunks = chunk_text(text)
            print(f" Split into {len(chunks)} chunks")

            for i, chunk in enumerate(chunks):
                if len(chunk.strip()) < 50:
                    continue

                print(f" Embedding chunk {i + 1}/{len(chunks)}...", end="\r")
                embedding = embed_text(chunk)

                all_chunks.append(
                    {
                        "id": f"{file_path.stem}_{chunk_id}",
                        "text": chunk,
                        "embedding": embedding,
                        "source": file_path.name,
                        "chunk_index": i,
                    }
                )
                chunk_id += 1

            print(f" ✓ Indexed {file_path.name}")

        except Exception as e:
            print(f" ✗ Error indexing {file_path.name}: {e}")

    out_path = Path("indexed_data.json")
    with out_path.open("w", encoding="utf-8") as f:
        json.dump(all_chunks, f)

    print("\n✓ Indexing complete!")
    print(f"Saved {len(all_chunks)} chunks to {out_path}")


if __name__ == "__main__":
    print("Starting data indexing...")
    index_files()
