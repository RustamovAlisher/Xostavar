/** Standart lug'atlar — frontend `src/data.ts` `defaultSettings` bilan bir xil (TZ 15). */
export const DEFAULT_SETTINGS = {
  store: { name: 'OMBOR CONTROL', subtitle: 'Metal & Qurilish Materiallar Ombori', address: '', phone: '', taxId: '', receiptFooter: 'Xarid va hamkorlik uchun rahmat!', printFormat: 'thermal' as const, paperWidthMm: 80 },
  rules: {
    pieceLengthMeters: 11.7, defaultCutLengthMeters: 6, cutDeductionMode: 'net' as const, defaultMinStock: 0, defaultCreditDays: 30,
    defaultCreditLimit: 5_000_000, vatPct: 12, estimatedMarginPct: 16, quickDownPaymentPcts: [25, 50], allowNegativeStock: false, requireShift: true, cashierMaxDiscount: 0,
  },
  units: [
    { id: 'piece', name: 'Dona', short: 'dona', precision: 0 },
    { id: 'kg', name: 'Kilogramm', short: 'kg', precision: 3 },
    { id: 'ton', name: 'Tonna', short: 't', precision: 3 },
    { id: 'meter', name: 'Metr', short: 'm', precision: 2 },
    { id: 'm2', name: 'Kvadrat metr', short: 'm²', precision: 2 },
    { id: 'liter', name: 'Litr', short: 'l', precision: 2 },
    { id: 'bag', name: 'Qop', short: 'qop', precision: 0 },
    { id: 'box', name: 'Quti', short: 'quti', precision: 0 },
    { id: 'can', name: 'Banka', short: 'banka', precision: 0 },
    { id: 'roll', name: 'Rulon', short: 'rulon', precision: 0 },
    { id: 'pack', name: 'Pachka', short: 'pachka', precision: 0 },
  ],
  categories: [
    { name: 'Armatura', icon: '🏗️', description: "Stroyka va konstruksiyalar uchun armatura po'latlari", defaultBaseUnit: 'meter', defaultIsDivisible: true, defaultConversions: [{ unit: 'piece', factor: 11.7 }] },
    { name: 'Trubalar', icon: '🔘', description: 'Profil va dumaloq metall trubalar', defaultBaseUnit: 'meter', defaultIsDivisible: true, defaultConversions: [{ unit: 'piece', factor: 6 }] },
    { name: 'Listlar', icon: '📄', description: "Tunuka va qalin list po'lat", defaultBaseUnit: 'piece', defaultIsDivisible: false, defaultConversions: [] },
    { name: "Xo'jalik mollari", icon: '🔩', description: 'Samorez, mix, bolt, elektrod va metizlar', defaultBaseUnit: 'piece', defaultIsDivisible: false, defaultConversions: [] },
    { name: 'Sement va aralashmalar', icon: '🧱', description: 'Qopdagi sement va quruq aralashmalar', defaultBaseUnit: 'bag', defaultIsDivisible: false, defaultConversions: [] },
    { name: 'Asbob-uskunalar', icon: '🛠️', description: 'Elektr asboblar, disklar, sarf materiallar', defaultBaseUnit: 'piece', defaultIsDivisible: false, defaultConversions: [] },
    { name: "Bo'yoqlar", icon: '🎨', description: 'Emal, gruntovka, lak va erituvchilar', defaultBaseUnit: 'liter', defaultIsDivisible: true, defaultConversions: [] },
    { name: 'Kafel va pol', icon: '🧩', description: 'Kafel, keramogranit, laminat', defaultBaseUnit: 'm2', defaultIsDivisible: true, defaultConversions: [] },
  ],
  sizePresets: [
    { category: 'Armatura', name: 'Ø 8 mm A500C', kgPerMeter: 0.395 },
    { category: 'Armatura', name: 'Ø 10 mm A500C', kgPerMeter: 0.617 },
    { category: 'Armatura', name: 'Ø 12 mm A500C', kgPerMeter: 0.888 },
    { category: 'Armatura', name: 'Ø 14 mm A500C', kgPerMeter: 1.21 },
    { category: 'Armatura', name: 'Ø 16 mm 25G2S', kgPerMeter: 1.578 },
    { category: 'Trubalar', name: '20×20×2 mm', kgPerMeter: 1.07 },
    { category: 'Trubalar', name: '40×20×2 mm', kgPerMeter: 1.75 },
    { category: 'Trubalar', name: '40×40×2 mm', kgPerMeter: 2.25 },
    { category: 'Trubalar', name: '80×80×3 mm', kgPerMeter: 7.1 },
    { category: 'Trubalar', name: '100×100×4 mm', kgPerMeter: 11.5 },
    { category: "Xo'jalik mollari", name: '70 mm' },
    { category: "Xo'jalik mollari", name: '100 mm' },
    { category: "Xo'jalik mollari", name: '120 mm' },
  ],
  customerGroups: ['Chakana', 'Usta', 'Prorab', 'Qurilish MCHJ'],
  paymentMethods: [
    { code: 'cash', label: 'Naqd pul', kind: 'cash' as const, enabled: true, system: true },
    { code: 'card', label: 'Plastik karta', kind: 'card' as const, enabled: true, system: true },
    { code: 'debt', label: 'Nasiya / Qarzga', kind: 'debt' as const, enabled: true, system: true },
    { code: 'transfer', label: "Bank o'tkazmasi", kind: 'transfer' as const, enabled: true, system: true },
  ],
  suppliers: ['Bekobod Metallurgiya Zavodi'],
  expenseCategories: ['Ijara', 'Ish haqi', 'Transport va yetkazib berish', 'Kommunal (elektr, suv, gaz, internet)', 'Reklama', "Ta'mirlash", "Soliq va yig'imlar", 'Boshqa'],
};

export const ALL_PERMISSIONS = [
  'view_pos', 'view_inventory', 'view_analytics', 'view_debts', 'view_audit_logs', 'view_users',
  'add_product', 'edit_product', 'delete_product', 'stock_in', 'give_debt', 'view_cost_price', 'view_expenses', 'manage_expenses',
  'manage_users', 'manage_branches', 'manage_settings',
];

/** Standart rollar — frontend `DEFAULT_ROLES` bilan bir xil; "Super Admin" = Egasi (all_branches). */
export const DEFAULT_ROLES = [
  { name: 'Super Admin', allBranches: true, permissions: ALL_PERMISSIONS },
  { name: 'Filial admini', allBranches: false, permissions: ['view_pos', 'view_inventory', 'view_analytics', 'view_debts', 'view_audit_logs', 'view_users', 'stock_in', 'give_debt', 'view_cost_price', 'view_expenses', 'manage_expenses', 'manage_users'] },
  { name: 'Kassir', allBranches: false, permissions: ['view_pos', 'view_debts', 'give_debt'] },
  { name: 'Omborchi', allBranches: false, permissions: ['view_pos', 'view_inventory', 'add_product', 'edit_product', 'stock_in'] },
  { name: 'Buxgalter', allBranches: false, permissions: ['view_pos', 'view_inventory', 'view_analytics', 'view_debts', 'view_audit_logs', 'view_cost_price', 'view_expenses', 'manage_expenses'] },
];
