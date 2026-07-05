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

export interface FoodCatalogItem extends BaseRecord {
  type: 'foodCatalog';
  name: string;
  category: FoodCategory;
  defaultUnit?: 'g' | 'ml';
  ingredientIds: string[];
}

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
  }
}

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
