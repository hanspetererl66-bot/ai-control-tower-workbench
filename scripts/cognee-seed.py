"""Load the Werkbank sample graph into Cognee so the 'cognee-memory' connector can answer questions about it.

Usage (Python 3.10 to 3.13):
    npm run cognee:corpus
    pip install cognee            # or: uv pip install cognee
    export LLM_API_KEY=...        # needed once, to let Cognee extract entities and relations
    python scripts/cognee-seed.py [--dataset werkbank] [--reset]

Use the same SYSTEM_ROOT_DIRECTORY / DATA_ROOT_DIRECTORY as the connector (see README), otherwise the connector
reads another, empty store. Only the fictional sample data is loaded.
"""
import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

os.environ.setdefault("ENABLE_BACKEND_ACCESS_CONTROL", "false")

PROMPT = (
    "Extract entities and the relations between them. Keep the identifiers that appear in brackets "
    "(for example contract:...) as part of the entity name. Do not invent facts that are not in the text."
)


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", default="werkbank")
    parser.add_argument("--corpus", default=str(Path(__file__).resolve().parent.parent / "dist" / "cognee-corpus.json"))
    parser.add_argument("--reset", action="store_true", help="delete the dataset first")
    args = parser.parse_args()

    path = Path(args.corpus)
    if not path.exists():
        print(f"{path} not found. Run: npm run cognee:corpus", file=sys.stderr)
        return 1
    docs = json.loads(path.read_text(encoding="utf-8"))

    import cognee  # imported late so --help works without it

    if args.reset:
        await cognee.forget(dataset=args.dataset)
    texts = [d["text"] for d in docs]
    print(f"Loading {len(texts)} documents into dataset '{args.dataset}' ...")
    await cognee.remember(texts, dataset_name=args.dataset, custom_prompt=PROMPT)
    print("Done. Ask the Cognee memory connector, for example: Which tickets concern the Muster Industrie contract?")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
