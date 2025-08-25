// app/lib/plans.ts - SIMPLIFIED plans for App Store approval
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

// ✅ FIX: Simplified, clear plan structure for App Store approval
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
    price: 9.99,
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
    price: 19.99,
    currency: "USD",
    usageLimit: 2000, // ✅ FIX: Realistic limit instead of 9999999
    billingInterval: "EVERY_30_DAYS",
    trialDays: 7,
    features: [
      "2,000 unique products per month",
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

// ✅ FIX: Remove unlimited products concept for clarity
export function hasUnlimitedProducts(planName: string): boolean {
  return false; // No unlimited plans to avoid confusion
}

// ✅ FIX: Clear display formatting
export function formatUsageDisplay(current: number, limit: number): string {
  return `${current.toLocaleString()} / ${limit.toLocaleString()}`;
}

export function formatUsageLimit(usageLimit: number): string {
  return usageLimit.toLocaleString();
}

export function getPlan(planName: string): Plan {
  return PLANS[planName] || PLANS.free;
}

// ✅ FIX: Simplified feature checking
export function canUseFeature(subscription: any, feature: string): boolean {
  const plan = getPlan(subscription?.planName || 'free');
  const uniqueProductsModified = (subscription?.uniqueProductsModified as string[])?.length || 0;
  
  // Check usage limits first
  if (uniqueProductsModified >= plan.usageLimit) {
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

// ✅ FIX: Clear upgrade recommendations
export function getUpgradeRecommendation(subscription: any): {
  shouldUpgrade: boolean;
  reason: string;
  recommendedPlan: string;
} {
  const currentPlan = getPlan(subscription?.planName || 'free');
  const uniqueProductsModified = (subscription?.uniqueProductsModified as string[])?.length || 0;
  const usagePercentage = (uniqueProductsModified / currentPlan.usageLimit) * 100;

  if (currentPlan.name === 'free' && usagePercentage > 80) {
    return {
      shouldUpgrade: true,
      reason: `You've modified ${uniqueProductsModified} of ${currentPlan.usageLimit} allowed products (${usagePercentage.toFixed(1)}%). Upgrade for more capacity and advanced features.`,
      recommendedPlan: 'standard'
    };
  }

  if (currentPlan.name === 'standard' && usagePercentage > 85) {
    return {
      shouldUpgrade: true,
      reason: `You're using ${usagePercentage.toFixed(1)}% of your Standard plan capacity. Upgrade to Pro for ${PLANS.pro.usageLimit.toLocaleString()} products and advanced features.`,
      recommendedPlan: 'pro'
    };
  }

  return {
    shouldUpgrade: false,
    reason: "Your current plan meets your needs.",
    recommendedPlan: currentPlan.name
  };
}

// ✅ FIX: Simplified trial eligibility
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

// ✅ FIX: Simplified quota estimation
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
  
  return {
    usageLimit: plan.usageLimit,
    displayLimit: plan.usageLimit.toLocaleString(),
    isUnlimited: false // No unlimited plans
  };
}