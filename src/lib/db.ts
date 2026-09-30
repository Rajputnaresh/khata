import Dexie, { type Table } from 'dexie'
import type { Category, Meta, Settings, Tx } from './types'

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'c_food', name: 'Food & Dining', icon: 'UtensilsCrossed', color: '#E8734A', kind: 'expense', monthlyLimit: 0, archived: false, sort: 1 },
  { id: 'c_grocery', name: 'Groceries', icon: 'ShoppingBasket', color: '#6BA368', kind: 'expense', monthlyLimit: 0, archived: false, sort: 2 },
  { id: 'c_transport', name: 'Transport', icon: 'Car', color: '#4E8FD4', kind: 'expense', monthlyLimit: 0, archived: false, sort: 3 },
  { id: 'c_fuel', name: 'Fuel', icon: 'Fuel', color: '#D9A23B', kind: 'expense', monthlyLimit: 0, archived: false, sort: 4 },
  { id: 'c_rent', name: 'Rent / EMI', icon: 'Home', color: '#8B6BC7', kind: 'expense', monthlyLimit: 0, archived: false, sort: 5 },
  { id: 'c_bills', name: 'Bills & Utilities', icon: 'Zap', color: '#C4577B', kind: 'expense', monthlyLimit: 0, archived: false, sort: 6 },
  { id: 'c_health', name: 'Health', icon: 'HeartPulse', color: '#3FA7A3', kind: 'expense', monthlyLimit: 0, archived: false, sort: 7 },
  { id: 'c_shopping', name: 'Shopping', icon: 'ShoppingBag', color: '#D1674E', kind: 'expense', monthlyLimit: 0, archived: false, sort: 8 },
  { id: 'c_edu', name: 'Education', icon: 'GraduationCap', color: '#5C8AC4', kind: 'expense', monthlyLimit: 0, archived: false, sort: 9 },
  { id: 'c_ent', name: 'Entertainment', icon: 'Clapperboard', color: '#B368C4', kind: 'expense', monthlyLimit: 0, archived: false, sort: 10 },
  { id: 'c_travel', name: 'Travel', icon: 'Plane', color: '#2E9E8F', kind: 'expense', monthlyLimit: 0, archived: false, sort: 11 },
  { id: 'c_fees', name: 'Fees & Charges', icon: 'ReceiptIndianRupee', color: '#9A7B4F', kind: 'expense', monthlyLimit: 0, archived: false, sort: 12 },
  { id: 'c_gift', name: 'Gifts', icon: 'Gift', color: '#D4758C', kind: 'expense', monthlyLimit: 0, archived: false, sort: 13 },
  { id: 'c_cash', name: 'Cash & ATM', icon: 'Wallet', color: '#7A8B99', kind: 'expense', monthlyLimit: 0, archived: false, sort: 14 },
  { id: 'c_other', name: 'Other', icon: 'Ellipsis', color: '#8A8078', kind: 'expense', monthlyLimit: 0, archived: false, sort: 99 },

  { id: 'c_salary', name: 'Salary', icon: 'Briefcase', color: '#4E9E6A', kind: 'income', monthlyLimit: 0, archived: false, sort: 1 },
  { id: 'c_freelance', name: 'Freelance / Side', icon: 'Sparkles', color: '#3E9C93', kind: 'income', monthlyLimit: 0, archived: false, sort: 2 },
  { id: 'c_interest', name: 'Interest', icon: 'Landmark', color: '#5E8CC0', kind: 'income', monthlyLimit: 0, archived: false, sort: 3 },
  { id: 'c_rental', name: 'Rental Income', icon: 'Building2', color: '#9A6FC0', kind: 'income', monthlyLimit: 0, archived: false, sort: 4 },
  { id: 'c_refund', name: 'Refund', icon: 'Undo2', color: '#7A9A5C', kind: 'income', monthlyLimit: 0, archived: false, sort: 5 },
  { id: 'c_income_other', name: 'Other Income', icon: 'Coins', color: '#6E9A8A', kind: 'income', monthlyLimit: 0, archived: false, sort: 99 },
]

export const DEFAULT_SETTINGS: Settings = {
  id: 'app',
  currency: 'INR',
  baseCurrency: 'INR',
  theme: 'system',
  overallMonthlyLimit: 0,
  backupEnabled: false,
  backupAuto: true,
  lastBackupAt: null,
  lastBackupName: null,
  onboarded: false,
  decimals: 2,
}

class KhataDB extends Dexie {
  tx!: Table<Tx, string>
  categories!: Table<Category, string>
  settings!: Table<Settings, string>
  meta!: Table<Meta, string>

  constructor() {
    super('khata')
    this.version(1).stores({
      // Indexed so the month-range scan and the category rollup both hit an index.
      tx: 'id, date, type, categoryId, status, [date+type]',
      categories: 'id, kind, archived, sort',
      settings: 'id',
      meta: 'key',
    })
  }
}

export const db = new KhataDB()

/** Seed defaults once. Safe to call on every launch. */
export async function ensureSeed(): Promise<void> {
  const has = await db.categories.count()
  if (has === 0) await db.categories.bulkAdd(DEFAULT_CATEGORIES)
  const s = await db.settings.get('app')
  if (!s) await db.settings.put(DEFAULT_SETTINGS)
}
