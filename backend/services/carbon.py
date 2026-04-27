"""
Soil Carbon Calculator and Carbon Accounting service.
Formula chain: SOM → Organic Carbon → Carbon Stock → CO₂ equivalent.
"""
from datetime import date
from typing import Any, Dict, List, Optional


def calculate_carbon_stock(
    som_pct: float,
    bulk_density_g_cm3: float,
    depth_cm: float,
    area_ha: float = 1.0,
) -> dict:
    """
    Calculate soil carbon metrics.

    Args:
        som_pct:             Soil Organic Matter percentage (%)
        bulk_density_g_cm3:  Bulk density in g/cm³
        depth_cm:            Soil depth in cm
        area_ha:             Area in hectares (default 1 for per-ha values)

    Returns:
        Dictionary with all carbon metrics.
    """
    organic_carbon_pct      = som_pct * 0.58                                 # Van Bemmelen factor
    carbon_stock_t_per_ha   = organic_carbon_pct * bulk_density_g_cm3 * depth_cm * 100 / 1000
    co2_equivalent_t_per_ha = carbon_stock_t_per_ha * 3.67                   # C → CO₂ mass ratio
    total_carbon_stock_t    = carbon_stock_t_per_ha * area_ha
    total_co2e_t            = co2_equivalent_t_per_ha * area_ha

    return {
        "som_pct":                   round(som_pct, 2),
        "organic_carbon_pct":        round(organic_carbon_pct, 3),
        "bulk_density_g_cm3":        round(bulk_density_g_cm3, 3),
        "depth_cm":                  depth_cm,
        "area_ha":                   area_ha,
        "carbon_stock_t_per_ha":     round(carbon_stock_t_per_ha, 2),
        "co2_equivalent_t_per_ha":   round(co2_equivalent_t_per_ha, 2),
        "total_carbon_stock_t":      round(total_carbon_stock_t, 2),
        "total_co2_equivalent_t":    round(total_co2e_t, 2),
        "date_calculated":           date.today().isoformat(),
    }


def compute_sequestration_rate(records: List[Dict]) -> Optional[Dict]:
    """
    Given a list of carbon records over time, calculate annual sequestration rate.
    Records must have 'carbon_stock_t_per_ha' and 'date_calculated' (YYYY-MM-DD).
    """
    if len(records) < 2:
        return None

    sorted_recs = sorted(records, key=lambda r: r.get("date_calculated", ""))
    earliest = sorted_recs[0]
    latest   = sorted_recs[-1]

    try:
        from datetime import datetime
        d1 = datetime.fromisoformat(earliest["date_calculated"])
        d2 = datetime.fromisoformat(latest["date_calculated"])
        years = max((d2 - d1).days / 365.25, 0.01)
        delta = latest["carbon_stock_t_per_ha"] - earliest["carbon_stock_t_per_ha"]
        return {
            "annual_sequestration_t_per_ha": round(delta / years, 3),
            "total_change_t_per_ha":         round(delta, 3),
            "period_years":                  round(years, 2),
            "trend":                         "increasing" if delta > 0 else "decreasing" if delta < 0 else "stable",
        }
    except Exception:
        return None


def validate_carbon_inputs(som: float, bd: float, depth: float) -> list[str]:
    """Return list of validation warnings for unrealistic inputs."""
    warnings = []
    if som < 0.5:      warnings.append("SOM below 0.5% is unusually low — verify sample.")
    if som > 15:       warnings.append("SOM above 15% is unusually high outside peatlands.")
    if bd < 0.8:       warnings.append("Bulk density below 0.8 g/cm³ is unusual for mineral soils.")
    if bd > 1.8:       warnings.append("Bulk density above 1.8 g/cm³ indicates heavy compaction.")
    if depth < 5:      warnings.append("Depth below 5 cm may not be representative.")
    if depth > 100:    warnings.append("Depth above 100 cm — ensure this is intentional.")
    return warnings


def build_trajectory(records: list[dict], target_t_per_ha: float = 100.0) -> list[dict]:
    """
    Project carbon stock trajectory forward to `target_t_per_ha`,
    or 10 years from the latest record, whichever comes first.
    """
    if not records:
        return []

    sorted_recs = sorted(records, key=lambda r: r.get("date_calculated", ""))
    seq = compute_sequestration_rate(sorted_recs)
    if not seq:
        return sorted_recs

    annual_rate = seq["annual_sequestration_t_per_ha"]
    latest      = sorted_recs[-1]
    last_stock  = latest.get("carbon_stock_t_per_ha", 0)
    last_year   = int(latest.get("date_calculated", "2026")[:4])

    projections = []
    for i in range(1, 11):
        yr       = last_year + i
        projected = last_stock + annual_rate * i
        projections.append({
            "date_calculated":         f"{yr}-01-01",
            "carbon_stock_t_per_ha":   round(projected, 2),
            "co2_equivalent_t_per_ha": round(projected * 3.67, 2),
            "projected":               True,
        })
        if projected >= target_t_per_ha:
            break

    return sorted_recs + projections
