export type TxType = 'expense' | 'income'
export type TxStatus = 'cleared' | 'pending'
export type BudgetPeriod = 'monthly' | 'weekly' | 'yearly'

/** A single money movement. Amounts are stored in PAISE (integer, 1 rupee = 100). */
export interface Tx {
  id: string
  type: TxType
  /** Integer paise. Always positive — direction is carried by `type`. */
  amount: number
  categoryId: string
  note: string
  /** ISO date (yyyy-mm-dd), local calendar day — never a UTC timestamp. */
  date: string
  status: TxStatus
  /** Recurring bill/salary flag — drives upcoming-bills insight. */
  recurring: boolean
  createdAt: number
  updatedAt: number
}

export interface Category {
  id: string
  name: string
  /** Lucide icon name. */
  icon: string
  /** Hex accent used for charts/badges. */
  color: string
  kind: TxType
  /** 0 = income-only category, otherwise monthly paise cap; 0 = no cap. */
  monthlyLimit: number
  archived: boolean
  sort: number
}

export interface Settings {
  id: 'app'
  currency: string
  /** Live rate vs base currency, used for group totals. */
  baseCurrency: string
  theme: 'light' | 'dark' | 'system'
  /** Monthly budget for total spending, paise. 0 = unset. */
  overallMonthlyLimit: number
  /** Passphrase never leaves the device; wraps the AES key for backups. */
  backupEnabled: boolean
  backupAuto: boolean
  lastBackupAt: number | null
  lastBackupName: string | null
  onboarded: boolean
  /** Fractional digits shown in the UI. */
  decimals: number
}

export interface Meta {
  key: string
  value: unknown
}
