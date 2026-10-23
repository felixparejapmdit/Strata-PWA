import type { BucketId, TextureAnalysis, TextureFamily, ZoneType } from "./types";
import { isWetZone } from "./buckets";

export interface Accessory {
  name: string;
  unit: string;
  /** Quantity of the accessory per m² (or per piece) of the parent material. */
  qtyPerUnit: number;
  unitCostPhp: number;
  reason: string;
}

export interface Supplier {
  name: string;
  area: string;
  note?: string;
}

export interface Material {
  id: string;
  name: string;
  family: TextureFamily;
  buckets: BucketId[];
  /** Zones this material is specified for; "any" means no restriction. */
  zones: ZoneType[] | "any";
  wetOk: boolean;
  brands: string;
  suppliers: Supplier[];
  spec: string;
  unit: "m²" | "pc";
  /** Indicative supply cost in PHP per unit. */
  supplyPhp: number;
  /** Indicative installation labour in PHP per unit. */
  installPhp: number;
  wastagePct: number;
  /** Text fed to the diffusion prompt for this surface. */
  prompt: string;
  tropical: string[];
  accessories: Accessory[];
  guidelines: string[];
  custom?: boolean;
}

/**
 * Indicative 2026 Metro Manila rates. They exist to make the BOQ meaningful out of the box;
 * every value is editable in the Material Library and must be confirmed by quotation.
 */
export const MATERIALS: Material[] = [
  {
    id: "sintered-stone-12",
    name: "Sintered stone, large format 12 mm",
    family: "stone",
    buckets: ["floor", "walls"],
    zones: ["living", "dining", "commercial", "kitchen", "bedroom", "office"],
    wetOk: true,
    brands: "Dekton (Cosentino), Neolith",
    suppliers: [
      { name: "Ashton Corp", area: "BGC, Taguig" },
      { name: "Euroasia", area: "Metro Manila" },
    ],
    spec: "12 mm sintered stone slab, 1600×3200 or 1200×2400 mm format, matte or polished",
    unit: "m²",
    supplyPhp: 9500,
    installPhp: 1400,
    wastagePct: 12,
    prompt: "large format sintered stone slabs with subtle natural veining, minimal tight grout lines",
    tropical: [
      "Zero VOC; inert mineral surface",
      "Immune to termites and fungal decay",
      "Near-zero water absorption (<0.1%), unaffected by humidity",
      "UV-stable colour for sun-exposed areas",
    ],
    accessories: [
      { name: "C2TE S1 polymer-modified tile adhesive", unit: "bag (25 kg)", qtyPerUnit: 0.25, unitCostPhp: 950, reason: "Full-contact back-buttered bed for large-format slabs" },
      { name: "Tile levelling clip system", unit: "m²", qtyPerUnit: 1, unitCostPhp: 120, reason: "Controls lippage on long slabs" },
    ],
    guidelines: [
      "Back-butter every slab and achieve ≥95% adhesive coverage; hollow spots crack under point loads.",
      "Provide movement joints per TCNA EJ171: about every 6–7.5 m indoors and every 2.4–3.7 m where exposed to direct sun.",
    ],
  },
  {
    id: "slim-porcelain-6",
    name: "Slim porcelain tile 6 mm (wet zone)",
    family: "tile",
    buckets: ["floor", "walls"],
    zones: ["bathroom", "kitchen", "outdoor-covered", "living", "dining"],
    wetOk: true,
    brands: "Porcelanosa, Florim",
    suppliers: [{ name: "Dexterton Corporation", area: "Quezon City / BGC" }],
    spec: "6 mm through-body porcelain, R10/R11 slip rating for floors, rectified edges",
    unit: "m²",
    supplyPhp: 3600,
    installPhp: 900,
    wastagePct: 10,
    prompt: "slim rectified porcelain tiles with crisp thin grout joints",
    tropical: [
      "Water absorption ≤0.5% (BIa porcelain)",
      "Termite and rot proof",
      "Paired with 100% solids epoxy grout to stop black mould in grout lines",
    ],
    accessories: [
      { name: "100% solids epoxy grout (mandatory)", unit: "kg", qtyPerUnit: 0.6, unitCostPhp: 780, reason: "Cementitious grout absorbs moisture and grows black mould in PH humidity" },
      { name: "Liquid-applied waterproofing membrane", unit: "m²", qtyPerUnit: 1.1, unitCostPhp: 420, reason: "Continuous membrane under wet-zone tiling, upturned 150 mm at walls" },
      { name: "C2TE S1 polymer-modified tile adhesive", unit: "bag (25 kg)", qtyPerUnit: 0.2, unitCostPhp: 950, reason: "Thin porcelain needs a flexible, full-contact bed" },
    ],
    guidelines: [
      "Use 100% solids epoxy grout in all wet zones; do not substitute cement-based or 'epoxy-modified' grout.",
      "Flood-test the waterproofing membrane for 24 h before tiling.",
      "Slope shower floors 1:50 to the drain; check with a straightedge before the screed cures.",
    ],
  },
  {
    id: "porcelain-600x1200",
    name: "Glazed porcelain tile 600×1200",
    family: "tile",
    buckets: ["floor", "walls"],
    zones: "any",
    wetOk: true,
    brands: "Mariwasa, imported Spanish/Italian lines",
    suppliers: [
      { name: "Dexterton Corporation", area: "Quezon City / BGC" },
      { name: "Wilcon Depot", area: "Nationwide branches" },
    ],
    spec: "9–10 mm glazed porcelain, 600×1200 mm, rectified, matte",
    unit: "m²",
    supplyPhp: 1650,
    installPhp: 750,
    wastagePct: 10,
    prompt: "large rectangular glazed porcelain floor tiles with thin grout lines",
    tropical: ["Low water absorption", "Termite proof", "Easy to clean in dusty, humid conditions"],
    accessories: [
      { name: "Polymer-modified tile adhesive", unit: "bag (25 kg)", qtyPerUnit: 0.2, unitCostPhp: 650, reason: "Thick-bed mortar alone leaves voids under 1200 mm tiles" },
      { name: "Epoxy grout", unit: "kg", qtyPerUnit: 0.5, unitCostPhp: 780, reason: "Mould-resistant joints" },
    ],
    guidelines: ["Stagger 600×1200 tiles at no more than 1/3 offset to limit lippage from tile bow."],
  },
  {
    id: "pu-cement-screed",
    name: "Heavy-duty polyurethane-cement screed",
    family: "concrete",
    buckets: ["floor"],
    zones: ["office", "parking", "commercial", "kitchen"],
    wetOk: true,
    brands: "Sikafloor PurCem",
    suppliers: [{ name: "Sika Philippines", area: "Metro Manila (via approved applicators)" }],
    spec: "6–9 mm trowel-applied PU-cement screed, matte seal coat",
    unit: "m²",
    supplyPhp: 2100,
    installPhp: 700,
    wastagePct: 5,
    prompt: "seamless matte grey polyurethane cement floor screed, industrial finish",
    tropical: [
      "Tolerates slab moisture far better than epoxy coatings",
      "Seamless: no joints for mould to colonise",
      "Chemical and abrasion resistant for vehicle traffic",
    ],
    accessories: [
      { name: "Moisture-tolerant primer", unit: "m²", qtyPerUnit: 1, unitCostPhp: 280, reason: "Bonds to green or damp concrete" },
    ],
    guidelines: [
      "Shot-blast or grind the slab to CSP 3–4 before priming.",
      "Anchor-groove all free edges and drains so the screed cannot delaminate.",
    ],
  },
  {
    id: "spc-plank",
    name: "SPC rigid-core vinyl plank (wood look)",
    family: "wood",
    buckets: ["floor"],
    zones: ["living", "dining", "bedroom", "office", "commercial"],
    wetOk: false,
    brands: "Various SPC manufacturers",
    suppliers: [{ name: "Wilcon Depot", area: "Nationwide branches" }],
    spec: "5–6 mm SPC plank with 0.5 mm wear layer, IXPE underlay",
    unit: "m²",
    supplyPhp: 1450,
    installPhp: 350,
    wastagePct: 8,
    prompt: "natural oak wood plank flooring with realistic grain",
    tropical: ["100% waterproof core", "Termite immune, unlike solid or engineered timber", "Dimensionally stable in humidity"],
    accessories: [
      { name: "0.2 mm PE vapour barrier", unit: "m²", qtyPerUnit: 1.1, unitCostPhp: 45, reason: "Mandatory over concrete slabs: blocks slab moisture and AC condensation" },
    ],
    guidelines: [
      "Never float click-lock flooring over bare concrete: lay a 0.2 mm PE vapour barrier with 200 mm taped laps.",
      "Test slab moisture before laying (≤75% RH, ASTM F2170); air-conditioned rooms over warm slabs condense underneath.",
    ],
  },
  {
    id: "anti-mold-paint",
    name: "Anti-mould acrylic paint system",
    family: "plain",
    buckets: ["walls", "ceiling"],
    zones: "any",
    wetOk: true,
    brands: "Boysen, Davies (anti-mould / anti-bacterial lines)",
    suppliers: [{ name: "Authorised paint centres", area: "Nationwide" }],
    spec: "Alkali-resistant primer + 2 coats anti-mould acrylic, matte or eggshell",
    unit: "m²",
    supplyPhp: 180,
    installPhp: 160,
    wastagePct: 10,
    prompt: "smooth matte painted wall surface",
    tropical: ["Fungicidal film resists black mould", "Low VOC", "Breathable over cement render"],
    accessories: [
      { name: "Skim coat", unit: "bag (20 kg)", qtyPerUnit: 0.06, unitCostPhp: 520, reason: "Smooth substrate over rough cement render" },
    ],
    guidelines: [
      "Let new cement render cure 28 days (or use an alkali-resistant primer) before painting; alkali burns through paint.",
      "Treat existing mould with a biocidal wash and let it dry fully before repainting.",
    ],
  },
  {
    id: "wpc-fluted-panel",
    name: "WPC fluted wall panel",
    family: "wood",
    buckets: ["walls", "ceiling"],
    zones: ["living", "dining", "bedroom", "office", "commercial"],
    wetOk: false,
    brands: "Various WPC manufacturers",
    suppliers: [{ name: "Local interior fit-out suppliers", area: "Metro Manila" }],
    spec: "Wood-plastic composite fluted panel, 160–200 mm module, on aluminium or treated furring",
    unit: "m²",
    supplyPhp: 1850,
    installPhp: 450,
    wastagePct: 8,
    prompt: "vertical fluted wood slat wall paneling, warm timber tone",
    tropical: ["Termite proof", "Does not swell or rot in humidity", "No varnish maintenance"],
    accessories: [
      { name: "Aluminium furring channel", unit: "m", qtyPerUnit: 2.5, unitCostPhp: 95, reason: "Timber furring invites termites" },
    ],
    guidelines: ["Fix to aluminium or treated furring only; untreated timber battens behind panels attract termites."],
  },
  {
    id: "mr-gypsum-ceiling",
    name: "Moisture-resistant gypsum board ceiling",
    family: "plain",
    buckets: ["ceiling"],
    zones: ["living", "dining", "bedroom", "office", "commercial", "kitchen"],
    wetOk: false,
    brands: "Gyproc MR, Knauf MR",
    suppliers: [{ name: "Wilcon Depot", area: "Nationwide branches" }],
    spec: "12 mm MR gypsum board on galvanised metal furring, taped and painted",
    unit: "m²",
    supplyPhp: 650,
    installPhp: 550,
    wastagePct: 8,
    prompt: "smooth flat white plaster ceiling",
    tropical: ["Water-repellent core and facers", "Metal framing is termite proof"],
    accessories: [
      { name: "Galvanised metal furring + carrying channel", unit: "m²", qtyPerUnit: 1, unitCostPhp: 320, reason: "Termite-proof framing" },
    ],
    guidelines: ["Provide access panels at every AC unit and drain line; condensate leaks are the main cause of ceiling failure."],
  },
  {
    id: "fiber-cement-ceiling",
    name: "Fibre-cement board ceiling (wet zone)",
    family: "plain",
    buckets: ["ceiling"],
    zones: ["bathroom", "kitchen", "outdoor-covered", "parking"],
    wetOk: true,
    brands: "HardieFlex (James Hardie)",
    suppliers: [{ name: "Wilcon Depot", area: "Nationwide branches" }],
    spec: "4.5–6 mm fibre-cement board on metal furring, anti-mould paint",
    unit: "m²",
    supplyPhp: 520,
    installPhp: 480,
    wastagePct: 8,
    prompt: "smooth painted ceiling",
    tropical: ["Unaffected by water and steam", "Termite and rot proof"],
    accessories: [
      { name: "Galvanised metal furring", unit: "m²", qtyPerUnit: 1, unitCostPhp: 300, reason: "Termite-proof framing" },
    ],
    guidelines: ["Ventilate wet-zone ceilings with an exhaust fan ducted outside, not into the ceiling void."],
  },
  {
    id: "aluminium-linear-ceiling",
    name: "Aluminium linear ceiling (wood-grain)",
    family: "metal",
    buckets: ["ceiling", "walls"],
    zones: "any",
    wetOk: true,
    brands: "Various aluminium ceiling systems",
    suppliers: [{ name: "Local ceiling system suppliers", area: "Metro Manila" }],
    spec: "Aluminium linear strip/baffle ceiling, heat-transfer wood-grain finish",
    unit: "m²",
    supplyPhp: 2200,
    installPhp: 500,
    wastagePct: 5,
    prompt: "linear wood slat ceiling with warm timber grain",
    tropical: ["Wood look without termite or rot risk", "Suitable for semi-outdoor lanai and humid areas"],
    accessories: [],
    guidelines: ["Use stainless or galvanised fixings in coastal locations to avoid corrosion staining."],
  },
  {
    id: "microcement",
    name: "Microcement with PU sealer",
    family: "concrete",
    buckets: ["walls", "floor"],
    zones: ["living", "dining", "bedroom", "office", "commercial"],
    wetOk: false,
    brands: "Various microcement systems",
    suppliers: [{ name: "Specialist applicators", area: "Metro Manila" }],
    spec: "2–3 mm microcement, two-component PU sealer",
    unit: "m²",
    supplyPhp: 2600,
    installPhp: 900,
    wastagePct: 5,
    prompt: "seamless trowelled microcement surface, soft mottled concrete texture",
    tropical: ["Seamless, no grout lines for mould", "Sealed surface resists humidity"],
    accessories: [{ name: "Fibreglass reinforcement mesh", unit: "m²", qtyPerUnit: 1.05, unitCostPhp: 85, reason: "Controls hairline cracking" }],
    guidelines: ["Reseal every 2–3 years; the PU sealer is what keeps humidity out."],
  },
  {
    id: "performance-upholstery",
    name: "Performance upholstery fabric",
    family: "fabric",
    buckets: ["furniture"],
    zones: "any",
    wetOk: false,
    brands: "Solution-dyed acrylic / performance polyester",
    suppliers: [{ name: "Upholstery fabric houses", area: "Metro Manila" }],
    spec: "Solution-dyed, anti-microbial performance fabric, ≥50,000 Martindale",
    unit: "pc",
    supplyPhp: 18000,
    installPhp: 6000,
    wastagePct: 0,
    prompt: "upholstered furniture in textured woven fabric",
    tropical: ["Mould and mildew resistant", "Colourfast in strong sun", "Wipe-clean"],
    accessories: [],
    guidelines: ["Specify HR foam with anti-microbial treatment; standard foam traps humidity."],
  },
  {
    id: "hpl-marine-ply",
    name: "HPL on marine plywood (casework)",
    family: "wood",
    buckets: ["furniture"],
    zones: "any",
    wetOk: false,
    brands: "Formica, Wilsonart and local HPL",
    suppliers: [{ name: "Local millwork fabricators", area: "Metro Manila" }],
    spec: "18 mm termite-treated marine plywood, HPL both faces, PVC/ABS edge banding",
    unit: "pc",
    supplyPhp: 22000,
    installPhp: 5000,
    wastagePct: 0,
    prompt: "wood veneer cabinetry and furniture with realistic grain",
    tropical: ["Balanced HPL on both faces prevents warping", "Treated core resists termites"],
    accessories: [],
    guidelines: ["Laminate both faces (balance sheet) or panels will cup in humidity."],
  },
  {
    id: "quartz-top",
    name: "Engineered quartz / sintered stone top",
    family: "stone",
    buckets: ["furniture"],
    zones: "any",
    wetOk: true,
    brands: "Silestone, Caesarstone, Dekton",
    suppliers: [{ name: "Stone fabricators", area: "Metro Manila" }],
    spec: "20 mm engineered quartz or 12 mm sintered stone top",
    unit: "pc",
    supplyPhp: 28000,
    installPhp: 4000,
    wastagePct: 0,
    prompt: "polished stone countertops and table tops",
    tropical: ["Non-porous: no sealing, no mould", "Termite immune"],
    accessories: [],
    guidelines: ["Template after base cabinets are installed and level."],
  },
];

const FAMILY_PREFERENCE: Record<BucketId, { wet: Partial<Record<TextureFamily, string>>; dry: Partial<Record<TextureFamily, string>>; fallbackWet: string; fallbackDry: string }> = {
  floor: {
    wet: { concrete: "pu-cement-screed" },
    dry: { stone: "sintered-stone-12", wood: "spc-plank", tile: "porcelain-600x1200", concrete: "microcement", plain: "porcelain-600x1200", metal: "porcelain-600x1200", fabric: "spc-plank" },
    fallbackWet: "slim-porcelain-6",
    fallbackDry: "porcelain-600x1200",
  },
  walls: {
    wet: {},
    dry: { stone: "sintered-stone-12", wood: "wpc-fluted-panel", tile: "porcelain-600x1200", concrete: "microcement", metal: "aluminium-linear-ceiling" },
    fallbackWet: "slim-porcelain-6",
    fallbackDry: "anti-mold-paint",
  },
  ceiling: {
    wet: { wood: "aluminium-linear-ceiling", metal: "aluminium-linear-ceiling" },
    dry: { wood: "aluminium-linear-ceiling", metal: "aluminium-linear-ceiling" },
    fallbackWet: "fiber-cement-ceiling",
    fallbackDry: "mr-gypsum-ceiling",
  },
  furniture: {
    wet: { stone: "quartz-top", wood: "hpl-marine-ply" },
    dry: { stone: "quartz-top", wood: "hpl-marine-ply", tile: "quartz-top" },
    fallbackWet: "hpl-marine-ply",
    fallbackDry: "performance-upholstery",
  },
};

/**
 * Maps a surface + zone + detected texture family to a catalogue material, enforcing tropical
 * viability: wet zones always get wet-rated systems, parking/office floors get PU-cement.
 */
export function suggestMaterial(
  bucket: BucketId,
  zone: ZoneType,
  analysis: TextureAnalysis | undefined,
  library: Material[] = MATERIALS,
): { materialId: string; reason: string } {
  const wet = isWetZone(zone);
  const byId = (id: string) => library.find((m) => m.id === id);
  const prefs = FAMILY_PREFERENCE[bucket];

  if (bucket === "floor" && (zone === "parking" || zone === "office") && (!analysis || analysis.family === "concrete" || analysis.family === "plain")) {
    return { materialId: "pu-cement-screed", reason: `${zone === "parking" ? "Parking" : "Office"} floor → heavy-duty PU-cement screed` };
  }

  const family = analysis?.family;
  const candidate = family ? (wet ? prefs.wet[family] : prefs.dry[family]) : undefined;
  const fallback = wet ? prefs.fallbackWet : prefs.fallbackDry;
  let id = candidate ?? fallback;
  let m = byId(id);
  if (!m || (wet && !m.wetOk) || !m.buckets.includes(bucket)) {
    id = fallback;
    m = byId(id);
  }

  // A user-defined material of the same family and surface takes priority over the built-in default.
  const custom = library.find((x) => x.custom && x.buckets.includes(bucket) && x.family === family && (!wet || x.wetOk));
  if (custom) return { materialId: custom.id, reason: `Your library: ${custom.name}` };

  const what = family ? `${family} texture (${Math.round((analysis?.confidence ?? 0) * 100)}% confidence)` : "no reference";
  return { materialId: id, reason: `${wet ? "Wet zone" : "Dry zone"} ${bucket}, ${what} → ${m?.name ?? id}` };
}

export function findMaterial(id: string | null | undefined, library: Material[] = MATERIALS): Material | undefined {
  if (!id) return undefined;
  return library.find((m) => m.id === id);
}
