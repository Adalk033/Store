import type { FeatureFlagModule } from '../types';

// Settings key prefix for feature flags
const FEATURE_FLAG_PREFIX = 'feature_paginated_';

/**
 * Build the settings key for a module's pagination feature flag.
 * Stored in the settings table as: feature_paginated_cash = '1' | '0'
 */
export function getFeatureFlagKey(module: FeatureFlagModule): string {
  return `${FEATURE_FLAG_PREFIX}${module}`;
}

/**
 * Check if a module has pagination enabled based on its setting value.
 * A setting value of '1' means enabled; anything else means disabled.
 */
export function isPaginatedEnabled(settingValue: string | undefined): boolean {
  return settingValue === '1';
}

/**
 * All module identifiers for feature flag initialization.
 */
export const ALL_MODULES: readonly FeatureFlagModule[] = [
  'cash',
  'sales',
  'inventory',
  'credits',
  'customers',
  'products',
  'reports',
] as const;

/**
 * Default page sizes per module.
 * Used when no explicit pageSize is provided in a query.
 */
export const DEFAULT_PAGE_SIZES: Record<FeatureFlagModule, number> = {
  cash: 25,
  sales: 50,
  inventory: 50,
  credits: 25,
  customers: 50,
  products: 50,
  reports: 50,
} as const;
