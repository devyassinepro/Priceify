// app/lib/plans.ts - UPDATED plans structure
export interface Plan {
  name: string;
  displayName: string;
  price: number;
  currency: string;
  usageLimit: number;
  features: string[];
  recommended?: boolean;
  billingInterval?: string;
  trialDays?: number;
}

// ✅ NEW: Updated plan structure with new pricing
export const PLANS: Record<string, Plan> = {
  free: {
    name: "free",
    displayName: "Free",
    price: 0,
    currency: "USD",
    usageLimit: 20,
    billingInterval: "EVERY_30_DAYS",
    features: [
      "20 unique products per month",
      "Unlimited price changes per product",
      "4 adjustment types (%, fixed, +, -)",
      "Basic pricing history",
      "Product search and filtering",
      "Email support"
    ]
  },
  
  standard: {
    name: "standard",
    displayName: "Standard",
    price: 4.99,
    currency: "USD", 
    usageLimit: 500,
    billingInterval: "EVERY_30_DAYS",
    trialDays: 7,
    recommended: true, // Make Standard the recommended plan
    features: [
      "500 unique products per month",
      "Unlimited price changes per product", 
      "All adjustment types and filters",
      "Complete pricing history",
      "Advanced product search",
      "Priority email support",
      "CSV export capabilities"
    ]
  },
  
  pro: {
    name: "pro", 
    displayName: "Pro",
    price: 9.99,
    currency: "USD",
    usageLimit: 999999, // ✅ NEW: Unlimited = very high number for Pro
    billingInterval: "EVERY_30_DAYS",
    trialDays: 7,
    features: [
      "Unlimited products per month",
      "Unlimited price changes per product",
      "All features + bulk operations", 
      "Advanced analytics and reporting",
      "Scheduled price updates",
      "Priority support (24h response)",
      "API access for integrations",
      "Custom reporting"
    ]
  }
};

// ✅ NEW: Check if plan has unlimited products
export function hasUnlimitedProducts(planName: string): boolean {
  const plan = getPlan(planName);
  return plan.usageLimit >= 999999; // Pro plan is unlimited
}

// ✅ UPDATED: Better display formatting for unlimited
export function formatUsageDisplay(current: number, limit: number): string {
  if (limit >= 999999) {
    return `${current.toLocaleString()} / unlimited`;
  }
  return `${current.toLocaleString()} / ${limit.toLocaleString()}`;
}

export function formatUsageLimit(usageLimit: number): string {
  if (usageLimit >= 999999) {
    return "unlimited";
  }
  return usageLimit.toLocaleString();
}

export function getPlan(planName: string): Plan {
  return PLANS[planName] || PLANS.free;
}

// ✅ UPDATED: Feature checking with unlimited support
export function canUseFeature(subscription: any, feature: string): boolean {
  const plan = getPlan(subscription?.planName || 'free');
  const uniqueProductsModified = (subscription?.uniqueProductsModified as string[])?.length || 0;
  
  // Check usage limits first (skip for unlimited)
  if (!hasUnlimitedProducts(plan.name) && uniqueProductsModified >= plan.usageLimit) {
    return false;
  }
  
  // Feature availability by plan
  switch (feature) {
    case 'advanced_filters':
      return plan.name !== 'free';
    case 'csv_export': 
      return ['standard', 'pro'].includes(plan.name);
    case 'bulk_operations':
      return ['standard', 'pro'].includes(plan.name);
    case 'priority_support':
      return plan.name !== 'free';
    case 'analytics':
      return plan.name === 'pro';
    case 'scheduled_updates':
      return plan.name === 'pro';
    case 'api_access':
      return plan.name === 'pro';
    default:
      return true;
  }
}

export function formatPriceDisplay(price: number, currency: string = "USD"): string {
  if (price === 0) return "Free";
  
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2,
  });
  
  return `${formatter.format(price)}/month`;
}

// ✅ UPDATED: Clear upgrade recommendations with new pricing
export function getUpgradeRecommendation(subscription: any): {
  shouldUpgrade: boolean;
  reason: string;
  recommendedPlan: string;
} {
  const currentPlan = getPlan(subscription?.planName || 'free');
  const uniqueProductsModified = (subscription?.uniqueProductsModified as string[])?.length || 0;
  
  // Skip recommendation for unlimited plans
  if (hasUnlimitedProducts(currentPlan.name)) {
    return {
      shouldUpgrade: false,
      reason: "You have unlimited access.",
      recommendedPlan: currentPlan.name
    };
  }
  
  const usagePercentage = (uniqueProductsModified / currentPlan.usageLimit) * 100;

  if (currentPlan.name === 'free' && usagePercentage > 80) {
    return {
      shouldUpgrade: true,
      reason: `You've modified ${uniqueProductsModified} of ${currentPlan.usageLimit} allowed products (${usagePercentage.toFixed(1)}%). Upgrade to Standard for 500 products at just $4.99/month.`,
      recommendedPlan: 'standard'
    };
  }

  if (currentPlan.name === 'standard' && usagePercentage > 85) {
    return {
      shouldUpgrade: true,
      reason: `You're using ${usagePercentage.toFixed(1)}% of your Standard plan capacity. Upgrade to Pro for unlimited products at $9.99/month.`,
      recommendedPlan: 'pro'
    };
  }

  return {
    shouldUpgrade: false,
    reason: "Your current plan meets your needs.",
    recommendedPlan: currentPlan.name
  };
}

// ✅ UPDATED: Trial eligibility with new plans
export function isEligibleForTrial(subscription: any, planName: string): boolean {
  const plan = getPlan(planName);
  
  if (plan.name === 'free') return false;
  if (!plan.trialDays) return false;
  
  // Only new users on free plan are eligible
  const isNewUser = subscription?.usageCount === 0;
  const isOnFreePlan = subscription?.planName === 'free';
  const neverHadPaidPlan = !subscription?.subscriptionId;
  
  return isNewUser && isOnFreePlan && neverHadPaidPlan;
}

export function getPriceWithTrial(plan: Plan, isEligible: boolean): {
  displayPrice: string;
  trialInfo?: string;
} {
  const basePrice = formatPriceDisplay(plan.price);
  
  if (isEligible && plan.trialDays) {
    return {
      displayPrice: `${plan.trialDays}-Day Free Trial`,
      trialInfo: `${plan.trialDays} days free, then ${basePrice}`
    };
  }
  
  return { displayPrice: basePrice };
}

// ✅ UPDATED: Quota estimation with unlimited support
export function estimateProductUsage(
  currentProductsModified: string[], 
  newProductIds: string[], 
  usageLimit: number
): {
  wouldExceed: boolean;
  newProductsCount: number;
  totalAfter: number;
  remaining: number;
} {
  // For unlimited plans, never exceed
  if (usageLimit >= 999999) {
    const newProducts = newProductIds.filter(id => !currentProductsModified.includes(id));
    return {
      wouldExceed: false,
      newProductsCount: newProducts.length,
      totalAfter: currentProductsModified.length + newProducts.length,
      remaining: 999999 // Show as unlimited
    };
  }
  
  const newProducts = newProductIds.filter(id => !currentProductsModified.includes(id));
  const totalAfter = currentProductsModified.length + newProducts.length;
  
  const wouldExceed = totalAfter > usageLimit;
  const remaining = Math.max(0, usageLimit - totalAfter);
  
  return {
    wouldExceed,
    newProductsCount: newProducts.length,
    totalAfter,
    remaining
  };
}

export function getPlanLimits(planName: string): {
  usageLimit: number;
  displayLimit: string;
  isUnlimited: boolean;
} {
  const plan = getPlan(planName);
  const isUnlimited = hasUnlimitedProducts(planName);
  
  return {
    usageLimit: plan.usageLimit,
    displayLimit: isUnlimited ? "unlimited" : plan.usageLimit.toLocaleString(),
    isUnlimited
  };
}