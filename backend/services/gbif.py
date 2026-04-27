"""
GBIF Biodiversity API — species occurrence data.
Free, no key. Calculates Shannon H' diversity index.
"""
import logging
import math
from collections import Counter
from typing import Dict, List, Optional

import httpx

from config import GBIF_BASE_URL
import db

log = logging.getLogger(__name__)

# Key taxon groups for solar park monitoring
TAXON_GROUPS = {
    "birds":       212,    # Aves
    "insects":     216,    # Insecta
    "plants":      6,      # Plantae
    "mammals":     359,    # Mammalia
    "amphibians":  131,    # Amphibia
    "reptiles":    11592,  # Reptilia
}

async def fetch_occurrences(
    lat: float,
    lon: float,
    radius_km: float = 5.0,
    taxon_key: Optional[int] = None,
    limit: int = 100,
) -> List[Dict]:
    """Fetch species occurrence records near a coordinate."""
    cache_key = f"gbif_{lat}_{lon}_{taxon_key or 'all'}_{radius_km}"
    cached = await db.cache_get(cache_key, max_age_secs=12 * 3600)
    if cached:
        return cached

    params = {
        "decimalLatitude":  f"{lat - 0.05},{lat + 0.05}",
        "decimalLongitude": f"{lon - 0.05},{lon + 0.05}",
        "limit":   limit,
        "hasCoordinate": "true",
    }
    if taxon_key:
        params["taxonKey"] = taxon_key

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(f"{GBIF_BASE_URL}/occurrence/search", params=params)
            resp.raise_for_status()
            data = resp.json()
        records = data.get("results", [])
        await db.cache_set(cache_key, records)
        return records
    except Exception as exc:
        log.warning("GBIF fetch failed: %s", exc)
        return []

async def fetch_all_groups(lat: float, lon: float, radius_km: float = 5.0) -> dict:
    """Fetch occurrences for all taxon groups and return combined stats."""
    cache_key = f"gbif_all_{lat}_{lon}"
    cached = await db.cache_get(cache_key, max_age_secs=6 * 3600)
    if cached:
        return cached

    all_records: list[dict] = []
    group_counts: dict[str, int] = {}

    for group_name, taxon_key in TAXON_GROUPS.items():
        records = await fetch_occurrences(lat, lon, radius_km, taxon_key=taxon_key, limit=50)
        group_counts[group_name] = len(records)
        all_records.extend(records)

    stats = compute_diversity_stats(all_records, group_counts)
    await db.cache_set(cache_key, stats)
    return stats

def compute_diversity_stats(records: list[dict], group_counts: dict) -> dict:
    """Calculate Shannon H' index and species richness from occurrence records."""
    # Count individuals per species (using scientificName)
    species_counts: Counter = Counter()
    for r in records:
        name = r.get("scientificName") or r.get("species") or r.get("genus", "Unknown")
        if name:
            species_counts[name] += 1

    total = sum(species_counts.values())
    shannon_h = 0.0
    if total > 0:
        for count in species_counts.values():
            p = count / total
            if p > 0:
                shannon_h -= p * math.log(p)

    # Top species
    top_species = [
        {"name": sp, "count": cnt, "proportion": round(cnt / total, 3)}
        for sp, cnt in species_counts.most_common(10)
    ] if total > 0 else []

    # Observed species per group from GBIF records
    observed_per_group = {}
    for r in records:
        cls = (r.get("class") or "").lower()
        for grp in TAXON_GROUPS:
            if grp.rstrip("s") in cls or grp in cls:
                observed_per_group[grp] = observed_per_group.get(grp, 0) + 1
                break

    return {
        "shannon_h":         round(shannon_h, 3),
        "species_richness":  len(species_counts),
        "total_occurrences": total,
        "top_species":       top_species,
        "group_counts":      group_counts,
        "observed_per_group": observed_per_group,
        "evenness":          round(shannon_h / math.log(len(species_counts)), 3) if len(species_counts) > 1 else 0,
        "source":            "gbif",
    }

async def fetch_species_list(lat: float, lon: float) -> list[dict]:
    """Return a cleaned list of unique species with metadata."""
    records = await fetch_occurrences(lat, lon, limit=200)
    seen: set[str] = set()
    species: list[dict] = []
    for r in records:
        name = r.get("scientificName", "")
        if name and name not in seen:
            seen.add(name)
            species.append({
                "scientific_name": name,
                "common_name":     r.get("vernacularName", ""),
                "kingdom":         r.get("kingdom", ""),
                "class":           r.get("class", ""),
                "year":            r.get("year"),
                "gbif_key":        r.get("key"),
            })
    return species
