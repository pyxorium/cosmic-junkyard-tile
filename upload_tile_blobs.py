#!/usr/bin/env python3
"""
upload_tile_blobs.py  (Cosmic Junkyard tile)

Adapted from the wish demo's alice-palette/upload_tile_blobs.py, the same
proven pipeline, with three changes:

  1. Two files instead of one: index.html, plus the bundled fallback
     sprite (sprite.png) that index.html loads by relative path.
  2. The app password is asked for on screen when you run it (never
     shown, never saved), the same way publish_tile.py already works,
     instead of being typed into this file.
  3. Each file's expected CID is computed from the file itself when you
     run it, rather than pasted in by hand, so it stays right if the
     tile is edited. The check against the PDS's own answer is unchanged.

Uploads the files to the @thunderbird.cafe PDS as blobs and writes
record.prepared.json next to this script. Nothing is published yet:
publish_tile.py does that as a separate step.

USAGE (from C:\\thunderbird-cafe\\cosmic-junkyard-tile):
    python upload_tile_blobs.py
then:
    python ..\\wish-demo\\publish\\publish_tile.py record.prepared.json thunderbird.cafe
"""

import base64
import datetime
import getpass
import hashlib
import json
import sys
from pathlib import Path

from atproto import Client, IdResolver

try:
    import libipld
    HAVE_LIBIPLD = True
except ImportError:
    HAVE_LIBIPLD = False

HANDLE = "thunderbird.cafe"
PDS_URL_OVERRIDE = None  # resolved from the DID document at runtime

HERE = Path(__file__).parent
TILE_DIR = HERE / "tile"
COLLECTION = "ing.dasl.masl"

TILE_NAME = "Cosmic Junkyard"
TILE_DESCRIPTION = (
    "Dodge falling dice and catch saucers and aliens, playing as your own "
    "atproto RPG actor sprite. A House Dice Dice Lab game, as a Web Tile."
)

# Only these files are uploaded. manifest.json isn't uploaded: its name
# and description are carried by TILE_NAME / TILE_DESCRIPTION above,
# the same way the alice-palette tile was published.
FILES = [
    {"path": TILE_DIR / "index.html", "resource_key": "/", "content_type": "text/html"},
    {"path": TILE_DIR / "sprite.png", "resource_key": "/sprite.png", "content_type": "image/png"},
]


def raw_cid(data: bytes) -> str:
    """CIDv1, raw codec (0x55), sha2-256: what a PDS returns for a blob."""
    cid_bytes = bytes([0x01, 0x55, 0x12, 0x20]) + hashlib.sha256(data).digest()
    return "b" + base64.b32encode(cid_bytes).decode("ascii").lower().rstrip("=")


def resolve_pds(handle_or_did: str) -> str:
    resolver = IdResolver()
    did = handle_or_did if handle_or_did.startswith("did:") else resolver.handle.resolve(handle_or_did)
    if did is None:
        raise RuntimeError(f"Could not resolve handle to a DID: {handle_or_did}")
    did_doc = resolver.did.resolve(did)
    if did_doc is None:
        raise RuntimeError(f"Could not resolve DID document for: {did}")
    pds = did_doc.get_pds_endpoint()
    if pds is None:
        raise RuntimeError(f"DID document has no PDS service endpoint: {did}")
    return pds


def candidate_dag_cbor_cid(obj):
    """CIDv1, dag-cbor codec (0x71), sha2-256: same scheme atproto uses
    for record CIDs."""
    if not HAVE_LIBIPLD:
        return None
    encoded = libipld.encode_dag_cbor(obj)
    cid_bytes = bytes([0x01, 0x71, 0x12, 0x20]) + hashlib.sha256(encoded).digest()
    return "b" + base64.b32encode(cid_bytes).decode("ascii").lower().rstrip("=")


def main():
    # Check every file is present before asking for anything.
    missing = [str(f["path"]) for f in FILES if not f["path"].is_file()]
    if missing:
        print("These files are missing:")
        for m in missing:
            print("  " + m)
        print("Run this script from the cosmic-junkyard-tile folder, with the tile files in tile\\.")
        sys.exit(1)

    print("About to upload these files for the Cosmic Junkyard tile:")
    for f in FILES:
        print(f"  {f['resource_key']:<12} {f['path'].name}  ({f['path'].stat().st_size:,} bytes)")
    print(f"to the account: {HANDLE}\n")

    app_password = getpass.getpass(f"App password for {HANDLE} (from https://bsky.app/settings/app-passwords): ")
    if not app_password.strip():
        print("No password entered, nothing uploaded.")
        sys.exit(1)

    pds_url = PDS_URL_OVERRIDE or resolve_pds(HANDLE)
    print(f"Resolved PDS: {pds_url}")

    client = Client(base_url=pds_url)
    client.login(HANDLE, app_password.strip())
    did = client.me.did
    print(f"Authenticated as {did}")

    resources = {}
    results = []
    for entry in FILES:
        path = entry["path"]
        data = path.read_bytes()
        predicted = raw_cid(data)
        print(f"\nUploading {path.name} ({entry['resource_key']}) ...")

        upload = client.invoke_procedure(
            "com.atproto.repo.uploadBlob",
            data=data,
            input_encoding="application/octet-stream",
            output_encoding="application/json",
        )
        blob = upload.content["blob"]
        returned_cid = blob["ref"]["$link"]
        match = returned_cid == predicted
        print(f"  predicted CID:  {predicted}")
        print(f"  PDS returned:   {returned_cid}")
        print(f"  match:          {'YES' if match else 'NO'}")

        results.append({"resource_key": entry["resource_key"], "blob": blob, "predicted_cid": predicted, "matched": match})
        resources[entry["resource_key"]] = {
            "src": {
                "$type": "blob",
                "ref": {"$link": returned_cid},
                "size": blob["size"],
                "mimeType": blob["mimeType"],
            },
            "content-type": entry["content_type"],
        }

    (HERE / "upload_results.json").write_text(json.dumps(results, indent=2))
    print(f"\nWrote {HERE / 'upload_results.json'}")

    if not all(r["matched"] for r in results):
        print("\nA CID didn't match what the file itself predicts, so the PDS stored")
        print("something different from the file on disk. Stopping here; nothing to publish.")
        sys.exit(1)

    tile = {"name": TILE_NAME, "description": TILE_DESCRIPTION, "resources": resources}
    candidate_cid = candidate_dag_cbor_cid(tile)
    created_at = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    record = {
        "$type": COLLECTION,
        "cid": candidate_cid or "<compute manually -- libipld not available>",
        "tile": tile,
        "createdAt": created_at,
    }

    record_path = HERE / "record.prepared.json"
    record_path.write_text(json.dumps(record, indent=2))
    print(f"Wrote {record_path} (not published yet)")
    print("\nAll uploads matched. Next step:")
    print(f"  python ..\\wish-demo\\publish\\publish_tile.py record.prepared.json {HANDLE}")


if __name__ == "__main__":
    main()
