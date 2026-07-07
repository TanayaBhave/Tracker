import Dexie, { type Table } from 'dexie';

// ---- Shared base fields on every record ----
export interface BaseRecord {
  id: string;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  deleted: number;   // 0 | 1 (indexable boolean)
  enteredBy: string; // device label
}

// ---- Enums as string unions ----
export type FoodCategory =
  | 'puree' | 'solid' | 'finger-food' | 'liquid' | 'formula' | 'breastmilk' | 'other';
export type Texture =
  | 'smooth-puree' | 'mashed' | 'lumpy' | 'soft-solid' | 'hard-solid' | 'mixed';
export type MealReaction = 'none' | 'fussy' | 'gagged' | 'vomited' | 'refused';
export type PacePosition = 'paced-upright' | 'fast' | 'lying-back';
export type OralMotorTag =
  | 'ate-smoothly' | 'gagged' | 'coughed-choked' | 'spit-food-out'
  | 'pocketed-in-cheeks' | 'trouble-swallowing' | 'tongue-thrust';
export type Burped = 'yes' | 'no' | 'partial';

export type VomitSeverity = 'spit-up' | 'moderate' | 'large';
export type VomitAppearance =
  | 'milky-undigested' | 'partially-digested' | 'mucousy' | 'bloody-streak' | 'bile-green' | 'other';
export type VomitForce = 'effortless' | 'moderate' | 'projectile';
export type BodyPosition = 'lying-flat' | 'upright' | 'reclined' | 'during-after-feed' | 'car-ride';

export type StoolConsistency = 'hard' | 'formed' | 'soft' | 'loose' | 'watery';
export type ThreeLevel = 'less' | 'regular' | 'more';
export type FactorKind = 'instant' | 'duration' | 'scale';

export interface FoodItem {
  name: string;
  category: FoodCategory;
  amountGiven?: number;
  amountConsumed?: number;
  unit?: 'g' | 'ml';
  ingredientIds: string[];
  catalogId?: string; // link to FoodCatalogItem for nutrition lookup
}

export interface Meal extends BaseRecord {
  type: 'meal';
  timestamp: string;
  durationMinutes?: number;
  foodItems: FoodItem[];
  texture?: Texture;
  pacePosition?: PacePosition;
  oralMotorTags: OralMotorTag[];
  burped?: Burped;
  reaction: MealReaction;
  notes?: string;
}

export interface MedicationDose extends BaseRecord {
  type: 'med';
  timestamp: string;
  medName: string;
  doseAmount?: number;
  doseUnit?: string;
  catalogId?: string; // link to MedCatalogItem (unindexed payload field)
  notes?: string;
}

export interface VomitEvent extends BaseRecord {
  type: 'vomit';
  timestamp: string;
  severity: VomitSeverity;
  appearance?: VomitAppearance;
  forcefulness?: VomitForce;
  bodyPosition?: BodyPosition;
  linkedMealId?: string;
  notes?: string;
}

export interface StoolEvent extends BaseRecord {
  type: 'stool';
  timestamp: string;
  consistency: StoolConsistency;
  color?: string;
  straining?: number; // 0 | 1
  notes?: string;
}

export interface GassinessLog extends BaseRecord {
  type: 'gas';
  date: string; // YYYY-MM-DD
  level: ThreeLevel;
  notes?: string;
}

export interface PhysicalActivityLog extends BaseRecord {
  type: 'activity';
  date: string;
  level: ThreeLevel;
  activeMinutes?: number;
  notes?: string;
}

export interface SleepEvent extends BaseRecord {
  type: 'sleep';
  startTime: string;
  endTime?: string;
  quality?: 'good' | 'restless' | 'poor';
  notes?: string;
}

export interface WeightLog extends BaseRecord {
  type: 'weight';
  date: string;
  weight: number;
  unit: 'kg' | 'lb';
  notes?: string;
}

export interface SymptomFlagLog extends BaseRecord {
  type: 'symptom';
  date: string;
  flags: string[]; // e.g. ['back-arching','hoarse-cry']
  notes?: string;
}

export interface Factor extends BaseRecord {
  type: 'factor';
  name: string;
  kind: FactorKind;
  unit?: string;
  archived: number; // 0 | 1
}

export interface FactorEvent extends BaseRecord {
  type: 'factorEvent';
  factorId: string;
  timestamp?: string;
  startTime?: string;
  endTime?: string;
  value?: number;
  notes?: string;
}

export interface Ingredient extends BaseRecord {
  type: 'ingredient';
  name: string;
  tags: string[];
}

// ---- Nutrition (all values per 100 g / 100 ml) ----
export interface NutrientProfile {
  kcal?: number;
  protein_g?: number;
  fat_g?: number;
  carbs_g?: number;
  fiber_g?: number;
  iron_mg?: number;
  calcium_mg?: number;
  zinc_mg?: number;
  vitD_ug?: number;
  vitC_mg?: number;
  vitA_ug_rae?: number;
  potassium_mg?: number;
  sodium_mg?: number;
  folate_ug?: number;
  vitB12_ug?: number;
  sugar_g?: number;      // Total sugars — USDA nutrient 2000 (fallback 1063). See usdaMap.ts.
  addedSugar_g?: number; // Added sugars — USDA nutrient 1235, Branded foods only.
}

// Single source of truth for "every nutrient key" iteration (blend.ts,
// intake.ts, and anywhere else that sums/copies a NutrientProfile by key).
// Phase 3.6: centralized here so a future nutrient can't silently miss a
// consumer by only being added to one of several previously-duplicated lists.
export const NUTRIENT_KEYS: (keyof NutrientProfile)[] = [
  'kcal', 'protein_g', 'fat_g', 'carbs_g', 'fiber_g', 'iron_mg', 'calcium_mg',
  'zinc_mg', 'vitD_ug', 'vitC_mg', 'vitA_ug_rae', 'potassium_mg', 'sodium_mg',
  'folate_ug', 'vitB12_ug', 'sugar_g', 'addedSugar_g',
];

export interface FoodCatalogItem extends BaseRecord {
  type: 'foodCatalog';
  name: string;
  category: FoodCategory;
  defaultUnit?: 'g' | 'ml';
  ingredientIds: string[];
  brand?: string;
  upc?: string;              // normalized GTIN digits
  fdcId?: number;            // USDA FoodData Central id
  per100?: NutrientProfile;
  nutritionSource?: 'usda' | 'manual' | 'none' | 'recipe';
  servingGrams?: number;
  lastFetchedAt?: string;    // ISO, when per100 was fetched from USDA
  // Recipe / composite-dish feature (Phase 3): when set, this catalog item's
  // per100 was computed by blending these components' per100 profiles
  // (see src/nutrition/blend.ts), weighted by grams. Unindexed payload — no
  // Dexie schema change needed, it syncs like any other foodCatalog field.
  // `unit` (Phase 3.6) is display-only: math always treats 1 mL = 1 g
  // (density ≈1 at baby-food scale), so blend.ts never reads it. Old records
  // saved before Phase 3.6 lack it; callers default to 'g'.
  recipeComponents?: { catalogId: string; grams: number; unit?: 'g' | 'ml' }[];
}

// Medication/supplement catalog: remembered meds so daily logging is one tap,
// plus (for supplements) the nutrients delivered by ONE default dose — NOT
// per-100g like FoodCatalogItem.per100. computeDailyIntake() folds perDose
// into the day's totals for doses that link here via MedicationDose.catalogId.
export interface MedCatalogItem extends BaseRecord {
  type: 'medCatalog';
  name: string;
  kind: 'medication' | 'supplement';
  brand?: string;
  upc?: string;               // normalized GTIN digits (supplement bottle barcode)
  defaultDoseAmount?: number; // e.g. 5
  defaultDoseUnit?: string;   // e.g. 'drops', 'ml'
  perDose?: NutrientProfile;  // nutrients per ONE default dose
  archived: number;           // 0 | 1
}

// Synced singleton (id SETTINGS_ID) — baby profile + analysis config shared across devices.
export interface AppSettings extends BaseRecord {
  type: 'settings';
  dob?: string;                   // YYYY-MM-DD
  gestWeeksAtBirth?: number;      // e.g. 34
  gestDaysAtBirth?: number;       // extra days past the week count
  sex?: 'male' | 'female';
  associationWindowHours: number; // analysis window, default 2
}

export const SETTINGS_ID = 'baby';

export type AnyEvent =
  | Meal | MedicationDose | VomitEvent | StoolEvent | GassinessLog
  | PhysicalActivityLog | SleepEvent | WeightLog | SymptomFlagLog | FactorEvent;

export class BabyDB extends Dexie {
  meals!: Table<Meal, string>;
  meds!: Table<MedicationDose, string>;
  vomits!: Table<VomitEvent, string>;
  stools!: Table<StoolEvent, string>;
  gassiness!: Table<GassinessLog, string>;
  activity!: Table<PhysicalActivityLog, string>;
  sleep!: Table<SleepEvent, string>;
  weights!: Table<WeightLog, string>;
  symptoms!: Table<SymptomFlagLog, string>;
  factors!: Table<Factor, string>;
  factorEvents!: Table<FactorEvent, string>;
  ingredients!: Table<Ingredient, string>;
  foodCatalog!: Table<FoodCatalogItem, string>;
  settings!: Table<AppSettings, string>;
  medCatalog!: Table<MedCatalogItem, string>;

  constructor() {
    super('babyTracker');
    this.version(1).stores({
      meals: 'id, timestamp, updatedAt, deleted',
      meds: 'id, timestamp, updatedAt, deleted',
      vomits: 'id, timestamp, updatedAt, deleted',
      stools: 'id, timestamp, updatedAt, deleted',
      gassiness: 'id, date, updatedAt, deleted',
      activity: 'id, date, updatedAt, deleted',
      sleep: 'id, startTime, updatedAt, deleted',
      weights: 'id, date, updatedAt, deleted',
      symptoms: 'id, date, updatedAt, deleted',
      factors: 'id, name, updatedAt, deleted, archived',
      factorEvents: 'id, factorId, timestamp, startTime, updatedAt, deleted',
      ingredients: 'id, name, updatedAt, deleted',
      foodCatalog: 'id, name, updatedAt, deleted',
    });
    this.version(2).stores({
      foodCatalog: 'id, name, upc, fdcId, updatedAt, deleted',
      settings: 'id, updatedAt, deleted',
    }).upgrade(async (tx) => {
      // v1 stored meal ingredients as "Ingredients: x, y — notes" inside meal.notes.
      // Parse them into deduped Ingredient records + foodItems[0].ingredientIds.
      const ingredientsTbl = tx.table('ingredients');
      const mealsTbl = tx.table('meals');
      const idByName = new Map<string, string>();
      for (const ing of await ingredientsTbl.toArray()) idByName.set(ing.name.toLowerCase(), ing.id);
      const now = new Date().toISOString();
      const meals = await mealsTbl.toArray();
      for (const meal of meals) {
        const notes: string = meal.notes ?? '';
        if (!notes.startsWith('Ingredients: ')) continue;
        const after = notes.slice('Ingredients: '.length);
        const sep = after.indexOf(' — ');
        const names = (sep === -1 ? after : after.slice(0, sep))
          .split(',').map((s) => s.trim()).filter(Boolean);
        const rest = sep === -1 ? '' : after.slice(sep + 3);
        const ids: string[] = [];
        for (const name of names) {
          const key = name.toLowerCase();
          let ingId = idByName.get(key);
          if (!ingId) {
            ingId = newId();
            idByName.set(key, ingId);
            await ingredientsTbl.add({
              id: ingId, createdAt: now, updatedAt: now, deleted: 0, enteredBy: deviceLabel(),
              type: 'ingredient', name, tags: [],
            });
          }
          ids.push(ingId);
        }
        if (meal.foodItems?.[0]) meal.foodItems[0].ingredientIds = ids;
        meal.notes = rest || undefined;
        // Bump updatedAt so migrated meals sync; convergent under LWW when both phones migrate.
        meal.updatedAt = now;
        await mealsTbl.put(meal);
      }
    });
    // v3 adds ONLY the medication/supplement catalog table — no data to
    // migrate, so no upgrade callback is needed.
    this.version(3).stores({
      medCatalog: 'id, name, upc, updatedAt, deleted',
    });
  }
}

// Tables replicated by the sync engine. Device-local state (deviceLabel, syncUrl,
// syncToken, syncCursor, lastPushedAt, lastSyncAt) lives in localStorage and never syncs.
export const SYNC_TABLES = [
  'meals', 'meds', 'vomits', 'stools', 'gassiness', 'activity', 'sleep',
  'weights', 'symptoms', 'factors', 'factorEvents', 'ingredients', 'foodCatalog', 'settings',
  'medCatalog',
] as const;
export type SyncTable = (typeof SYNC_TABLES)[number];

export const db = new BabyDB();

// ---- Helpers ----
export function newId(): string {
  return (crypto.randomUUID && crypto.randomUUID()) ||
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function deviceLabel(): string {
  return localStorage.getItem('deviceLabel') || 'unset';
}

export function baseFields(): BaseRecord {
  const now = new Date().toISOString();
  return { id: newId(), createdAt: now, updatedAt: now, deleted: 0, enteredBy: deviceLabel() };
}

export function nowLocalISO(): string {
  // datetime-local value (no timezone), good default = now
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}

export function todayStr(): string {
  return nowLocalISO().slice(0, 10);
}

export function isoToLocal(iso: string): string {
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}
